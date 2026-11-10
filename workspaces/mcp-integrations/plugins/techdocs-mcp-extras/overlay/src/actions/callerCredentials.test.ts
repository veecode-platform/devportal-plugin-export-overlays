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

import { mockCredentials } from '@backstage/backend-test-utils';
import { actionsRegistryServiceMock } from '@backstage/backend-test-utils/alpha';
import {
  BackstageCredentials,
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Entity } from '@backstage/catalog-model';
import { ConfigReader } from '@backstage/config';
import { createTechDocsActions } from './index';

const mockTechDocsBackend = jest.fn();

// The actions build their own TechDocsService, which falls back to a dynamic
// import of node-fetch that Jest cannot run. The service gets the stand-in
// for the TechDocs backend as its fetch function instead.
jest.mock('../service', () => {
  const actual = jest.requireActual('../service');
  return {
    ...actual,
    TechDocsService: class extends actual.TechDocsService {
      constructor(config: unknown, logger: unknown, discovery: unknown) {
        super(config, logger, discovery, (...args: unknown[]) =>
          mockTechDocsBackend(...args),
        );
      }
    },
  };
});

const alice = mockCredentials.user('user:default/alice');
const admin = mockCredentials.user('user:default/admin');
const pluginService = mockCredentials.service('plugin-techdocs-mcp-extras');
const techdocsBaseUrl = 'http://localhost:7007/api/techdocs';

const createMockEntity = (name: string, hasTechDocs: boolean): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name,
    namespace: 'default',
    title: `${name} title`,
    description: `${name} description`,
    tags: ['test'],
    annotations: hasTechDocs ? { 'backstage.io/techdocs-ref': 'dir:.' } : {},
  },
  spec: { type: 'service', owner: 'team-test', lifecycle: 'production' },
});

const publicDocs = createMockEntity('public-service', true);
const plainService = createMockEntity('plain-service', false);
const restrictedDocs = createMockEntity('restricted-service', true);
const entities = [publicDocs, plainService, restrictedDocs];

const callerOf = (credentials?: BackstageCredentials): string => {
  const principal = (credentials as any)?.principal;
  return principal?.userEntityRef ?? `service:${principal?.subject}`;
};

// the admin and the plugin's own service credentials can read everything
const canReadAll = (credentials?: BackstageCredentials) =>
  [callerOf(admin), callerOf(pluginService)].includes(callerOf(credentials));

const bearerOf = (callerRef: string) =>
  `Bearer techdocs-token-for-${callerRef}`;

// the catalog hides the restricted entity from everyone else
const createCatalog = () => {
  const visibleTo = (credentials?: BackstageCredentials) =>
    entities.filter(
      entity => entity !== restrictedDocs || canReadAll(credentials),
    );
  return {
    getEntities: jest.fn(
      async (_request: unknown, options?: { credentials?: any }) => ({
        items: visibleTo(options?.credentials),
      }),
    ),
    getEntityByRef: jest.fn(
      async (
        ref: { kind: string; namespace: string; name: string },
        options?: { credentials?: any },
      ) =>
        visibleTo(options?.credentials).find(
          entity =>
            entity.kind.toLowerCase() === ref.kind.toLowerCase() &&
            entity.metadata.namespace === ref.namespace &&
            entity.metadata.name === ref.name,
        ),
    ),
  };
};

// the auth service mints a token that names the principal it is minted for
const createAuth = (ownCredentials?: BackstageCredentials) => ({
  getOwnServiceCredentials: ownCredentials
    ? jest.fn().mockResolvedValue(ownCredentials)
    : jest
        .fn()
        .mockRejectedValue(
          new Error('the own service credentials must not be used'),
        ),
  getPluginRequestToken: jest.fn(
    async (options: { onBehalfOf: any; targetPluginId: string }) => {
      const caller = callerOf(options.onBehalfOf);
      return { token: `${options.targetPluginId}-token-for-${caller}` };
    },
  ),
});

describe('TechDocs actions run as the caller', () => {
  let backendRequests: { url: string; authorization?: string }[];

  // the TechDocs backend answers 404 for an unknown entity, and for the
  // restricted entity unless the request carries a token that can read all
  const serveTechDocs = async (
    url: string,
    init?: { headers?: Record<string, string> },
  ) => {
    backendRequests.push({ url, authorization: init?.headers?.Authorization });
    const name = url.match(
      /\/(?:sync|static\/docs)\/[^/]+\/[^/]+\/([^/]+)/,
    )?.[1];
    const known = entities.some(entity => entity.metadata.name === name);
    const canRead = [callerOf(admin), callerOf(pluginService)].some(
      ref => init?.headers?.Authorization === bearerOf(ref),
    );
    if (!known || (name === 'restricted-service' && !canRead)) {
      return { ok: false, status: 404, statusText: 'Not Found' };
    }
    if (url.includes('/sync/')) {
      return {
        ok: true,
        text: async () => 'event: finish\ndata: {}\n\n',
      };
    }
    if (url.endsWith('/techdocs_metadata.json')) {
      return {
        ok: true,
        json: async () => ({
          site_name: 'Docs',
          build_timestamp: 1705313400000,
        }),
      };
    }
    return {
      ok: true,
      text: async () => '# Welcome\n\nThe documentation.',
    };
  };

  beforeEach(() => {
    backendRequests = [];
    mockTechDocsBackend.mockImplementation(serveTechDocs);
  });

  const setup = (ownCredentials?: BackstageCredentials) => {
    const actionsRegistry = actionsRegistryServiceMock();
    const catalog = createCatalog();
    const auth = createAuth(ownCredentials);
    createTechDocsActions({
      actionsRegistry,
      catalog: catalog as any,
      auth,
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as LoggerService,
      config: new ConfigReader({
        app: { baseUrl: 'http://localhost:3000' },
        backend: { baseUrl: 'http://localhost:7007' },
      }),
      discovery: {
        getBaseUrl: async () => techdocsBaseUrl,
      } as unknown as DiscoveryService,
    });
    const invoke = async (
      name: string,
      input: Record<string, string>,
      credentials: BackstageCredentials,
    ): Promise<any> => {
      const { output } = await actionsRegistry.invoke({
        id: `test:${name}`,
        input,
        credentials,
      });
      return output;
    };
    return { catalog, auth, invoke };
  };

  it('fetch-techdocs lists only what the catalog returns for the caller', async () => {
    const { catalog, auth, invoke } = setup();

    const asAlice = await invoke('fetch-techdocs', {}, alice);
    const asAdmin = await invoke('fetch-techdocs', {}, admin);

    expect(asAlice.entities.map((e: any) => e.name)).toEqual([
      'public-service',
    ]);
    expect(asAdmin.entities.map((e: any) => e.name).sort()).toEqual([
      'public-service',
      'restricted-service',
    ]);
    expect(catalog.getEntities).toHaveBeenCalledWith(expect.anything(), {
      credentials: alice,
    });
    expect(auth.getPluginRequestToken).toHaveBeenCalledWith({
      onBehalfOf: alice,
      targetPluginId: 'techdocs',
    });
    expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
  });

  it('analyze-techdocs-coverage does not count what the caller cannot read', async () => {
    const { catalog, auth, invoke } = setup();

    const asAlice = await invoke('analyze-techdocs-coverage', {}, alice);
    const asAdmin = await invoke('analyze-techdocs-coverage', {}, admin);

    expect(asAlice).toEqual({
      totalEntities: 2,
      entitiesWithDocs: 1,
      coveragePercentage: 50,
    });
    expect(asAdmin).toEqual({
      totalEntities: 3,
      entitiesWithDocs: 2,
      coveragePercentage: 66.7,
    });
    expect(catalog.getEntities).toHaveBeenCalledWith(expect.anything(), {
      credentials: alice,
    });
    expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
  });

  it('retrieve-techdocs-content reads the entity and the TechDocs backend as the caller', async () => {
    const { catalog, auth, invoke } = setup();

    const output = await invoke(
      'retrieve-techdocs-content',
      { entityRef: 'component:default/public-service', pagePath: 'guide.md' },
      alice,
    );

    expect(output.error).toBeUndefined();
    expect(output.content).toBe('# Welcome\n\nThe documentation.');
    expect(catalog.getEntityByRef).toHaveBeenCalledWith(
      { kind: 'component', namespace: 'default', name: 'public-service' },
      { credentials: alice },
    );
    expect(auth.getPluginRequestToken.mock.calls).toEqual(
      Array(3).fill([{ onBehalfOf: alice, targetPluginId: 'techdocs' }]),
    );
    expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
    expect(backendRequests).toEqual([
      {
        url: `${techdocsBaseUrl}/sync/default/component/public-service`,
        authorization: bearerOf('user:default/alice'),
      },
      {
        url: `${techdocsBaseUrl}/static/docs/default/component/public-service/guide.md`,
        authorization: bearerOf('user:default/alice'),
      },
      {
        url: `${techdocsBaseUrl}/static/docs/default/component/public-service/techdocs_metadata.json`,
        authorization: bearerOf('user:default/alice'),
      },
    ]);
  });

  it('retrieve-techdocs-content answers for a hidden entity as for a missing one', async () => {
    const { invoke } = setup();
    const retrieve = (name: string, credentials: BackstageCredentials) =>
      invoke(
        'retrieve-techdocs-content',
        { entityRef: `component:default/${name}`, pagePath: 'guide.md' },
        credentials,
      );
    const normalize = (value: unknown, name: string) =>
      JSON.parse(JSON.stringify(value).split(name).join('<name>'));

    const hidden = await retrieve('restricted-service', alice);
    const missing = await retrieve('missing-service', alice);
    const visibleToAdmin = await retrieve('restricted-service', admin);

    expect(hidden.content).toBe('');
    expect(hidden.error).toContain('TechDocs content not found');
    expect(normalize(hidden, 'restricted-service')).toEqual(
      normalize(missing, 'missing-service'),
    );
    expect(visibleToAdmin.error).toBeUndefined();
    expect(visibleToAdmin.content).toBe('# Welcome\n\nThe documentation.');
  });

  it('does not expose what only the service credentials can read', async () => {
    const { invoke } = setup(pluginService);

    const listed = await invoke('fetch-techdocs', {}, alice);
    const coverage = await invoke('analyze-techdocs-coverage', {}, alice);
    const content = await invoke(
      'retrieve-techdocs-content',
      {
        entityRef: 'component:default/restricted-service',
        pagePath: 'guide.md',
      },
      alice,
    );

    expect(listed.entities.map((e: any) => e.name)).toEqual(['public-service']);
    expect(coverage.totalEntities).toBe(2);
    expect(content.content).toBe('');
    expect(content.error).toContain('TechDocs content not found');
  });
});
