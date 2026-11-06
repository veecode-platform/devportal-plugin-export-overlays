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
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { mockServices } from '@backstage/backend-test-utils';
import type { LogEvent } from '@backstage/plugin-scaffolder-common';
import { createGetScaffolderTaskLogsAction } from './createGetScaffolderTaskLogsAction';

const mockEvents: LogEvent[] = [
  {
    id: 1,
    taskId: 'task-1',
    createdAt: '2025-01-01T00:00:00Z',
    type: 'log',
    body: { message: 'Starting step', stepId: 'step-1' },
  },
  {
    id: 2,
    taskId: 'task-1',
    createdAt: '2025-01-01T00:00:01Z',
    type: 'log',
    body: { message: 'Step complete', stepId: 'step-1' },
  },
  {
    id: 3,
    taskId: 'task-1',
    createdAt: '2025-01-01T00:00:02Z',
    type: 'completion',
    body: { message: 'Task completed', status: 'completed' },
  },
];

describe('createGetScaffolderTaskLogsAction', () => {
  const mockBaseUrl = 'http://localhost:7007/api/scaffolder';
  const mockToken = 'mock-token';

  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return log events for a task', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockEvents,
    });

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:get-scaffolder-task-logs',
      input: { taskId: 'task-1' },
    });

    expect(result.output).toEqual({
      events: [
        {
          id: 1,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:00Z',
          type: 'log',
          body: {
            message: 'Starting step',
            stepId: 'step-1',
            status: undefined,
          },
        },
        {
          id: 2,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:01Z',
          type: 'log',
          body: {
            message: 'Step complete',
            stepId: 'step-1',
            status: undefined,
          },
        },
        {
          id: 3,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:02Z',
          type: 'completion',
          body: {
            message: 'Task completed',
            stepId: undefined,
            status: 'completed',
          },
        },
      ],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/v2/tasks/task-1/events`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${mockToken}`,
        }),
      }),
    );
  });

  it('should return the template output on the completion event', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:00Z',
          type: 'log',
          body: {
            message: 'Fetching template',
            stepId: 'fetch',
            status: 'completed',
          },
        },
        {
          id: 2,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:01Z',
          type: 'completion',
          body: {
            message: 'Run completed with status: completed',
            output: {
              text: [{ title: 'Next steps', content: 'Open the repository' }],
              links: [{ title: 'Repository', url: 'https://example.com/repo' }],
            },
          },
        },
      ],
    });

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:get-scaffolder-task-logs',
      input: { taskId: 'task-1' },
    });

    expect(result.output).toEqual({
      events: [
        {
          id: 1,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:00Z',
          type: 'log',
          body: {
            message: 'Fetching template',
            stepId: 'fetch',
            status: 'completed',
          },
        },
        {
          id: 2,
          taskId: 'task-1',
          createdAt: '2025-01-01T00:00:01Z',
          type: 'completion',
          body: {
            message: 'Run completed with status: completed',
            output: {
              text: [{ title: 'Next steps', content: 'Open the repository' }],
              links: [{ title: 'Repository', url: 'https://example.com/repo' }],
            },
          },
        },
      ],
    });
  });

  it('should pass the after parameter through to the API', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:get-scaffolder-task-logs',
      input: { taskId: 'task-2', after: 42 },
    });

    expect(result.output).toEqual({ events: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/v2/tasks/task-2/events?after=42`,
      expect.any(Object),
    );
  });

  it('should throw when the API request fails', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Internal Server Error',
    });

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    await expect(
      mockActionsRegistry.invoke({
        id: 'test:get-scaffolder-task-logs',
        input: { taskId: 'task-3' },
      }),
    ).rejects.toThrow(/Scaffolder task logs request failed: 500/);
  });

  it('should reject taskId containing path traversal or path segment characters', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    await expect(
      mockActionsRegistry.invoke({
        id: 'test:get-scaffolder-task-logs',
        input: { taskId: '../../../other' },
      }),
    ).rejects.toThrow(/valid task ID/);

    await expect(
      mockActionsRegistry.invoke({
        id: 'test:get-scaffolder-task-logs',
        input: { taskId: 'task/extra' },
      }),
    ).rejects.toThrow(/valid task ID/);

    await expect(
      mockActionsRegistry.invoke({
        id: 'test:get-scaffolder-task-logs',
        input: { taskId: 'task\\backslash' },
      }),
    ).rejects.toThrow(/valid task ID/);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return no events when the events request runs past 20 seconds', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();
    const timeout = new AbortController();
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeout.signal);

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);
    mockFetch.mockImplementation(() => {
      timeout.abort();
      return Promise.reject(timeout.signal.reason);
    });

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:get-scaffolder-task-logs',
      input: { taskId: 'task-4', after: 7 },
    });

    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
    expect(result.output).toEqual({ events: [] });
    expect(mockFetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/v2/tasks/task-4/events?after=7`,
      expect.objectContaining({ signal: timeout.signal }),
    );
  });

  it('should still throw when the events body cannot be read and the request did not abort', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const mockAuth = mockServices.auth.mock();
    const mockDiscovery = mockServices.discovery.mock();

    mockAuth.getPluginRequestToken.mockResolvedValue({ token: mockToken });
    mockDiscovery.getBaseUrl.mockResolvedValue(mockBaseUrl);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    createGetScaffolderTaskLogsAction({
      actionsRegistry: mockActionsRegistry,
      auth: mockAuth,
      discovery: mockDiscovery,
    });

    await expect(
      mockActionsRegistry.invoke({
        id: 'test:get-scaffolder-task-logs',
        input: { taskId: 'task-5' },
      }),
    ).rejects.toThrow('Unexpected end of JSON input');
  });
});
