/*
 * Copyright Red Hat, Inc.
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
import type { AuthService } from '@backstage/backend-plugin-api';
import { createDryRunTemplateAction } from './createDryRunTemplateAction';
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import { mockCredentials, mockServices } from '@backstage/backend-test-utils';
import { ResponseError } from '@backstage/errors';

type ValidateScaffolderOutput = {
  valid: boolean;
  message: string;
  errors?: string[];
  log?: Array<{ message: string; stepId?: string; status?: string }>;
  output?: Record<string, unknown>;
  steps?: Array<{ id: string; name: string; action: string }>;
};

const validTemplateYaml = `
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: test-template
  namespace: default
  title: Test Template
spec:
  type: service
  steps:
    - id: step-1
      name: Step One
      action: debug:log
      input:
        message: hello
`;

const invalidYaml = `
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: test
  invalid: yaml: syntax: error
spec:
  type: service
  steps: [
`;

const callerCredentials = mockCredentials.user();

describe('createDryRunTemplateAction', () => {
  let mockScaffolderClient: {
    dryRun: jest.Mock;
  };
  let mockAuthService: AuthService;

  beforeEach(() => {
    mockScaffolderClient = {
      dryRun: jest.fn(),
    };
    mockAuthService = mockServices.auth.mock({
      getPluginRequestToken: async () => ({ token: 'scaffolder-token' }),
    });
  });

  it('should validate a valid template and return success when dry-run succeeds', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    const dryRunResult = {
      log: [
        {
          body: {
            message: 'Step completed',
            stepId: 'step-1',
            status: 'completed',
          },
        },
      ],
      output: { result: 'ok' },
      steps: [{ id: 'step-1', name: 'Step One', action: 'debug:log' }],
    };

    mockScaffolderClient.dryRun.mockResolvedValue(dryRunResult);

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
    });

    expect(result.output).toEqual({
      valid: true,
      message: 'Template validation successful',
      log: [
        {
          message: 'Step completed',
          stepId: 'step-1',
          status: 'completed',
        },
      ],
      output: { result: 'ok' },
      steps: [{ id: 'step-1', name: 'Step One', action: 'debug:log' }],
    });

    expect(mockScaffolderClient.dryRun).toHaveBeenCalledWith(
      {
        template: expect.objectContaining({
          apiVersion: 'scaffolder.backstage.io/v1beta3',
          kind: 'Template',
          metadata: expect.objectContaining({
            name: 'test-template',
          }),
        }),
        values: {},
        directoryContents: [],
      },
      { token: 'scaffolder-token' },
    );
  });

  it('should pass values and files to scaffolderClient.dryRun', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    mockScaffolderClient.dryRun.mockResolvedValue({
      log: [],
      output: {},
      steps: [],
    });

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    const values = { name: 'my-app' };
    const files = [
      {
        path: 'README.md',
        content: 'hello',
      },
    ];

    await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: {
        templateYaml: validTemplateYaml,
        values,
        files,
      },
    });

    expect(mockScaffolderClient.dryRun).toHaveBeenCalledWith(
      {
        template: expect.any(Object),
        values,
        directoryContents: [
          {
            path: 'README.md',
            base64Content: Buffer.from('hello').toString('base64'),
          },
        ],
      },
      { token: 'scaffolder-token' },
    );
  });

  it('should call scaffolderClient.dryRun with parsed template', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    mockScaffolderClient.dryRun.mockResolvedValue({
      log: [],
      output: {},
      steps: [],
    });

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
    });

    expect(mockScaffolderClient.dryRun).toHaveBeenCalledTimes(1);
    expect(mockScaffolderClient.dryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({
          kind: 'Template',
          metadata: expect.objectContaining({
            name: 'test-template',
          }),
        }),
      }),
      { token: 'scaffolder-token' },
    );
  });

  it('should return validation errors when YAML is invalid', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: invalidYaml },
    });

    expect(result.output).toEqual({
      valid: false,
      message: 'Failed to parse YAML template',
      errors: expect.arrayContaining([
        expect.stringContaining('YAML parsing error'),
      ]),
    });

    expect(mockScaffolderClient.dryRun).not.toHaveBeenCalled();
  });

  it('should return validation failure when scaffolderClient.dryRun throws ResponseError', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();

    const responseError = await ResponseError.fromResponse({
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: {
          name: 'InputError',
          message: 'Invalid template: missing required field',
        },
      }),
    } as Response);

    mockScaffolderClient.dryRun.mockRejectedValue(responseError);

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
    });

    expect(result.output).toEqual({
      valid: false,
      message: 'Template validation failed',
      errors: expect.any(Array),
    });
  });

  it('should return validation failure when scaffolderClient.dryRun throws generic error', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();

    mockScaffolderClient.dryRun.mockRejectedValue(
      new Error('Authentication error'),
    );

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
    });

    expect(result.output).toEqual({
      valid: false,
      message: 'Template validation failed',
      errors: ['Authentication error'],
    });
  });

  it('should use default empty values and files when not provided', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    mockScaffolderClient.dryRun.mockResolvedValue({
      log: [],
      output: {},
      steps: [],
    });

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
    });

    expect(mockScaffolderClient.dryRun).toHaveBeenCalledWith(
      {
        template: expect.any(Object),
        values: {},
        directoryContents: [],
      },
      { token: 'scaffolder-token' },
    );
  });

  it('should map log entries with top-level message when body is absent', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    mockScaffolderClient.dryRun.mockResolvedValue({
      log: [{ message: 'Plain log message' }],
      output: {},
      steps: [],
    });

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    const result = await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
    });

    const output = result.output as ValidateScaffolderOutput;
    expect(output.valid).toBe(true);
    expect(output.log).toEqual([
      { message: 'Plain log message', stepId: undefined, status: undefined },
    ]);
  });

  it('should send the scaffolder token obtained for the caller to dryRun', async () => {
    const mockActionsRegistry = actionsRegistryServiceMock();
    mockScaffolderClient.dryRun.mockResolvedValue({
      log: [],
      output: {},
      steps: [],
    });

    createDryRunTemplateAction({
      actionsRegistry: mockActionsRegistry,
      scaffolderClient: mockScaffolderClient as any,
      auth: mockAuthService,
    });

    await mockActionsRegistry.invoke({
      id: 'test:validate-scaffolder',
      input: { templateYaml: validTemplateYaml },
      credentials: callerCredentials,
    });

    expect(mockAuthService.getPluginRequestToken).toHaveBeenCalledWith({
      onBehalfOf: callerCredentials,
      targetPluginId: 'scaffolder',
    });
    expect(mockScaffolderClient.dryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({ kind: 'Template' }),
      }),
      { token: 'scaffolder-token' },
    );
  });
});
