/*
 * Copyright 2026 VeeCode.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpService } from './McpService';

const BEAT_MS = 15_000;
const TOOL = 'slow-plugin.slow';

async function connect(run: () => Promise<unknown>) {
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

  const mcp = await McpService.create({
    actions: actions as never,
    metrics: metrics as never,
    tracingService: tracingService as never,
    auditor: auditor as never,
  });
  const server = mcp.getServer({ credentials: {} as never });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'progress-test', version: '1.0.0' });
  await client.connect(clientTransport);
  return { server, client };
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
    let finish: (value: unknown) => void = () => {};
    const { client } = await connect(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
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

    finish({});
    await call;
  });

  it('sends no beat when the request has no progress token', async () => {
    let finish: (value: unknown) => void = () => {};
    const { server, client } = await connect(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const notify = jest.spyOn(server, 'notification');

    const call = client.callTool({ name: TOOL, arguments: {} });
    await jest.advanceTimersByTimeAsync(3 * BEAT_MS);
    finish({});
    await call;

    const beats = notify.mock.calls.filter(
      ([notification]) => notification.method === 'notifications/progress',
    );
    expect(beats).toEqual([]);
  });

  it('stops beating once the action settles', async () => {
    let finish: (value: unknown) => void = () => {};
    const { client } = await connect(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const beats: number[] = [];

    const call = client.callTool({ name: TOOL, arguments: {} }, undefined, {
      timeout: 300_000,
      onprogress: ({ progress }) => {
        beats.push(progress);
      },
    });

    await jest.advanceTimersByTimeAsync(BEAT_MS);
    finish({});
    await call;
    await jest.advanceTimersByTimeAsync(5 * BEAT_MS);

    expect(beats).toEqual([1]);
  });

  it('stops beating when the action throws', async () => {
    let fail: (reason: Error) => void = () => {};
    const { client } = await connect(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const beats: number[] = [];

    const call = client.callTool({ name: TOOL, arguments: {} }, undefined, {
      timeout: 300_000,
      onprogress: ({ progress }) => {
        beats.push(progress);
      },
    });

    await jest.advanceTimersByTimeAsync(BEAT_MS);
    fail(new Error('action failed'));
    await call.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(5 * BEAT_MS);

    expect(beats).toEqual([1]);
  });
});
