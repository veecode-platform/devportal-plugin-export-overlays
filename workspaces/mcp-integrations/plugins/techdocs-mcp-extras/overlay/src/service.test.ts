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

import { ConfigReader } from '@backstage/config';
import { TechDocsService, TechDocsMetadata } from './service';
import { Entity } from '@backstage/catalog-model';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { mockCredentials } from '@backstage/backend-test-utils';
import {
  BackstageCredentials,
  LoggerService,
  DiscoveryService,
} from '@backstage/backend-plugin-api';

describe('TechDocsService', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;

  const mockDiscovery = {
    getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007/api'),
  } as unknown as DiscoveryService;

  const mockConfig = new ConfigReader({
    app: {
      baseUrl: 'http://localhost:3000',
    },
    backend: {
      baseUrl: 'http://localhost:7007',
      auth: {
        externalAccess: [
          {
            type: 'static',
            options: {
              token: 'mock-static-token',
              subject: 'mcp-clients',
            },
          },
        ],
      },
    },
  });

  const mockAuth = {
    getOwnServiceCredentials: jest
      .fn()
      .mockRejectedValue(
        new Error('the own service credentials must not be used'),
      ),
    getPluginRequestToken: jest.fn().mockResolvedValue({
      token: 'mock-plugin-token',
    }),
  };

  const callerCredentials = mockCredentials.user('user:default/test');

  const createMockEntity = (
    name: string,
    kind: string = 'Component',
    hasTechDocs: boolean = false,
    options: Partial<Entity> = {},
  ): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind,
    metadata: {
      name,
      namespace: 'default',
      title: `${name} title`,
      description: `${name} description`,
      tags: ['test', 'mock'],
      annotations: hasTechDocs ? { 'backstage.io/techdocs-ref': 'dir:.' } : {},
      ...options.metadata,
    },
    spec: {
      type: 'service',
      owner: 'team-test',
      lifecycle: 'production',
      ...options.spec,
    },
  });

  const mockFetch = jest.fn();

  let service: TechDocsService;

  beforeEach(() => {
    service = new TechDocsService(
      mockConfig,
      mockLogger,
      mockDiscovery,
      mockFetch,
    );
    jest.clearAllMocks();
  });

  describe('generateTechDocsUrls', () => {
    it('should generate correct URLs for an entity', async () => {
      const entity = createMockEntity('test-service');
      const urls = await service.generateTechDocsUrls(entity);

      expect(urls).toEqual({
        techDocsUrl:
          'http://localhost:3000/docs/default/component/test-service',
        metadataUrl:
          'http://localhost:7007/api/catalog/entities/by-name/component/default/test-service',
      });
    });

    it('should handle different entity kinds', async () => {
      const entity = createMockEntity('test-api', 'API');
      const urls = await service.generateTechDocsUrls(entity);

      expect(urls).toEqual({
        techDocsUrl: 'http://localhost:3000/docs/default/api/test-api',
        metadataUrl:
          'http://localhost:7007/api/catalog/entities/by-name/api/default/test-api',
      });
    });

    it('should handle different namespaces', async () => {
      const entity = createMockEntity('test-service', 'Component', false, {
        metadata: { name: 'test-service', namespace: 'production' },
      });
      const urls = await service.generateTechDocsUrls(entity);

      expect(urls).toEqual({
        techDocsUrl:
          'http://localhost:3000/docs/production/component/test-service',
        metadataUrl:
          'http://localhost:7007/api/catalog/entities/by-name/component/production/test-service',
      });
    });
  });

  describe('fetchTechDocsMetadata', () => {
    it('should fetch metadata for an entity successfully', async () => {
      const entity = createMockEntity('test-service');
      const mockMetadata: TechDocsMetadata = {
        site_name: 'Test Service Docs',
        site_description: 'Documentation for test service',
        etag: 'abc123',
        build_timestamp: 1609459200,
        files: ['index.html', 'api.html'],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetadata),
      });

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result).toEqual(mockMetadata);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/static/docs/default/component/test-service/techdocs_metadata.json',
        { headers: {} },
      );
    });

    it('should handle errors gracefully and return error object', async () => {
      const entity = createMockEntity('test-service');
      mockFetch.mockRejectedValue(new Error('Metadata not found'));

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result.error).toBeDefined();
      expect(result.error).toContain(
        'Failed to fetch TechDocs metadata for Component:default/test-service',
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle different entity kinds and namespaces', async () => {
      const entity = createMockEntity('test-api', 'API', false, {
        metadata: { name: 'test-api', namespace: 'production' },
      });
      const mockMetadata: TechDocsMetadata = {
        site_name: 'Test API Docs',
        site_description: 'API documentation',
        etag: 'xyz789',
        build_timestamp: 1609459200,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetadata),
      });

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result).toEqual(mockMetadata);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/static/docs/production/api/test-api/techdocs_metadata.json',
        { headers: {} },
      );
    });

    it('should handle 404 response and return empty object', async () => {
      const entity = createMockEntity('test-service');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result).toEqual({});
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'TechDocs metadata not found for Component:default/test-service',
      );
    });

    it('should handle non-404 errors and return error in response', async () => {
      const entity = createMockEntity('test-service');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result.error).toBeDefined();
      expect(result.error).toContain(
        'Failed to fetch TechDocs metadata: 500 Internal Server Error',
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('listTechDocs', () => {
    it('should return entities with TechDocs annotation', async () => {
      const entitiesWithDocs = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('api-1', 'API', true),
      ];
      const entitiesWithoutDocs = [
        createMockEntity('service-2', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({
        entities: [...entitiesWithDocs, ...entitiesWithoutDocs],
      });

      // Mock metadata responses
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await service.listTechDocs(
        {},
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(result.entities).toHaveLength(2);
      expect(result.entities.map(e => e.name)).toContain('service-1');
      expect(result.entities.map(e => e.name)).toContain('api-1');
      expect(result.entities.map(e => e.name)).not.toContain('service-2');
    });

    it('should include URLs and metadata in the response', async () => {
      const entityWithDocs = createMockEntity(
        'service-with-docs',
        'Component',
        true,
      );
      const mockMetadata: TechDocsMetadata = {
        site_name: 'Service with Docs',
        site_description: 'Documentation for service with docs',
        etag: 'abc123',
        build_timestamp: 1609459200000,
        files: ['index.html'],
      };

      const mockCatalog = catalogServiceMock({
        entities: [entityWithDocs],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockMetadata),
      });

      const result = await service.listTechDocs(
        {},
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toEqual({
        name: 'service-with-docs',
        title: 'service-with-docs title',
        tags: 'test,mock',
        description: 'service-with-docs description',
        owner: 'team-test',
        lifecycle: 'production',
        namespace: 'default',
        kind: 'Component',
        techDocsUrl:
          'http://localhost:3000/docs/default/component/service-with-docs',
        metadataUrl:
          'http://localhost:7007/api/catalog/entities/by-name/component/default/service-with-docs',
        metadata: {
          lastUpdated: '2021-01-01T00:00:00.000Z',
          buildTimestamp: 1609459200000,
          siteName: 'Service with Docs',
          siteDescription: 'Documentation for service with docs',
          etag: 'abc123',
          files: 'index.html',
        },
      });
    });

    it('should read build_timestamp as milliseconds for lastUpdated', async () => {
      const entityWithDocs = createMockEntity(
        'service-with-ms-timestamp',
        'Component',
        true,
      );
      const mockCatalog = catalogServiceMock({
        entities: [entityWithDocs],
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          build_timestamp: 1792520320352,
        }),
      });

      const result = await service.listTechDocs(
        {},
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(result.entities[0].metadata).toMatchObject({
        lastUpdated: '2026-10-20T18:18:40.352Z',
        buildTimestamp: 1792520320352,
      });
    });

    it('should handle entities without metadata gracefully', async () => {
      const entityWithDocs = createMockEntity(
        'service-without-metadata',
        'Component',
        true,
      );
      const mockCatalog = catalogServiceMock({
        entities: [entityWithDocs],
      });

      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await service.listTechDocs(
        {},
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toEqual({
        name: 'service-without-metadata',
        title: 'service-without-metadata title',
        tags: 'test,mock',
        description: 'service-without-metadata description',
        owner: 'team-test',
        lifecycle: 'production',
        namespace: 'default',
        kind: 'Component',
        techDocsUrl:
          'http://localhost:3000/docs/default/component/service-without-metadata',
        metadataUrl:
          'http://localhost:7007/api/catalog/entities/by-name/component/default/service-without-metadata',
        metadata: undefined,
      });
    });

    it('should handle empty catalog', async () => {
      const mockCatalog = catalogServiceMock({ entities: [] });
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await service.listTechDocs(
        {},
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(result.entities).toHaveLength(0);
    });

    it('should filter by entity type', async () => {
      const entities = [
        createMockEntity('component-1', 'Component', true),
        createMockEntity('api-1', 'API', true),
        createMockEntity('system-1', 'System', true),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        { entityType: 'Component' },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { kind: 'Component' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by namespace', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          metadata: { name: 'service-1', namespace: 'production' },
        }),
        createMockEntity('service-2', 'Component', true, {
          metadata: { name: 'service-2', namespace: 'staging' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        { namespace: 'production' },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'metadata.namespace': 'production' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by owner', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          spec: { owner: 'team-a' },
        }),
        createMockEntity('service-2', 'Component', true, {
          spec: { owner: 'team-b' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        { owner: 'team-a' },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'spec.owner': 'team-a' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by lifecycle', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          spec: { lifecycle: 'production' },
        }),
        createMockEntity('service-2', 'Component', true, {
          spec: { lifecycle: 'experimental' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        { lifecycle: 'production' },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'spec.lifecycle': 'production' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by tags', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          metadata: { name: 'service-1', tags: ['frontend', 'react'] },
        }),
        createMockEntity('service-2', 'Component', true, {
          metadata: { name: 'service-2', tags: ['backend', 'node'] },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        { tags: 'frontend' },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'metadata.tags': ['frontend'] },
        }),
        expect.any(Object),
      );
    });

    it('should handle multiple filters', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          metadata: { name: 'service-1', namespace: 'production' },
          spec: { owner: 'team-a', lifecycle: 'production' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        {
          entityType: 'Component',
          namespace: 'production',
          owner: 'team-a',
          lifecycle: 'production',
        },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            kind: 'Component',
            'metadata.namespace': 'production',
            'spec.owner': 'team-a',
            'spec.lifecycle': 'production',
          },
        }),
        expect.any(Object),
      );
    });

    it('should respect limit option', async () => {
      const entities = [createMockEntity('service-1', 'Component', true)];
      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs(
        { limit: 100 },
        mockAuth,
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        }),
        expect.any(Object),
      );
    });

    it('should use default limit when not specified', async () => {
      const entities = [createMockEntity('service-1', 'Component', true)];
      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await service.listTechDocs({}, mockAuth, mockCatalog, callerCredentials);

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 500,
        }),
        expect.any(Object),
      );
    });
  });

  describe('analyzeCoverage', () => {
    it('should calculate correct coverage percentage', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', false),
        createMockEntity('service-3', 'Component', true),
        createMockEntity('service-4', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage(
        {},
        mockCatalog,
        callerCredentials,
      );

      expect(result).toEqual({
        totalEntities: 4,
        entitiesWithDocs: 2,
        coveragePercentage: 50.0,
      });
    });

    it('should handle 100% coverage', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', true),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage(
        {},
        mockCatalog,
        callerCredentials,
      );

      expect(result).toEqual({
        totalEntities: 2,
        entitiesWithDocs: 2,
        coveragePercentage: 100.0,
      });
    });

    it('should handle 0% coverage', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', false),
        createMockEntity('service-2', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage(
        {},
        mockCatalog,
        callerCredentials,
      );

      expect(result).toEqual({
        totalEntities: 2,
        entitiesWithDocs: 0,
        coveragePercentage: 0.0,
      });
    });

    it('should handle empty catalog', async () => {
      const mockCatalog = catalogServiceMock({ entities: [] });

      const result = await service.analyzeCoverage(
        {},
        mockCatalog,
        callerCredentials,
      );

      expect(result).toEqual({
        totalEntities: 0,
        entitiesWithDocs: 0,
        coveragePercentage: 0,
      });
    });

    it('should round coverage percentage to 1 decimal place', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', false),
        createMockEntity('service-3', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage(
        {},
        mockCatalog,
        callerCredentials,
      );

      expect(result.coveragePercentage).toBe(33.3);
    });

    it('should apply filters correctly', async () => {
      const entities = [
        createMockEntity('component-1', 'Component', true, {
          metadata: { name: 'component-1', namespace: 'production' },
          spec: { owner: 'team-a', lifecycle: 'production' },
        }),
        createMockEntity('component-2', 'Component', false, {
          metadata: { name: 'component-2', namespace: 'production' },
          spec: { owner: 'team-a', lifecycle: 'production' },
        }),
        createMockEntity('api-1', 'API', true, {
          metadata: { name: 'api-1', namespace: 'staging' },
          spec: { owner: 'team-b', lifecycle: 'experimental' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');

      await service.analyzeCoverage(
        {
          entityType: 'Component',
          namespace: 'production',
        },
        mockCatalog,
        callerCredentials,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            kind: 'Component',
            'metadata.namespace': 'production',
          },
        }),
        expect.any(Object),
      );
    });

    it('should log coverage analysis results', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      await service.analyzeCoverage({}, mockCatalog, callerCredentials);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Analyzing TechDocs coverage...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Coverage analysis complete: 1/2 entities (50.0%) have TechDocs',
      );
    });
  });

  describe('error handling', () => {
    it('should handle catalog service errors in listTechDocs', async () => {
      const mockCatalog = {
        getEntities: jest
          .fn()
          .mockRejectedValue(new Error('Catalog service error')),
      };

      await expect(
        service.listTechDocs(
          {},
          mockAuth,
          mockCatalog as any,
          callerCredentials,
        ),
      ).rejects.toThrow('Catalog service error');
    });

    it('should handle catalog service errors in analyzeCoverage', async () => {
      const mockCatalog = {
        getEntities: jest
          .fn()
          .mockRejectedValue(new Error('Catalog service error')),
      };

      await expect(
        service.analyzeCoverage({}, mockCatalog as any, callerCredentials),
      ).rejects.toThrow('Catalog service error');
    });
  });

  describe('retrieveTechDocsContent', () => {
    beforeEach(() => {
      mockFetch.mockClear();
      mockDiscovery.getBaseUrl = jest
        .fn()
        .mockResolvedValue('http://localhost:7007/api/techdocs');
    });

    it('should retrieve HTML content for entity', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      const mockHtmlContent =
        '<html><head><title>Test Service Docs</title></head><body><h1>Welcome</h1></body></html>';

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(mockHtmlContent),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            site_name: 'Test Service Docs',
            site_description: 'Documentation for test service',
            build_timestamp: 1705313400000,
          }),
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result).toEqual({
        entityRef: 'component:default/test-service',
        name: 'test-service',
        title: 'test-service title',
        kind: 'component',
        namespace: 'default',
        content: 'Test Service Docs\n\n# Welcome',
        pageTitle: 'Test Service Docs',
        path: 'index.html',
        contentType: 'text',
        lastModified: '2024-01-15T10:10:00.000Z',
        metadata: {
          lastUpdated: '2024-01-15T10:10:00.000Z',
          buildTimestamp: 1705313400000,
          siteName: 'Test Service Docs',
          siteDescription: 'Documentation for test service',
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/techdocs/static/docs/default/component/test-service/index.html',
        {
          headers: {
            Authorization: 'Bearer mock-plugin-token',
          },
        },
      );
    });

    it('should read build_timestamp as milliseconds for lastModified', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('# Test Service\n\nWelcome.'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            build_timestamp: 1792520320352,
          }),
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'docs/guide.md',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result).toMatchObject({
        lastModified: '2026-10-20T18:18:40.352Z',
        metadata: {
          lastUpdated: '2026-10-20T18:18:40.352Z',
          buildTimestamp: 1792520320352,
        },
      });
    });

    it('should handle markdown content type', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      const mockMarkdownContent =
        '# Test Service\n\nThis is the documentation.';
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue(mockMarkdownContent),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'docs/guide.md',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result?.contentType).toBe('markdown');
      expect(result?.content).toBe(mockMarkdownContent);
      expect(result?.path).toBe('docs/guide.md');
    });

    it('should use default index.html when no page path specified', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('<html></html>'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      await service.retrieveTechDocsContent(
        'component:default/test-service',
        undefined,
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/techdocs/static/docs/default/component/test-service/index.html',
        {
          headers: {
            Authorization: 'Bearer mock-plugin-token',
          },
        },
      );
    });

    it('should handle entity without TechDocs configured', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', false);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain('does not have TechDocs configured');
    });

    it('should handle 401 unauthorized error', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain(
        'Failed to fetch TechDocs content: 401 Unauthorized',
      );
    });

    it('should handle 500 server error', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain(
        'Failed to fetch TechDocs content: 500 Internal Server Error',
      );
    });

    it('should handle 404 response and return error', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain(
        'TechDocs content not found for component:default/test-service at path: index.html',
      );
      expect(result.error).toContain(
        'The documentation may not have been built yet',
      );
    });

    it('should handle invalid entity reference format', async () => {
      const result = await service.retrieveTechDocsContent(
        'invalid-ref-format',
        'index.html',
        mockAuth,
        {} as any,
        callerCredentials,
      );

      expect(result.error).toBeDefined();
      expect(result.error).toBe(
        'entityRef must be a valid entity reference (e.g. kind:namespace/name)',
      );
    });

    it('should handle entity reference with explicit namespace', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true, {
        metadata: { name: 'test-service', namespace: 'production' },
      });
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('<html></html>'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      await service.retrieveTechDocsContent(
        'component:production/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/techdocs/static/docs/production/component/test-service/index.html',
        {
          headers: {
            Authorization: 'Bearer mock-plugin-token',
          },
        },
      );
    });

    it('should work without auth service provided', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('<html></html>'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
      );

      expect(result?.entityRef).toBe('component:default/test-service');
      expect(result?.name).toBe('test-service');
      expect(result?.kind).toBe('component');
      expect(result?.namespace).toBe('default');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/techdocs/static/docs/default/component/test-service/index.html',
        { headers: {} },
      );
    });

    it('should reject entityRef that is not a valid entity reference', async () => {
      const invalidRefs = [
        'component:../../other',
        'component:default//other',
        'component:default/%2e%2e/other',
        'component:default\\other',
      ];
      for (const ref of invalidRefs) {
        const result = await service.retrieveTechDocsContent(ref, undefined);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('valid entity reference');
        expect(mockFetch).not.toHaveBeenCalled();
      }
    });

    it('should reject pagePath that is not a valid documentation path', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      const invalidPaths = [
        '../../../etc/passwd',
        'api//endpoints.html',
        'api%2f..%2fother',
        'docs\\..\\other',
      ];
      for (const path of invalidPaths) {
        const result = await service.retrieveTechDocsContent(
          'component:default/test-service',
          path,
          mockAuth,
          mockCatalog as any,
          callerCredentials,
        );
        expect(result.error).toBeDefined();
        expect(result.error).toContain('valid documentation path');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should request a sync before fetching content', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('event: finish\ndata: {}\n\n'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest
            .fn()
            .mockResolvedValue('<html><body><h1>Welcome</h1></body></html>'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            site_name: 'Test Service Docs',
            build_timestamp: 1705313400,
          }),
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(mockFetch.mock.calls[0]).toEqual([
        'http://localhost:7007/api/techdocs/sync/default/component/test-service',
        { headers: { Authorization: 'Bearer mock-plugin-token' } },
      ]);
      expect(result.content).toBeTruthy();
    });

    it('should proceed to content fetch when sync fails', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest
            .fn()
            .mockResolvedValue('<html><body><h1>Welcome</h1></body></html>'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            site_name: 'Test Service Docs',
            build_timestamp: 1705313400,
          }),
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result.content).toBeTruthy();
      expect(result.error).toBeUndefined();
    });

    it('should proceed when sync request rejects', async () => {
      const mockEntity = createMockEntity('test-service', 'Component', true);
      const mockCatalog = {
        getEntityByRef: jest.fn().mockResolvedValue(mockEntity),
      };

      mockFetch
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          ok: true,
          text: jest
            .fn()
            .mockResolvedValue('<html><body><h1>Welcome</h1></body></html>'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            site_name: 'Test Service Docs',
            build_timestamp: 1705313400,
          }),
        });

      const result = await service.retrieveTechDocsContent(
        'component:default/test-service',
        'index.html',
        mockAuth,
        mockCatalog as any,
        callerCredentials,
      );

      expect(result.content).toBeTruthy();
      expect(result.error).toBeUndefined();
    });
  });

  describe('caller credentials', () => {
    const alice = mockCredentials.user('user:default/alice');
    const admin = mockCredentials.user('user:default/admin');
    const pluginService = mockCredentials.service('plugin-techdocs-mcp-extras');

    const publicDocs = createMockEntity('public-service', 'Component', true);
    const plainService = createMockEntity('plain-service', 'Component', false);
    const restrictedDocs = createMockEntity(
      'restricted-service',
      'Component',
      true,
    );
    const entities = [publicDocs, plainService, restrictedDocs];

    const callerOf = (credentials?: BackstageCredentials): string => {
      const principal = (credentials as any)?.principal;
      return principal?.userEntityRef ?? `service:${principal?.subject}`;
    };

    // the admin and the plugin's own service credentials can read everything
    const canReadAll = (credentials?: BackstageCredentials) =>
      [callerOf(admin), callerOf(pluginService)].includes(
        callerOf(credentials),
      );

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

    const bearerOf = (callerRef: string) =>
      `Bearer techdocs-token-for-${callerRef}`;

    // the TechDocs backend answers 404 for an unknown entity, and for the
    // restricted entity unless the request carries a token that can read all
    const serveTechDocs = async (
      url: string,
      init?: { headers?: Record<string, string> },
    ) => {
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
      mockFetch.mockImplementation(serveTechDocs);
      mockDiscovery.getBaseUrl = jest
        .fn()
        .mockResolvedValue('http://localhost:7007/api/techdocs');
    });

    describe('listTechDocs', () => {
      it('reads the catalog and the TechDocs backend as the caller', async () => {
        const auth = createAuth();
        const catalog = createCatalog();

        const result = await service.listTechDocs(
          {},
          auth,
          catalog as any,
          alice,
        );

        expect(result.entities.map(e => e.name)).toEqual(['public-service']);
        expect(catalog.getEntities).toHaveBeenCalledWith(expect.anything(), {
          credentials: alice,
        });
        expect(auth.getPluginRequestToken).toHaveBeenCalledWith({
          onBehalfOf: alice,
          targetPluginId: 'techdocs',
        });
        expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:7007/api/techdocs/static/docs/default/component/public-service/techdocs_metadata.json',
          { headers: { Authorization: bearerOf('user:default/alice') } },
        );
      });

      it('does not list an entity the catalog hides from the caller', async () => {
        const catalog = createCatalog();

        const asAlice = await service.listTechDocs(
          {},
          createAuth(),
          catalog as any,
          alice,
        );
        const asAdmin = await service.listTechDocs(
          {},
          createAuth(),
          catalog as any,
          admin,
        );

        expect(asAlice.entities.map(e => e.name)).toEqual(['public-service']);
        expect(asAdmin.entities.map(e => e.name).sort()).toEqual([
          'public-service',
          'restricted-service',
        ]);
      });
    });

    describe('analyzeCoverage', () => {
      it('counts only the entities the catalog returns for the caller', async () => {
        const catalog = createCatalog();

        const asAlice = await service.analyzeCoverage(
          {},
          catalog as any,
          alice,
        );
        const asAdmin = await service.analyzeCoverage(
          {},
          catalog as any,
          admin,
        );

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
        expect(catalog.getEntities).toHaveBeenCalledWith(expect.anything(), {
          credentials: admin,
        });
      });
    });

    describe('fetchTechDocsMetadata', () => {
      it('mints the TechDocs token on behalf of the caller', async () => {
        const auth = createAuth();

        await service.fetchTechDocsMetadata(publicDocs, auth, alice);

        expect(auth.getPluginRequestToken).toHaveBeenCalledWith({
          onBehalfOf: alice,
          targetPluginId: 'techdocs',
        });
        expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
          headers: { Authorization: bearerOf('user:default/alice') },
        });
      });
    });

    describe('retrieveTechDocsContent', () => {
      it('reads the entity, the sync, the content and the metadata as the caller', async () => {
        const auth = createAuth();
        const catalog = createCatalog();

        const result = await service.retrieveTechDocsContent(
          'component:default/public-service',
          'docs/guide.md',
          auth,
          catalog as any,
          alice,
        );

        expect(result.error).toBeUndefined();
        expect(result.content).toBe('# Welcome\n\nThe documentation.');
        expect(catalog.getEntityByRef).toHaveBeenCalledWith(
          {
            kind: 'component',
            namespace: 'default',
            name: 'public-service',
          },
          { credentials: alice },
        );
        expect(auth.getPluginRequestToken.mock.calls).toEqual(
          Array(3).fill([{ onBehalfOf: alice, targetPluginId: 'techdocs' }]),
        );
        expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
        expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
          'http://localhost:7007/api/techdocs/sync/default/component/public-service',
          'http://localhost:7007/api/techdocs/static/docs/default/component/public-service/docs/guide.md',
          'http://localhost:7007/api/techdocs/static/docs/default/component/public-service/techdocs_metadata.json',
        ]);
        for (const [, init] of mockFetch.mock.calls) {
          expect(init).toEqual({
            headers: { Authorization: bearerOf('user:default/alice') },
          });
        }
      });

      it('answers for an entity hidden from the caller as for a missing entity', async () => {
        const catalog = createCatalog();
        const retrieve = (entityRef: string, credentials: any) =>
          service.retrieveTechDocsContent(
            entityRef,
            'guide.md',
            createAuth(),
            catalog as any,
            credentials,
          );
        const normalize = (value: unknown, name: string) =>
          JSON.parse(JSON.stringify(value).split(name).join('<name>'));

        const hidden = await retrieve(
          'component:default/restricted-service',
          alice,
        );
        const missing = await retrieve(
          'component:default/missing-service',
          alice,
        );
        const visibleToAdmin = await retrieve(
          'component:default/restricted-service',
          admin,
        );

        expect(hidden.content).toBe('');
        expect(hidden.error).toContain('TechDocs content not found');
        expect(normalize(hidden, 'restricted-service')).toEqual(
          normalize(missing, 'missing-service'),
        );
        expect(visibleToAdmin.error).toBeUndefined();
        expect(visibleToAdmin.content).toBe('# Welcome\n\nThe documentation.');
      });

      it('does not fall back to the service credentials for a hidden entity', async () => {
        const auth = createAuth(pluginService);

        const result = await service.retrieveTechDocsContent(
          'component:default/restricted-service',
          'guide.md',
          auth,
          createCatalog() as any,
          alice,
        );

        expect(result.content).toBe('');
        expect(result.error).toContain('TechDocs content not found');
        expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
      });

      it('reads nothing when the caller credentials are missing', async () => {
        const auth = createAuth();
        const catalog = createCatalog();

        const result = await service.retrieveTechDocsContent(
          'component:default/public-service',
          'index.html',
          auth,
          catalog as any,
        );

        expect(result.content).toBe('');
        expect(result.error).toContain('credentials of the caller');
        expect(catalog.getEntityByRef).not.toHaveBeenCalled();
        expect(auth.getPluginRequestToken).not.toHaveBeenCalled();
        expect(auth.getOwnServiceCredentials).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });
});
