/*
 * Copyright 2026 VeeCode.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import http from 'node:http';
import { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import express from 'express';
import { MiddlewareFactory } from '@backstage/backend-defaults/rootHttpRouter';
import { mockServices } from '@backstage/backend-test-utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpService } from './McpService';

const BEAT_MS = 15_000;
const TOOL = 'slow-plugin.slow';

// Captured before the fake timers replace them, to bound the real waits.
const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;

function slowAction() {
  let finish: (value: unknown) => void = () => {};
  let fail: (reason: Error) => void = () => {};
  let markStarted: () => void = () => {};
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  const run = () =>
    new Promise<unknown>((resolve, reject) => {
      finish = resolve;
      fail = reject;
      markStarted();
    });
  return {
    run,
    started,
    finish: () => finish({}),
    fail: (reason: Error) => fail(reason),
  };
}

function createService(
  run: () => Promise<unknown>,
  logger?: ReturnType<typeof mockServices.logger.mock>,
) {
  const actions = {
    list: async () => ({
      actions: [
        {
          id: 'slow-plugin:slow',
          name: 'slow',
          pluginId: 'slow-plugin',
          title: 'Slow',
          description: 'An action that takes a while',
          schema: { input: { type: 'object', properties: {} } },
          attributes: { destructive: false, idempotent: true, readOnly: true },
        },
      ],
    }),
    invoke: async () => ({ output: await run() }),
  };
  const auditor = {
    createEvent: async () => ({
      success: async () => {},
      fail: async () => {},
    }),
  };
  const metrics = { createHistogram: () => ({ record: () => {} }) };
  const tracingService = {
    propagation: { getActiveBaggage: () => undefined },
    startActiveSpan: (
      _name: string,
      _options: unknown,
      fn: (span: unknown) => unknown,
    ) => fn({ setAttribute: () => {}, setStatus: () => {} }),
  };

  return McpService.create({
    actions: actions as never,
    metrics: metrics as never,
    tracingService: tracingService as never,
    auditor: auditor as never,
    logger,
  });
}

async function connect(
  run: () => Promise<unknown>,
  logger?: ReturnType<typeof mockServices.logger.mock>,
) {
  const mcp = await createService(run, logger);
  const server = mcp.getServer({ credentials: {} as never });
  const notify = jest.spyOn(server, 'notification');
  const beatsSent = () =>
    notify.mock.calls.filter(
      ([notification]) => notification.method === 'notifications/progress',
    ).length;
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'progress-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return { server, client, notify, beatsSent };
}

// Serves the MCP endpoint the way createStreamableRouter does, behind the
// compression middleware that Backstage's root HTTP router applies to every
// response.
async function listenBehindCompression(mcp: McpService) {
  const app = express();
  app.use(
    MiddlewareFactory.create({
      config: mockServices.rootConfig(),
      logger: mockServices.rootLogger(),
    }).compression(),
  );
  app.use(express.json());
  app.post('/', async (req, res) => {
    const server = mcp.getServer({ credentials: {} as never, req });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  });
  const httpServer = http.createServer(app);
  await new Promise<void>(resolve =>
    httpServer.listen(0, '127.0.0.1', resolve),
  );
  return httpServer;
}

// A client that asks for gzip, as Node's fetch does by default, and exposes
// what it has decoded so far.
function callToolOverHttp(port: number) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: TOOL,
      arguments: {},
      _meta: { progressToken: 'beat-test' },
    },
  });
  const state = {
    text: '',
    ended: false,
    headersReceived: false,
    contentEncoding: undefined as string | undefined,
  };
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach(listener => listener());

  const request = http.request(
    {
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/',
      agent: false,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'accept-encoding': 'gzip',
        'content-length': Buffer.byteLength(body),
      },
    },
    response => {
      state.headersReceived = true;
      state.contentEncoding = response.headers['content-encoding'];
      const decoded =
        state.contentEncoding === 'gzip'
          ? response.pipe(zlib.createGunzip())
          : response;
      decoded.on('data', chunk => {
        state.text += chunk.toString();
        changed();
      });
      decoded.on('end', () => {
        state.ended = true;
        changed();
      });
      changed();
    },
  );
  request.end(body);

  const until = (what: string, done: () => boolean, ms = 2000) =>
    new Promise<void>((resolve, reject) => {
      const timer = realSetTimeout(() => {
        reject(
          new Error(
            `Not within ${ms} ms: ${what}. The client had received: ${JSON.stringify(
              state.text,
            )}`,
          ),
        );
      }, ms);
      const check = () => {
        if (done()) {
          realClearTimeout(timer);
          listeners.delete(check);
          resolve();
        }
      };
      listeners.add(check);
      check();
    });

  return { state, request, until };
}

describe('McpService progress notifications', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('beats every 15 seconds while the action runs, with a progress token', async () => {
    const action = slowAction();
    const { client } = await connect(action.run);
    const beats: number[] = [];

    const call = client.callTool({ name: TOOL, arguments: {} }, undefined, {
      timeout: 300_000,
      onprogress: ({ progress }) => {
        beats.push(progress);
      },
    });

    await jest.advanceTimersByTimeAsync(BEAT_MS - 1);
    expect(beats).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(beats).toEqual([1]);
    await jest.advanceTimersByTimeAsync(2 * BEAT_MS);
    expect(beats).toEqual([1, 2, 3]);

    action.finish();
    await call;
  });

  it('sends no beat when the request has no progress token', async () => {
    const action = slowAction();
    const { client, beatsSent } = await connect(action.run);

    const call = client.callTool({ name: TOOL, arguments: {} });
    await jest.advanceTimersByTimeAsync(3 * BEAT_MS);
    action.finish();
    await call;

    expect(beatsSent()).toBe(0);
  });

  it('stops beating once the action settles', async () => {
    const action = slowAction();
    const { client, beatsSent } = await connect(action.run);

    const call = client.callTool({ name: TOOL, arguments: {} }, undefined, {
      timeout: 300_000,
      onprogress: () => {},
    });

    await jest.advanceTimersByTimeAsync(BEAT_MS);
    action.finish();
    await call;
    const sentWhenSettled = beatsSent();
    await jest.advanceTimersByTimeAsync(5 * BEAT_MS);

    expect(sentWhenSettled).toBe(1);
    expect(beatsSent()).toBe(sentWhenSettled);
  });

  it('stops beating when the action throws', async () => {
    const action = slowAction();
    const { client, beatsSent } = await connect(action.run);

    const call = client.callTool({ name: TOOL, arguments: {} }, undefined, {
      timeout: 300_000,
      onprogress: () => {},
    });

    await jest.advanceTimersByTimeAsync(BEAT_MS);
    action.fail(new Error('action failed'));
    await call.catch(() => undefined);
    const sentWhenSettled = beatsSent();
    await jest.advanceTimersByTimeAsync(5 * BEAT_MS);

    expect(sentWhenSettled).toBe(1);
    expect(beatsSent()).toBe(sentWhenSettled);
  });

  it('does not keep the process alive for the beat', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const action = slowAction();
    const { client } = await connect(action.run);

    const call = client.callTool({ name: TOOL, arguments: {} }, undefined, {
      timeout: 300_000,
      onprogress: () => {},
    });
    await jest.advanceTimersByTimeAsync(1);

    const beatIndex = setIntervalSpy.mock.calls.findIndex(
      ([, delay]) => delay === BEAT_MS,
    );
    expect(beatIndex).toBeGreaterThanOrEqual(0);
    expect(setIntervalSpy.mock.results[beatIndex].value.hasRef()).toBe(false);

    action.finish();
    await call;
  });

  it('logs a failed beat at debug level without the call arguments, and the call still succeeds', async () => {
    const logger = mockServices.logger.mock();
    const action = slowAction();
    const { client, notify } = await connect(action.run, logger);
    notify.mockRejectedValueOnce(new Error('client gone'));

    const call = client.callTool(
      { name: TOOL, arguments: { secret: 'do-not-log' } },
      undefined,
      { timeout: 300_000, onprogress: () => {} },
    );
    await jest.advanceTimersByTimeAsync(BEAT_MS);
    action.finish();

    await expect(call).resolves.toBeDefined();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith(
      'Progress notification failed: client gone',
    );
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('do-not-log');
  });

  describe('behind the response compression of the root HTTP router', () => {
    const servers: http.Server[] = [];
    const requests: http.ClientRequest[] = [];

    afterEach(async () => {
      requests.splice(0).forEach(request => request.destroy());
      await Promise.all(
        servers.splice(0).map(
          httpServer =>
            new Promise<void>(resolve => {
              httpServer.closeAllConnections();
              httpServer.close(() => resolve());
            }),
        ),
      );
    });

    it('delivers each beat to a gzip client while the call is still running', async () => {
      const action = slowAction();
      const httpServer = await listenBehindCompression(
        await createService(action.run),
      );
      servers.push(httpServer);
      const { port } = httpServer.address() as AddressInfo;

      const call = callToolOverHttp(port);
      requests.push(call.request);
      try {
        await action.started;
        await call.until(
          'the response headers',
          () => call.state.headersReceived,
        );
        expect(call.state.contentEncoding).toBe('gzip');

        await jest.advanceTimersByTimeAsync(BEAT_MS);
        await call.until('the first beat', () =>
          /"progress":1\}/.test(call.state.text),
        );
        expect(call.state.ended).toBe(false);

        await jest.advanceTimersByTimeAsync(BEAT_MS);
        await call.until('the second beat', () =>
          /"progress":2\}/.test(call.state.text),
        );
        expect(call.state.ended).toBe(false);
      } finally {
        action.finish();
      }

      await call.until('the end of the response', () => call.state.ended);
      expect(call.state.text).toContain('"result"');
    });
  });
});
