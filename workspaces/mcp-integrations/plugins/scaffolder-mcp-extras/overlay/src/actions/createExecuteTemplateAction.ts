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
import type { AuthService } from '@backstage/backend-plugin-api';
import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import type { ScaffolderClient } from '@backstage/plugin-scaffolder-common';
import type { JsonValue } from '@backstage/types';

/**
 * Overlay changes vs upstream (rhdh-plugins scaffolder-mcp-extras):
 * - Simplified values schema: z.record(z.unknown()) instead of z.union with 6 types
 *   (aligns with Backstage core's version, reduces LLM confusion)
 * - Tool description includes full JSON example of a correct call
 * - Explicit "Never call with only templateRef" instruction
 *
 * @public
 */
export const createExecuteTemplateAction = ({
  actionsRegistry,
  scaffolderClient,
  auth,
}: {
  actionsRegistry: ActionsRegistryService;
  scaffolderClient: ScaffolderClient;
  auth: AuthService;
}) => {
  actionsRegistry.register({
    name: 'execute-template',
    title: 'Execute Scaffolder Template',
    attributes: {
      destructive: true,
      readOnly: false,
      idempotent: false,
    },
    description: `Executes a Scaffolder template. Both templateRef and values are REQUIRED. Never call this tool with only templateRef.

Correct example: {"templateRef":"template:default/my-template","values":{"componentName":"my-service","repoUrl":"github.com?owner=my-org&repo=my-service","visibility":"public"}}

Use fetch-template-metadata first to discover required parameters, then call this tool with all collected values. Returns a taskId to track progress via get-scaffolder-task-logs.`,
    schema: {
      input: (z: any) =>
        z.object({
          templateRef: z
            .string()
            .describe(
              'The template entity reference to execute, e.g. "template:default/my-template"',
            ),
          values: z
            .record(z.unknown())
            .describe(
              'REQUIRED. Input parameter values for the template as key-value pairs. Use fetch-template-metadata to discover required parameters. Example: {"componentName": "my-app", "repoUrl": "github.com?owner=my-org&repo=my-app", "visibility": "public"}',
            ),
          secrets: z
            .record(z.string())
            .optional()
            .describe(
              'Optional secrets to pass to the template execution.',
            ),
        }),
      output: (z: any) =>
        z.object({
          taskId: z
            .string()
            .describe(
              'The task ID for the scaffolder execution. Use this to track progress or retrieve logs.',
            ),
        }),
    },
    action: async ({
      input,
      credentials,
    }: {
      input: { templateRef: string; values: Record<string, JsonValue>; secrets?: Record<string, string> };
      credentials: any;
    }) => {
      const { token } = await auth.getPluginRequestToken({
        onBehalfOf: credentials,
        targetPluginId: 'scaffolder',
      });

      const { taskId } = await scaffolderClient.scaffold(
        {
          templateRef: input.templateRef,
          values: input.values,
          ...(input.secrets && { secrets: input.secrets }),
        },
        { token },
      );

      return { output: { taskId } };
    },
  });
};
