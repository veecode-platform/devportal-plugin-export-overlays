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
import type {
  AuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import type { CatalogService } from '@backstage/plugin-catalog-node';
import type {
  ScaffolderClient,
  TemplateParameterSchema,
} from '@backstage/plugin-scaffolder-common';

type ParameterDetail = {
  name: string;
  title?: string;
  description?: string;
  type?: string;
  required: boolean;
  defaultValue?: string;
  enumOptions?: string[];
};

type TemplateHints = {
  requiredParameters?: string[];
  optionalParameters?: string[];
  parameterDetails?: ParameterDetail[];
  exampleValues?: Record<string, unknown>;
  exampleExecuteInput?: {
    templateRef: string;
    values: Record<string, unknown>;
  };
  executionHint?: string;
};

/**
 * Overlay changes vs upstream (rhdh-plugins scaffolder-mcp-extras):
 * - Preserves legacy `parameters` and `steps` JSON strings for compatibility
 * - Adds structured execution hints so LLMs can build `execute-template.values`
 *   without reverse-engineering the template schema from a JSON string
 *
 * @public
 */
export const createFetchTemplateMetadataAction = ({
  actionsRegistry,
  catalog,
  logger,
  scaffolderClient,
  auth,
}: {
  actionsRegistry: ActionsRegistryService;
  catalog: CatalogService;
  logger: LoggerService;
  scaffolderClient?: ScaffolderClient;
  auth: AuthService;
}) => {
  actionsRegistry.register({
    name: 'fetch-template-metadata',
    title: 'Fetch Software Template Metadata',
    description: `Search and retrieve Software Template metadata from the Backstage catalog.

This tool retrieves Backstage Software Templates with their configuration details, and also returns structured execution hints that can be used directly with execute-template.

Returns template-specific fields including:
- Basic metadata (name, title, tags, labels, description, owner)
- templateRef ready for execute-template
- requiredParameters and optionalParameters
- parameterDetails with per-field descriptions
- exampleValues, exampleExecuteInput, and executionHint
- Legacy parameters and steps fields as JSON strings

When preparing to call execute-template, prefer exampleExecuteInput + parameterDetails over parsing the legacy JSON strings manually.`,
    schema: {
      input: (z: any) =>
        z.object({
          name: z.string().optional().describe('Filter Template by name'),
          title: z.string().optional().describe('Filter Template by title'),
          uid: z
            .string()
            .optional()
            .describe('Filter Template by unique identifier'),
        }),
      output: (z: any) =>
        z.object({
          templates: z
            .array(
              z.object({
                name: z
                  .string()
                  .describe('The Backstage Software Template entity name'),
                title: z
                  .string()
                  .optional()
                  .describe('The template title, when present'),
                templateRef: z
                  .string()
                  .describe(
                    'The full entity reference to pass to execute-template',
                  ),
                tags: z
                  .string()
                  .optional()
                  .describe('Template tags as comma-separated values'),
                labels: z
                  .string()
                  .optional()
                  .describe('Template labels as comma-separated key:value pairs'),
                description: z
                  .string()
                  .optional()
                  .describe('The template description'),
                owner: z
                  .string()
                  .optional()
                  .describe('The template owner'),
                requiredParameters: z
                  .array(z.string())
                  .optional()
                  .describe(
                    'Names of parameters that must be included in execute-template.values',
                  ),
                optionalParameters: z
                  .array(z.string())
                  .optional()
                  .describe(
                    'Names of optional parameters supported by the template',
                  ),
                parameterDetails: z
                  .array(
                    z.object({
                      name: z.string().describe('Parameter name'),
                      title: z.string().optional().describe('Parameter title'),
                      description: z
                        .string()
                        .optional()
                        .describe('Parameter description'),
                      type: z.string().optional().describe('JSON Schema type'),
                      required: z
                        .boolean()
                        .describe('Whether the parameter is required'),
                      defaultValue: z
                        .string()
                        .optional()
                        .describe('Default value serialized as JSON string'),
                      enumOptions: z
                        .array(z.string())
                        .optional()
                        .describe('Allowed options for enum-like parameters'),
                    }),
                  )
                  .optional()
                  .describe('Structured parameter metadata for execute-template'),
                exampleValues: z
                  .record(z.unknown())
                  .optional()
                  .describe(
                    'Example values object that can be adapted and passed directly to execute-template',
                  ),
                exampleExecuteInput: z
                  .object({
                    templateRef: z
                      .string()
                      .describe('Template ref to pass to execute-template'),
                    values: z
                      .record(z.unknown())
                      .describe(
                        'Example values payload to pass to execute-template',
                      ),
                  })
                  .optional()
                  .describe(
                    'A ready-to-use example execute-template payload built from the template metadata',
                  ),
                executionHint: z
                  .string()
                  .optional()
                  .describe(
                    'A ready-to-use execute-template hint built from the template metadata',
                  ),
                parameters: z
                  .string()
                  .optional()
                  .describe(
                    'Legacy template parameters as JSON string. Prefer requiredParameters/parameterDetails/exampleValues instead.',
                  ),
                steps: z
                  .string()
                  .optional()
                  .describe('Legacy template steps/workflow as JSON string'),
              }),
            )
            .describe('An array of Software Template metadata'),
          error: z
            .string()
            .optional()
            .describe('Error message if the operation fails'),
        }),
    },
    action: async ({ input, credentials }: { input: any; credentials: any }) => {
      try {
        const result = await fetchSoftwareTemplateMetadata(
          catalog,
          credentials,
          logger,
          auth,
          input,
          scaffolderClient,
        );
        return {
          output: {
            ...result,
            error: undefined,
          },
        };
      } catch (error) {
        logger.error(
          'fetch-template-metadata: Error fetching template metadata:',
          error,
        );
        return {
          output: {
            templates: [],
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  });
};

export async function fetchSoftwareTemplateMetadata(
  catalog: CatalogService,
  credentials: any,
  logger: LoggerService,
  auth: AuthService,
  input?: {
    name?: string;
    title?: string;
    uid?: string;
  },
  scaffolderClient?: ScaffolderClient,
) {
  const filter: Record<string, string> = {
    kind: 'Template',
  };

  if (input?.name) {
    filter['metadata.name'] = input.name;
  }
  if (input?.title) {
    filter['metadata.title'] = input.title;
  }
  if (input?.uid) {
    filter['metadata.uid'] = input.uid;
  }

  logger.info(
    'fetch-template-metadata: Fetching template metadata with options:',
    filter,
  );

  const { items } = await catalog.getEntities(
    {
      filter,
      fields: [
        'metadata.name',
        'metadata.namespace',
        'metadata.title',
        'metadata.tags',
        'metadata.labels',
        'metadata.description',
        'spec.owner',
        'spec.parameters',
        'spec.steps',
      ],
    },
    { credentials },
  );

  const requestOptions = await getScaffolderRequestOptions(auth, credentials);

  return {
    templates: await Promise.all(items.map(async template => {
      const templateRef = `template:${template.metadata.namespace ?? 'default'}/${
        template.metadata.name
      }`;
      const hints = await extractTemplateHints(
        template.spec?.parameters,
        templateRef,
        scaffolderClient,
        requestOptions,
      );

      return {
        name: template.metadata.name,
        title:
          typeof template.metadata.title === 'string'
            ? template.metadata.title
            : undefined,
        templateRef,
        tags: template.metadata.tags?.join(',') || undefined,
        labels: template.metadata.labels
          ? Object.entries(template.metadata.labels)
              .map(([k, v]) => `${k}:${v}`)
              .join(',')
          : undefined,
        description: template.metadata.description,
        owner:
          typeof template.spec?.owner === 'string'
            ? template.spec.owner
            : undefined,
        ...hints,
        parameters: template.spec?.parameters
          ? JSON.stringify(template.spec.parameters)
          : undefined,
        steps: template.spec?.steps
          ? JSON.stringify(template.spec.steps)
          : undefined,
      };
    })),
  };
}

async function extractTemplateHints(
  parameters: unknown,
  templateRef: string,
  scaffolderClient?: ScaffolderClient,
  requestOptions?: { token: string },
): Promise<TemplateHints> {
  const parameterSchema = await getTemplateParameterSchema(
    templateRef,
    scaffolderClient,
    requestOptions,
  );

  const sections = parameterSchema?.steps?.length
    ? parameterSchema.steps.map(step => step.schema)
    : Array.isArray(parameters)
      ? parameters
      : parameters && typeof parameters === 'object'
        ? [parameters]
        : [];

  const detailsByName = new Map<string, ParameterDetail>();

  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      continue;
    }

    const sectionRecord = section as Record<string, unknown>;
    const properties =
      sectionRecord.properties && typeof sectionRecord.properties === 'object'
        ? (sectionRecord.properties as Record<string, unknown>)
        : {};
    const requiredSet = new Set(
      Array.isArray(sectionRecord.required)
        ? sectionRecord.required.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    );

    for (const [name, rawSchema] of Object.entries(properties)) {
      if (!rawSchema || typeof rawSchema !== 'object') {
        continue;
      }

      const schema = rawSchema as Record<string, unknown>;
      const existing = detailsByName.get(name);
      const detail: ParameterDetail = existing ?? {
        name,
        required: false,
      };

      detail.required = detail.required || requiredSet.has(name);

      if (!detail.title && typeof schema.title === 'string') {
        detail.title = schema.title;
      }
      if (!detail.description && typeof schema.description === 'string') {
        detail.description = schema.description;
      }
      if (!detail.type && typeof schema.type === 'string') {
        detail.type = schema.type;
      }
      if (
        detail.defaultValue === undefined &&
        Object.prototype.hasOwnProperty.call(schema, 'default')
      ) {
        detail.defaultValue = JSON.stringify(schema.default);
      }
      if (!detail.enumOptions && Array.isArray(schema.enum)) {
        const enumValues = schema.enum
          .filter(
            (value): value is string | number | boolean =>
              ['string', 'number', 'boolean'].includes(typeof value),
          )
          .map(value => String(value));
        if (enumValues.length > 0) {
          detail.enumOptions = enumValues;
        }
      }

      detailsByName.set(name, detail);
    }
  }

  const parameterDetails = Array.from(detailsByName.values());
  if (parameterDetails.length === 0) {
    return {};
  }

  const requiredParameters = parameterDetails
    .filter(detail => detail.required)
    .map(detail => detail.name);
  const optionalParameters = parameterDetails
    .filter(detail => !detail.required)
    .map(detail => detail.name);

  const exampleValues = Object.fromEntries(
    parameterDetails
      .filter(
        detail =>
          detail.required ||
          detail.defaultValue !== undefined ||
          (detail.enumOptions?.length ?? 0) > 0,
      )
      .map(detail => [detail.name, buildExampleValue(detail)]),
  );

  const executionHint = `Call execute-template with {"templateRef":"${templateRef}","values":${JSON.stringify(
    exampleValues,
  )}} and replace the exampleValues entries with the user-provided values before execution.`;

  return {
    requiredParameters:
      requiredParameters.length > 0 ? requiredParameters : undefined,
    optionalParameters:
      optionalParameters.length > 0 ? optionalParameters : undefined,
    parameterDetails,
    exampleValues,
    exampleExecuteInput: {
      templateRef,
      values: exampleValues,
    },
    executionHint,
  };
}

function buildExampleValue(detail: ParameterDetail): unknown {
  if (detail.defaultValue !== undefined) {
    try {
      return JSON.parse(detail.defaultValue);
    } catch {
      return detail.defaultValue;
    }
  }

  if (detail.enumOptions && detail.enumOptions.length > 0) {
    return detail.enumOptions[0];
  }

  const name = detail.name.toLowerCase();
  if (name === 'repourl' || name.endsWith('repourl')) {
    return 'github.com?owner=my-org&repo=my-service';
  }
  if (name.includes('visibility')) {
    return 'public';
  }
  if (
    name.includes('componentname') ||
    name.includes('servicename') ||
    name === 'name'
  ) {
    return 'my-service';
  }

  switch (detail.type) {
    case 'boolean':
      return false;
    case 'number':
    case 'integer':
      return 0;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return 'my-value';
  }
}

async function getScaffolderRequestOptions(
  auth: AuthService,
  credentials: any,
): Promise<{ token: string } | undefined> {
  try {
    const { token } = await auth.getPluginRequestToken({
      onBehalfOf: credentials,
      targetPluginId: 'scaffolder',
    });

    return token ? { token } : undefined;
  } catch {
    return undefined;
  }
}

async function getTemplateParameterSchema(
  templateRef: string,
  scaffolderClient?: ScaffolderClient,
  requestOptions?: { token: string },
): Promise<TemplateParameterSchema | undefined> {
  if (!scaffolderClient) {
    return undefined;
  }

  try {
    return await scaffolderClient.getTemplateParameterSchema(
      templateRef,
      requestOptions,
    );
  } catch {
    return undefined;
  }
}
