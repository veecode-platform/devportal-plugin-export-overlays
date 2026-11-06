/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { mockServices } from '@backstage/backend-test-utils';
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import type { ScaffolderClient } from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import { createExecuteTemplateAction } from './createExecuteTemplateAction';

const baseUrl = 'http://localhost:7007/api/scaffolder';
const templateRef = 'template:default/my-template';
const values: JsonObject = { name: 'my-app' };

const NOT_STARTED =
  'The run did not start: run the template once more; if it fails again, tell the user.';
const MAY_HAVE_STARTED =
  'The run may or may not have started. Call list-scaffolder-tasks with owned set to true and look for a task of this template created in the last minute before you run the template again.';
const CHECK_EARLIER =
  'Earlier steps may already have made changes, such as creating the repository: check them before you run the template again.';
const TIMEOUT_MESSAGE = 'The scaffolder did not respond within the wait limit.';

let clock: number;

function eventsResponse(events: unknown[]) {
  return { ok: true, json: async () => events };
}

function hangUntilAborted(_url: string, init?: RequestInit): Promise<never> {
  const signal = init?.signal ?? undefined;
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal?.reason), {
      once: true,
    });
  });
}

function stillRunning(lastEventId: number) {
  return `Still running: call get-scaffolder-task-logs with taskId "task-1" and after ${lastEventId}. If no completion event comes back, call it again with the newest event ID, or tell the user the run is still going. Do not run the template again.`;
}

function unreadable(lastEventId: number) {
  return `The run exists, but its state could not be read just now. Call get-scaffolder-task-logs with taskId "task-1" and after ${lastEventId} to check it. Do not run the template again.`;
}

describe('createExecuteTemplateAction', () => {
  let mockFetch: jest.SpyInstance;
  let mockScaffold: jest.Mock;
  let timeoutSpy: jest.SpyInstance;
  let mockAuth: ReturnType<typeof mockServices.auth.mock>;
  let mockDiscovery: ReturnType<typeof mockServices.discovery.mock>;

  beforeEach(() => {
    clock = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    mockFetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('unexpected fetch'));
    timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    mockScaffold = jest.fn().mockResolvedValue({ taskId: 'task-1' });
    mockAuth = mockServices.auth.mock();
    mockAuth.getPluginRequestToken.mockResolvedValue({ token: 'test-token' });
    mockDiscovery = mockServices.discovery.mock();
    mockDiscovery.getBaseUrl.mockResolvedValue(baseUrl);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function invokeExecute(runValues: JsonObject = values) {
    const mockActionsRegistry = actionsRegistryServiceMock();

    createExecuteTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: {
        scaffold: mockScaffold,
      } as unknown as ScaffolderClient,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    return mockActionsRegistry.invoke({
      id: 'test:execute-template',
      input: { templateRef, values: runValues },
    });
  }

  function expectEveryPollBounded() {
    for (const [, init] of mockFetch.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  }

  it('returns the template output when the run completes within the cap', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        {
          id: 1,
          type: 'log',
          body: {
            message: 'Fetching template',
            stepId: 'fetch',
            status: 'completed',
          },
        },
        {
          id: 2,
          type: 'completion',
          body: {
            message: 'Run completed with status: completed',
            output: {
              text: [{ title: 'Next steps', content: 'Open the repository' }],
              links: [{ title: 'Repository', url: 'https://example.com/repo' }],
            },
          },
        },
      ]),
    );

    const result = await invokeExecute();

    expect(mockScaffold).toHaveBeenCalledWith(
      { templateRef, values },
      { token: 'test-token' },
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `${baseUrl}/v2/tasks/task-1/events`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'completed',
      lastEventId: 2,
      output: {
        text: [{ title: 'Next steps', content: 'Open the repository' }],
        links: [{ title: 'Repository', url: 'https://example.com/repo' }],
      },
      nextStep: expect.stringContaining('output.text'),
    });
  });

  it('returns completed when the template output holds non-string values', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        {
          id: 1,
          type: 'completion',
          body: {
            message: 'Run completed with status: completed',
            output: {
              text: [{ title: 'Next steps', content: 42 }],
              links: [{ title: 'Repository', url: true }],
            },
          },
        },
      ]),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'completed',
      lastEventId: 1,
      output: {
        text: [{ title: 'Next steps', content: 42 }],
        links: [{ title: 'Repository', url: true }],
      },
      nextStep: expect.stringContaining('output.text'),
    });
  });

  it('forwards empty values to the scaffolder', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        {
          id: 1,
          type: 'completion',
          body: {
            message: 'Run completed with status: completed',
            output: {},
          },
        },
      ]),
    );

    await invokeExecute({});

    expect(mockScaffold).toHaveBeenCalledWith(
      { templateRef, values: {} },
      { token: 'test-token' },
    );
  });

  it('names the failed step and says earlier steps may have changed things when a value is rejected', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        {
          id: 1,
          type: 'log',
          body: {
            message: 'Fetching repository',
            stepId: 'fetch-repo',
            status: 'failed',
          },
        },
        {
          id: 2,
          type: 'completion',
          body: {
            message: 'Run completed with status: failed',
            error: { name: 'InputError', message: 'repoUrl is not valid' },
          },
        },
      ]),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'failed',
      lastEventId: 2,
      error: {
        name: 'InputError',
        message: 'repoUrl is not valid',
        stepId: 'fetch-repo',
      },
      nextStep: `Step "fetch-repo" failed. A value was rejected: tell the user which one. ${CHECK_EARLIER}`,
    });
  });

  it('gives a step failure its own wording, not the before-task wording', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        {
          id: 1,
          type: 'log',
          body: { message: 'Publishing', stepId: 'publish', status: 'failed' },
        },
        {
          id: 2,
          type: 'completion',
          body: {
            message: 'Run completed with status: failed',
            error: {
              name: 'ServiceUnavailableError',
              message: 'Backend is down',
            },
          },
        },
      ]),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'failed',
      lastEventId: 2,
      error: {
        name: 'ServiceUnavailableError',
        message: 'Backend is down',
        stepId: 'publish',
      },
      nextStep: `Step "publish" failed. The scaffolder failed temporarily during this step: tell the user. ${CHECK_EARLIER}`,
    });
  });

  it('returns unknown, not failed, when the events poll is forbidden', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'unknown',
      lastEventId: 0,
      error: {
        name: 'NotAllowedError',
        message: 'Events request failed with 403 Forbidden',
      },
      nextStep:
        'The run started, but this user cannot read its status: tell them to ask an administrator for access, and do not run the template again.',
    });
    expect(mockScaffold).toHaveBeenCalledTimes(1);
    expectEveryPollBounded();
  });

  it('returns processing with the last event ID when the cap is reached', async () => {
    mockFetch.mockImplementation(async () => {
      clock += 25_000;
      return eventsResponse([
        {
          id: 4,
          type: 'log',
          body: {
            message: 'Cloning repository',
            stepId: 'fetch-repo',
            status: 'processing',
          },
        },
      ]);
    });

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'processing',
      lastEventId: 4,
      nextStep: stillRunning(4),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockScaffold).toHaveBeenCalledTimes(1);
  });

  it('returns processing with the unreadable wording when a poll fails after creation', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'processing',
      lastEventId: 0,
      nextStep: unreadable(0),
    });
    expect(mockScaffold).toHaveBeenCalledTimes(1);
  });

  it('returns processing with the unreadable wording and drains a non-403 error poll', async () => {
    const cancel = jest.fn().mockResolvedValue(undefined);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: { cancel },
    });

    const result = await invokeExecute();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'processing',
      lastEventId: 0,
      nextStep: unreadable(0),
    });
  });

  it('returns processing with the unreadable wording when the events body is malformed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ events: [] }),
    });

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'processing',
      lastEventId: 0,
      nextStep: unreadable(0),
    });
  });

  it('returns failed without a taskId when the run cannot be created', async () => {
    // ScaffolderClient.scaffold throws this message for a non-201 response.
    mockScaffold.mockRejectedValueOnce(
      new Error(
        'Backend request failed, 403 Forbidden {"error":{"name":"NotAllowedError","message":"Forbidden"}}',
      ),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'failed',
      error: {
        name: 'NotAllowedError',
        message: expect.stringContaining('403 Forbidden'),
      },
      nextStep: expect.stringContaining('lacks the permission'),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows one more run when the scaffolder is unavailable before the run starts', async () => {
    mockScaffold.mockRejectedValueOnce(
      new Error('Backend request failed, 503 Service Unavailable'),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'failed',
      error: {
        name: 'ServiceUnavailableError',
        message: expect.stringContaining('503'),
      },
      nextStep: expect.stringContaining('run the template once more'),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports unknown, not failed, when creation fails with a network error', async () => {
    mockScaffold.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'unknown',
      error: { name: 'TypeError', message: 'fetch failed' },
      nextStep: MAY_HAVE_STARTED,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reports unknown when creation fails with a 500 that is not a 503', async () => {
    mockScaffold.mockRejectedValueOnce(
      new Error('Backend request failed, 500 Internal Server Error'),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'unknown',
      error: {
        name: 'Error',
        message: 'Backend request failed, 500 Internal Server Error',
      },
      nextStep: MAY_HAVE_STARTED,
    });
  });

  it('returns failed and does not create a run when the base URL lookup fails', async () => {
    mockDiscovery.getBaseUrl.mockRejectedValueOnce(
      new Error('No endpoint for scaffolder'),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'failed',
      error: { name: 'Error', message: 'No endpoint for scaffolder' },
      nextStep: NOT_STARTED,
    });
    expect(mockScaffold).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns failed and does not create a run when the token exchange runs past the cap', async () => {
    const expired = new AbortController();
    timeoutSpy.mockReturnValueOnce(expired.signal);
    mockAuth.getPluginRequestToken.mockImplementationOnce(() => {
      expired.abort();
      return new Promise<never>(() => {});
    });

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'failed',
      error: { name: 'TimeoutError', message: TIMEOUT_MESSAGE },
      nextStep: NOT_STARTED,
    });
    expect(mockScaffold).not.toHaveBeenCalled();
  });

  it('returns unknown when creation is still pending at the cap', async () => {
    const expired = new AbortController();
    timeoutSpy.mockReturnValueOnce(expired.signal);
    mockScaffold.mockImplementationOnce(() => {
      expired.abort();
      return new Promise<never>(() => {});
    });

    const result = await invokeExecute();

    expect(result.output).toEqual({
      status: 'unknown',
      error: { name: 'TimeoutError', message: TIMEOUT_MESSAGE },
      nextStep: MAY_HAVE_STARTED,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('bounds the first poll by the time left after a slow create', async () => {
    mockScaffold.mockImplementationOnce(async () => {
      clock += 19_000;
      return { taskId: 'task-1' };
    });
    mockFetch.mockImplementationOnce(hangUntilAborted);

    const result = await invokeExecute();

    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 20_000);
    expect(timeoutSpy).toHaveBeenLastCalledWith(1_000);
    expectEveryPollBounded();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'processing',
      lastEventId: 0,
      nextStep: stillRunning(0),
    });
  });

  it('returns processing without polling when the poll token exchange runs past the cap', async () => {
    mockScaffold.mockImplementationOnce(async () => {
      clock += 19_000;
      return { taskId: 'task-1' };
    });
    mockAuth.getPluginRequestToken
      .mockResolvedValueOnce({ token: 'test-token' })
      .mockImplementationOnce(() => new Promise<never>(() => {}));

    const result = await invokeExecute();

    expect(timeoutSpy).toHaveBeenLastCalledWith(1_000);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'processing',
      lastEventId: 0,
      nextStep: stillRunning(0),
    });
  });

  it('returns cancelled when someone cancels the run', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        { id: 1, type: 'cancelled', body: { message: 'Task cancelled' } },
      ]),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'cancelled',
      lastEventId: 1,
      nextStep:
        'The run was cancelled: ask the user whether to run the template again.',
    });
  });

  it('polls again after the last event ID until the run completes', async () => {
    mockFetch
      .mockResolvedValueOnce(
        eventsResponse([
          {
            id: 1,
            type: 'log',
            body: {
              message: 'Cloning repository',
              stepId: 'fetch-repo',
              status: 'completed',
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        eventsResponse([
          {
            id: 2,
            type: 'completion',
            body: { message: 'Run completed with status: completed' },
          },
        ]),
      );

    const result = await invokeExecute();

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${baseUrl}/v2/tasks/task-1/events?after=1`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expectEveryPollBounded();
    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'completed',
      lastEventId: 2,
      nextStep:
        'The template finished and returned no next steps: tell the user that it completed.',
    });
  });

  it('reports a stale run as failed, not as completed', async () => {
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        {
          id: 1,
          type: 'completion',
          body: {
            message: 'This task was marked as stale as it exceeded its timeout',
          },
        },
      ]),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'failed',
      lastEventId: 1,
      error: {
        name: 'Error',
        message: 'This task was marked as stale as it exceeded its timeout',
      },
      nextStep: `The run failed. Tell the user the error. ${CHECK_EARLIER}`,
    });
  });

  it('reports a run cancelled by the task vacuum as failed, not as completed', async () => {
    const vacuumMessage =
      'The task was cancelled because the task worker lost connection to the task broker';
    mockFetch.mockResolvedValueOnce(
      eventsResponse([
        { id: 1, type: 'completion', body: { message: vacuumMessage } },
      ]),
    );

    const result = await invokeExecute();

    expect(result.output).toEqual({
      taskId: 'task-1',
      status: 'failed',
      lastEventId: 1,
      error: { name: 'Error', message: vacuumMessage },
      nextStep: `The run failed. Tell the user the error. ${CHECK_EARLIER}`,
    });
  });
});
