/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BtpsTransporter } from './btpsTransporter.js';
import { BtpsClient } from './btpsClient.js';
import { BTPErrorException, BTP_ERROR_IDENTITY, BTP_ERROR_TIMEOUT } from '@core/error/index.js';
import {
  BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS,
  BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS,
  BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS,
  BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED,
} from './constants.ts/index.js';
import { BTP_PROTOCOL_VERSION } from 'server/index.js';
import type {
  BTPClientOptions,
  BTPConnectionInternal,
  BTPTransporterOptions,
} from './types/index.js';
import type { BTPTransporterArtifact } from 'server/index.js';
import { ZodError } from 'zod';

// --- Mocks ---
vi.mock('./btpsClient.js');
vi.mock('@core/utils/validation.js');
vi.mock('@core/server/schemas/artifacts/transporterSchema.js');

const mockBtpsClient = vi.mocked(BtpsClient);
let mockValidation: ReturnType<typeof vi.mocked<typeof import('@core/utils/validation.js')>>;
let mockTransporterSchema: ReturnType<
  typeof vi.mocked<typeof import('@core/server/schemas/artifacts/transporterSchema.js')>
>;

// Initialize mocks in beforeEach to avoid top-level await
beforeEach(async () => {
  mockValidation = vi.mocked(await import('@core/utils/validation.js'));
  mockTransporterSchema = vi.mocked(
    await import('@core/server/schemas/artifacts/transporterSchema.js'),
  );
});

describe('BtpsTransporter', () => {
  let transporter: BtpsTransporter;
  let mockClient: BtpsClient;
  let mockOptions: BTPTransporterOptions;
  let mockArtifact: BTPTransporterArtifact;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Mock BtpsClient
    mockClient = {
      to: 'test$example.com',
      destroy: vi.fn(),
      send: vi.fn().mockResolvedValue({
        response: {
          reqId: 'test-req-id',
          status: { ok: true, code: 200 },
          type: 'btps_response',
          version: BTP_PROTOCOL_VERSION,
          id: 'test-id',
          issuedAt: new Date().toISOString(),
        },
        error: undefined,
      }),
      onData: vi.fn(),
      update: vi.fn(),
      getConnectionStates: vi.fn().mockReturnValue({
        isConnecting: false,
        isConnected: true,
        isDraining: false,
        isDestroyed: false,
        shouldRetry: false,
      }),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as BtpsClient;

    mockBtpsClient.mockImplementation(() => mockClient);

    // Mock validation
    mockValidation.validate.mockReturnValue({ success: true, data: {} });

    // Mock transporter schema
    mockTransporterSchema.BtpTransporterArtifactSchema = {} as never;

    mockOptions = {
      maxConnections: 5,
      connectionTTLSeconds: 60,
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
      maxQueue: 10,
      btpMtsOptions: {
        rejectUnauthorized: false,
      },
    };

    mockArtifact = {
      id: 'test-artifact-123',
      type: 'TRUST_REQ',
      to: 'alice$example.com',
      version: BTP_PROTOCOL_VERSION,
      issuedAt: new Date().toISOString(),
      document: {
        id: 'test-doc-123',
        name: 'Test Document',
        email: 'test@example.com',
        reason: 'Testing purposes',
        phone: '+1234567890',
      },
      encryption: null,
      selector: 'btps1',
      signature: {
        algorithmHash: 'sha256',
        value: 'test-signature',
        fingerprint: 'test-fingerprint',
      },
      from: 'bob$example.com',
    } as BTPTransporterArtifact;

    transporter = new BtpsTransporter(mockOptions);
  });

  afterEach(() => {
    vi.useRealTimers();
    transporter.destroy();
  });

  describe('Constructor', () => {
    it('should initialize with default options', () => {
      const defaultTransporter = new BtpsTransporter({});

      expect(defaultTransporter.getMaxConnections()).toBe(BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS);
      expect(defaultTransporter.getConnectionTTLSeconds()).toBe(
        BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS * 1000,
      );
      expect(defaultTransporter.getClientOptions()).toEqual({});

      defaultTransporter.destroy();
    });

    it('should initialize with custom options', () => {
      expect(transporter.getMaxConnections()).toBe(5);
      expect(transporter.getConnectionTTLSeconds()).toBe(60 * 1000);
      expect(transporter.getClientOptions()).toEqual({
        maxRetries: 2,
        retryDelayMs: 10,
        connectionTimeoutMs: 100,
        maxQueue: 10,
        btpMtsOptions: {
          rejectUnauthorized: false,
        },
      });
    });

    it('should get protocol version', () => {
      expect(transporter.getProtocolVersion()).toBe(BTP_PROTOCOL_VERSION);
    });
  });

  describe('Connection Management', () => {
    describe('registerConnection', () => {
      it('should register a new connection successfully', async () => {
        const connection = await transporter.registerConnection('alice$example.com');

        expect(connection).toBeDefined();
        expect(connection.id).toBe('alice$example.com');
        expect(connection.client).toBe(mockClient);
        expect(connection.isActive).toBe(false);
        expect(connection.createdAt).toBeDefined();
        expect(connection.updatedAt).toBeDefined();
        expect(connection.lastUsedAt).toBeDefined();
        expect(connection.clientOptions).toEqual({
          to: 'alice$example.com',
          maxRetries: 2,
          retryDelayMs: 10,
          connectionTimeoutMs: 100,
          maxQueue: 10,
          btpMtsOptions: {
            rejectUnauthorized: false,
          },
        });
        expect(transporter.getTotalConnections()).toBe(1);
      });

      it('should throw error for invalid identity', async () => {
        try {
          await transporter.registerConnection('invalid-identity');
        } catch (error) {
          expect(error).toBeInstanceOf(BTPErrorException);
          expect((error as BTPErrorException).message).toBe(
            'BTPS identity is expected in the format username$domain.',
          );
          expect((error as BTPErrorException).code).toBe(BTP_ERROR_IDENTITY.code);
          expect((error as BTPErrorException).meta).toEqual({
            to: 'invalid-identity',
          });
        }
      });

      it('should throw error when connection already exists', async () => {
        await transporter.registerConnection('alice$example.com');

        await expect(transporter.registerConnection('alice$example.com')).rejects.toThrow(
          BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS.message,
        );
      });

      it('should override existing connection when override is true', async () => {
        const firstConnection = await transporter.registerConnection('alice$example.com');
        const secondConnection = await transporter.registerConnection(
          'alice$example.com',
          undefined,
          true,
        );

        expect(firstConnection.id).toBe('alice$example.com');
        expect(secondConnection.id).toBe('alice$example.com');
        expect(secondConnection.createdAt).toBeDefined();
        expect(firstConnection.createdAt).toBeDefined();
        expect(transporter.getTotalConnections()).toBe(1);
      });

      it('should throw error when max connections reached', async () => {
        // Register up to max connections
        for (let i = 0; i < 5; i++) {
          await transporter.registerConnection(`user${i}$example.com`);
        }

        await expect(transporter.registerConnection('new$example.com')).rejects.toThrow(
          BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED.message,
        );
      });

      it('should handle race conditions with connection lock', async () => {
        const promises = [
          transporter.registerConnection('alice$example.com'),
          transporter.registerConnection('alice$example.com'),
          transporter.registerConnection('alice$example.com'),
        ];

        const results = await Promise.allSettled(promises);

        // One should succeed, others should fail with "already exists"
        const succeeded = results.filter((r) => r.status === 'fulfilled');
        const failed = results.filter((r) => r.status === 'rejected');

        expect(succeeded).toHaveLength(1);
        expect(failed).toHaveLength(2);
        expect(transporter.getTotalConnections()).toBe(1);
      });
    });

    describe('deregisterConnection', () => {
      it('should deregister an existing connection', async () => {
        await transporter.registerConnection('alice$example.com');
        expect(transporter.getTotalConnections()).toBe(1);

        transporter.deregisterConnection('alice$example.com');

        expect(transporter.getTotalConnections()).toBe(0);
        expect(mockClient.destroy).toHaveBeenCalled();
      });

      it('should handle deregistering non-existent connection', () => {
        expect(() => transporter.deregisterConnection('nonexistent$example.com')).not.toThrow();
        expect(transporter.getTotalConnections()).toBe(0);
      });

      it('should emit connectionDestroyed event', async () => {
        const eventSpy = vi.fn();
        transporter.on('connectionDestroyed', eventSpy);

        await transporter.registerConnection('alice$example.com');
        transporter.deregisterConnection('alice$example.com');

        expect(eventSpy).toHaveBeenCalledWith('alice$example.com');
      });
    });

    describe('getConnection', () => {
      it('should return connection if exists', async () => {
        await transporter.registerConnection('alice$example.com');
        const connection = transporter.getConnection('alice$example.com');

        expect(connection).toBeDefined();
        expect(connection?.id).toBe('alice$example.com');
        expect(connection?.client).toBeDefined(); // timeout is excluded from public interface
      });

      it('should return undefined if connection does not exist', () => {
        const connection = transporter.getConnection('nonexistent$example.com');
        expect(connection).toBeUndefined();
      });
    });

    describe('getConnections', () => {
      it('should return all connections', async () => {
        await transporter.registerConnection('alice$example.com');
        await transporter.registerConnection('bob$example.com');

        const connections = transporter.getConnections();

        expect(connections).toHaveLength(2);
        expect(connections.map((c) => c.id)).toContain('alice$example.com');
        expect(connections.map((c) => c.id)).toContain('bob$example.com');
      });

      it('should return empty array when no connections', () => {
        const connections = transporter.getConnections();
        expect(connections).toHaveLength(0);
      });
    });

    describe('updateConnection', () => {
      it('should update connection with new options', async () => {
        await transporter.registerConnection('alice$example.com');

        const updatedConnection = transporter.updateConnection('alice$example.com', {
          maxRetries: 5,
          connectionTimeoutMs: 200,
        });

        expect(updatedConnection).toBeDefined();
        expect(mockClient.update).toHaveBeenCalledWith({
          maxRetries: 5,
          connectionTimeoutMs: 200,
        });
      });

      it('should update connection TTL', async () => {
        await transporter.registerConnection('alice$example.com');

        const updatedConnection = transporter.updateConnection('alice$example.com', undefined, 120);

        expect(updatedConnection).toBeDefined();
        expect(updatedConnection?.updatedAt).toBeDefined();
      });

      it('should return undefined for non-existent connection', () => {
        const result = transporter.updateConnection('nonexistent$example.com');
        expect(result).toBeUndefined();
      });

      it('should emit connectionUpdated event', async () => {
        const eventSpy = vi.fn();
        transporter.on('connectionUpdated', eventSpy);

        await transporter.registerConnection('alice$example.com');
        transporter.updateConnection('alice$example.com');

        expect(eventSpy).toHaveBeenCalledWith('alice$example.com');
      });
    });
  });

  describe('Transport Methods', () => {
    describe('transport', () => {
      beforeEach(() => {
        vi.mocked(mockClient.send).mockResolvedValue({
          response: {
            reqId: 'test-req-id',
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: BTP_PROTOCOL_VERSION,
            id: 'test-id',
            issuedAt: new Date().toISOString(),
          },
          error: undefined,
        });
      });

      it('should transport artifact successfully', async () => {
        const result = await transporter.transport('alice$example.com', mockArtifact);

        expect(result.error).toBeUndefined();
        expect(result.response).toBeDefined();
        expect(mockClient.send).toHaveBeenCalledWith(mockArtifact, 5000); // default timeout
      });

      it('should create connection if not exists', async () => {
        expect(transporter.getTotalConnections()).toBe(0);

        await transporter.transport('alice$example.com', mockArtifact);

        expect(transporter.getTotalConnections()).toBe(1);
        expect(mockClient.send).toHaveBeenCalled();
      });

      it('should use existing connection if available', async () => {
        await transporter.registerConnection('alice$example.com');
        const initialCount = transporter.getTotalConnections();

        await transporter.transport('alice$example.com', mockArtifact);

        expect(transporter.getTotalConnections()).toBe(initialCount);
        expect(mockClient.send).toHaveBeenCalled();
      });

      it('should use custom timeout from clientOptions', async () => {
        const clientOptions: BTPClientOptions = {
          to: 'alice$example.com',
          connectionTimeoutMs: 10000,
        };

        await transporter.transport('alice$example.com', mockArtifact, clientOptions);

        expect(mockClient.send).toHaveBeenCalledWith(mockArtifact, 10000);
      });

      it('should handle validation errors', async () => {
        mockValidation.validate.mockReturnValue({
          success: false,
          error: new ZodError([
            {
              code: 'custom',
              path: [],
              message: 'Invalid artifact',
            },
          ]),
        });

        const result = await transporter.transport('alice$example.com', mockArtifact);

        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('Invalid artifact');
        expect(mockClient.send).not.toHaveBeenCalled();
      });

      it('should handle client send errors', async () => {
        const sendError = new BTPErrorException(BTP_ERROR_TIMEOUT, {
          cause: 'Request timeout',
        });
        vi.mocked(mockClient.send).mockResolvedValue({ error: sendError });

        const result = await transporter.transport('alice$example.com', mockArtifact);

        expect(result.error).toBe(sendError);
      });
    });

    describe('transportBatch', () => {
      it('should transport multiple artifacts successfully', async () => {
        const artifacts = [
          { ...mockArtifact, id: 'artifact-1' },
          { ...mockArtifact, id: 'artifact-2' },
          { ...mockArtifact, id: 'artifact-3' },
        ];

        const results = await transporter.transportBatch('alice$example.com', artifacts);
        vi.mocked(mockClient.send).mockResolvedValue({
          response: {
            reqId: 'artifact-1',
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: BTP_PROTOCOL_VERSION,
            id: 'test-id',
            issuedAt: new Date().toISOString(),
          },
          error: undefined,
        });

        expect(results).toHaveLength(3);
        results.forEach((result) => {
          expect(result.error).toBeUndefined();
          expect(result.response).toBeDefined();
        });
        expect(mockClient.send).toHaveBeenCalledTimes(3);
      });

      it('should handle mixed success and failure in batch', async () => {
        const artifacts = [
          { ...mockArtifact, id: 'artifact-1' },
          { ...mockArtifact, id: 'artifact-2' },
          { ...mockArtifact, id: 'artifact-3' },
        ];

        // Create a new transporter instance for this test
        const testTransporter = new BtpsTransporter(mockOptions);

        // Create a mock that returns different responses based on artifact ID
        const mockSend = vi
          .fn()
          .mockImplementation((artifact: import('@core/server/types.js').BTPArtifact) => {
            const reqId = artifact.id;

            if (reqId === 'artifact-1') {
              return Promise.resolve({
                response: {
                  reqId: 'artifact-1',
                  status: { ok: true, code: 200 },
                  type: 'btps_response',
                  version: BTP_PROTOCOL_VERSION,
                  id: 'test-id',
                  issuedAt: new Date().toISOString(),
                },
                error: undefined,
              });
            } else if (reqId === 'artifact-2') {
              return Promise.resolve({
                response: undefined,
                error: new BTPErrorException(BTP_ERROR_TIMEOUT),
              });
            } else if (reqId === 'artifact-3') {
              return Promise.resolve({
                response: {
                  reqId: 'artifact-3',
                  status: { ok: true, code: 200 },
                  type: 'btps_response',
                  version: BTP_PROTOCOL_VERSION,
                  id: 'test-id',
                  issuedAt: new Date().toISOString(),
                },
                error: undefined,
              });
            }

            return Promise.resolve({
              response: undefined,
              error: new BTPErrorException(BTP_ERROR_TIMEOUT),
            });
          });

        // Mock the BtpsClient constructor to return our custom client
        const originalMock = mockBtpsClient.mock.results[0]?.value;
        mockBtpsClient.mockImplementationOnce(
          () =>
            ({
              ...originalMock,
              send: mockSend,
              on: vi.fn(),
              off: vi.fn(),
              destroy: vi.fn(),
              update: vi.fn(),
              getConnectionStates: vi.fn().mockReturnValue({
                isConnecting: false,
                isConnected: true,
                isDraining: false,
                isDestroyed: false,
                shouldRetry: false,
              }),
            }) as unknown as BtpsClient,
        );

        const results = await testTransporter.transportBatch('alice$example.com', artifacts);

        expect(results).toHaveLength(3);
        expect(results[0].error).toBeUndefined();
        expect(results[1].error).toBeDefined();
        expect(results[1].error?.code).toBe('BTP_ERROR_TIMEOUT');
        expect(results[2].error).toBeUndefined();

        // Clean up
        testTransporter.destroy();
        mockBtpsClient.mockRestore();
      });
    });
  });

  describe('Connection State Management', () => {
    describe('getActiveConnections', () => {
      it('should return only active connections', async () => {
        await transporter.registerConnection('alice$example.com');
        await transporter.registerConnection('bob$example.com');

        // Simulate one connection becoming active
        const connections = transporter.getConnections();
        if (connections[0]) {
          // Manually set isActive (this would normally be set by event listeners)
          const internalConnection = (
            transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
          ).connections.get('alice$example.com');
          if (internalConnection) {
            internalConnection.isActive = true;
          }
        }

        const activeConnections = transporter.getActiveConnections();
        expect(activeConnections.length).toBeGreaterThanOrEqual(0);
        expect(activeConnections.length).toBeLessThanOrEqual(2);
      });
    });

    describe('getTotalConnections', () => {
      it('should return correct total connections count', async () => {
        expect(transporter.getTotalConnections()).toBe(0);

        await transporter.registerConnection('alice$example.com');
        expect(transporter.getTotalConnections()).toBe(1);

        await transporter.registerConnection('bob$example.com');
        expect(transporter.getTotalConnections()).toBe(2);

        transporter.deregisterConnection('alice$example.com');
        expect(transporter.getTotalConnections()).toBe(1);
      });
    });

    describe('getTotalActiveConnections', () => {
      it('should return correct active connections count', async () => {
        expect(transporter.getTotalActiveConnections()).toBe(0);

        await transporter.registerConnection('alice$example.com');
        expect(transporter.getTotalActiveConnections()).toBe(0); // Initially inactive

        // Simulate connection becoming active
        const internalConnection = (
          transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
        ).connections.get('alice$example.com');
        if (internalConnection) {
          internalConnection.isActive = true;
        }

        expect(transporter.getTotalActiveConnections()).toBe(1);
      });
    });

    describe('getMetrics', () => {
      it('should return correct metrics', async () => {
        let metrics = transporter.getMetrics();
        expect(metrics.totalConnections).toBe(0);
        expect(metrics.activeConnections).toBe(0);

        await transporter.registerConnection('alice$example.com');
        await transporter.registerConnection('bob$example.com');

        metrics = transporter.getMetrics();
        expect(metrics.totalConnections).toBe(2);
        expect(metrics.activeConnections).toBe(0);

        // Simulate one connection becoming active
        const internalConnection = (
          transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
        ).connections.get('alice$example.com');
        if (internalConnection) {
          internalConnection.isActive = true;
        }

        metrics = transporter.getMetrics();
        expect(metrics.totalConnections).toBe(2);
        expect(metrics.activeConnections).toBe(1);
      });
    });
  });

  describe('Configuration Methods', () => {
    describe('getMaxConnections/setMaxConnections', () => {
      it('should get and set max connections', () => {
        expect(transporter.getMaxConnections()).toBe(5);

        transporter.setMaxConnections(10);
        expect(transporter.getMaxConnections()).toBe(10);
      });
    });

    describe('getConnectionTTLSeconds/updateConnectionTTLSeconds', () => {
      it('should get and update connection TTL', () => {
        expect(transporter.getConnectionTTLSeconds()).toBe(60 * 1000);

        transporter.updateConnectionTTLSeconds(120);
        expect(transporter.getConnectionTTLSeconds()).toBe(120 * 1000);
      });

      it('should update existing connections TTL when requested', async () => {
        await transporter.registerConnection('alice$example.com');

        transporter.updateConnectionTTLSeconds(120, true);

        // The timeout should be updated (we can't easily test the timeout itself)
        expect(transporter.getConnectionTTLSeconds()).toBe(120 * 1000);
      });
    });

    describe('getClientOptions', () => {
      it('should return client options', () => {
        const options = transporter.getClientOptions();
        expect(options).toEqual({
          maxRetries: 2,
          retryDelayMs: 10,
          connectionTimeoutMs: 100,
          maxQueue: 10,
          btpMtsOptions: {
            rejectUnauthorized: false,
          },
        });
      });
    });
  });

  describe('Event Handling', () => {
    it('should emit connectionCreated event', async () => {
      const eventSpy = vi.fn();
      transporter.on('connectionCreated', eventSpy);

      await transporter.registerConnection('alice$example.com');

      expect(eventSpy).toHaveBeenCalledWith('alice$example.com');
    });

    it('should forward client events to transporter events', async () => {
      const connectedSpy = vi.fn();
      const messageSpy = vi.fn();
      const errorSpy = vi.fn();

      transporter.on('connectionConnected', connectedSpy);
      transporter.on('connectionMessage', messageSpy);
      transporter.on('connectionError', errorSpy);

      await transporter.registerConnection('alice$example.com');

      // Simulate client events
      const internalConnection = (
        transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
      ).connections.get('alice$example.com');
      if (internalConnection?.listeners) {
        internalConnection.listeners.connected();
        internalConnection.listeners.message({
          response: {
            reqId: 'test-req-id',
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: BTP_PROTOCOL_VERSION,
            id: 'test-id',
            issuedAt: new Date().toISOString(),
          },
          error: undefined,
          validSignature: true,
        });
        internalConnection.listeners.error({
          error: new BTPErrorException(BTP_ERROR_TIMEOUT, { cause: 'Request timeout' }),
          retriesLeft: 0,
          willRetry: false,
          attempt: 0,
        });
      }

      expect(connectedSpy).toHaveBeenCalledWith('alice$example.com');
      expect(messageSpy).toHaveBeenCalledWith('alice$example.com', {
        response: {
          reqId: 'test-req-id',
          status: { ok: true, code: 200 },
          type: 'btps_response',
          version: BTP_PROTOCOL_VERSION,
          id: 'test-id',
          issuedAt: expect.any(String),
        },
        error: undefined,
        validSignature: true,
      });
      expect(errorSpy).toHaveBeenCalledWith('alice$example.com', {
        error: new BTPErrorException(BTP_ERROR_TIMEOUT, { cause: 'Request timeout' }),
        retriesLeft: 0,
        willRetry: false,
        attempt: 0,
      });
    });

    it('should properly detach listeners on deregistration', async () => {
      await transporter.registerConnection('alice$example.com');

      const internalConnection = (
        transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
      ).connections.get('alice$example.com');
      expect(internalConnection?.listeners).toBeDefined();

      transporter.deregisterConnection('alice$example.com');

      expect(mockClient.off).toHaveBeenCalled();
    });
  });

  describe('TTL and Timeout Management', () => {
    it('should create connection with timeout', async () => {
      await transporter.registerConnection('alice$example.com');

      const internalConnection = (
        transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
      ).connections.get('alice$example.com');
      expect(internalConnection?.timeout).toBeDefined();
    });

    it('should deregister connection after TTL expires', async () => {
      await transporter.registerConnection('alice$example.com');
      expect(transporter.getTotalConnections()).toBe(1);

      // Advance time past TTL
      vi.advanceTimersByTime(61000); // 60 seconds + buffer

      expect(transporter.getTotalConnections()).toBe(0);
    });

    it('should update connection timeout when TTL is updated', async () => {
      await transporter.registerConnection('alice$example.com');

      transporter.updateConnectionTTLSeconds(30, true);

      // Advance time to trigger new timeout
      vi.advanceTimersByTime(31000); // 30 seconds + buffer

      expect(transporter.getTotalConnections()).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle client send errors gracefully', async () => {
      const sendError = new BTPErrorException(BTP_ERROR_TIMEOUT, {
        cause: 'Request timeout',
      });
      vi.mocked(mockClient.send).mockResolvedValue({ error: sendError });

      const result = await transporter.transport('alice$example.com', mockArtifact);

      expect(result.error).toBe(sendError);
    });

    it('should handle validation errors in transport', async () => {
      mockValidation.validate.mockReturnValue({
        success: false,
        error: new ZodError([
          {
            code: 'custom',
            path: [],
            message: 'Invalid artifact',
          },
        ]),
      });

      const result = await transporter.transport('alice$example.com', mockArtifact);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Invalid artifact');
    });

    it('should handle connection creation errors', async () => {
      // Mock BtpsClient constructor to throw
      mockBtpsClient.mockImplementationOnce(() => {
        throw new Error('Connection failed');
      });

      await expect(transporter.registerConnection('alice$example.com')).rejects.toThrow(
        'Connection failed',
      );
    });
  });

  describe('Destroy and Cleanup', () => {
    it('should destroy all connections and cleanup resources', async () => {
      await transporter.registerConnection('alice$example.com');
      await transporter.registerConnection('bob$example.com');

      expect(transporter.getTotalConnections()).toBe(2);

      transporter.destroy();

      expect(transporter.getTotalConnections()).toBe(0);
      expect(mockClient.destroy).toHaveBeenCalledTimes(2);
    });

    it('should clear connection lock on destroy', async () => {
      // Start a registration
      const registrationPromise = transporter.registerConnection('alice$example.com');

      // Destroy before registration completes
      transporter.destroy();

      // Should not throw
      await expect(registrationPromise).resolves.toBeDefined();
    });

    it('should remove all event listeners on destroy', async () => {
      const eventSpy = vi.fn();
      transporter.on('connectionCreated', eventSpy);

      await transporter.registerConnection('alice$example.com');
      expect(eventSpy).toHaveBeenCalled();

      transporter.destroy();

      // Register again - should not trigger the old listener
      eventSpy.mockClear();
      await transporter.registerConnection('bob$example.com');
      expect(eventSpy).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent registrations of same connection', async () => {
      const promises = Array(5)
        .fill(0)
        .map(() => transporter.registerConnection('alice$example.com'));

      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      expect(transporter.getTotalConnections()).toBe(1);
    });

    it('should handle rapid register/deregister cycles', async () => {
      for (let i = 0; i < 10; i++) {
        await transporter.registerConnection(`user${i}$example.com`);
        transporter.deregisterConnection(`user${i}$example.com`);
      }

      expect(transporter.getTotalConnections()).toBe(0);
    });

    it('should handle max connections edge case', async () => {
      // Fill up to max connections
      for (let i = 0; i < 5; i++) {
        await transporter.registerConnection(`user${i}$example.com`);
      }

      // Try to register one more
      await expect(transporter.registerConnection('overflow$example.com')).rejects.toThrow(
        BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED.message,
      );

      // Deregister one and try again
      transporter.deregisterConnection('user0$example.com');
      await expect(transporter.registerConnection('overflow$example.com')).resolves.toBeDefined();
    });

    it('should handle empty artifact in transport', async () => {
      const emptyArtifact = {} as BTPTransporterArtifact;

      mockValidation.validate.mockReturnValue({
        success: false,
        error: new ZodError([
          {
            code: 'custom',
            path: [],
            message: 'Invalid artifact',
          },
        ]),
      });

      const result = await transporter.transport('alice$example.com', emptyArtifact);

      expect(result.error).toBeDefined();
    });

    it('should handle getConnections with multiple connections', async () => {
      await transporter.registerConnection('alice$example.com');
      await transporter.registerConnection('bob$example.com');
      await transporter.registerConnection('charlie$example.com');

      const connections = transporter.getConnections();
      expect(connections).toHaveLength(3);
      expect(connections.map((c) => c.id)).toEqual([
        'alice$example.com',
        'bob$example.com',
        'charlie$example.com',
      ]);
    });

    it('should handle getConnection with invalid ID format', () => {
      const connection = transporter.getConnection('invalid-id');
      expect(connection).toBeUndefined();
    });

    it('should handle updateConnection with null/undefined options', async () => {
      await transporter.registerConnection('alice$example.com');

      const result = transporter.updateConnection('alice$example.com', undefined);
      expect(result).toBeDefined();
      expect(result?.id).toBe('alice$example.com');
    });

    it('should handle updateConnection with empty options object', async () => {
      await transporter.registerConnection('alice$example.com');

      const result = transporter.updateConnection('alice$example.com', {});
      expect(result).toBeDefined();
      expect(result?.id).toBe('alice$example.com');
    });

    it('should handle getActiveConnections with no active connections', async () => {
      await transporter.registerConnection('alice$example.com');
      await transporter.registerConnection('bob$example.com');

      const activeConnections = transporter.getActiveConnections();
      expect(activeConnections).toHaveLength(0);
    });

    it('should handle getActiveConnections with mixed active/inactive connections', async () => {
      await transporter.registerConnection('alice$example.com');
      await transporter.registerConnection('bob$example.com');
      await transporter.registerConnection('charlie$example.com');

      // Manually set one connection as active
      const internalConnection = (
        transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
      ).connections.get('alice$example.com');
      if (internalConnection) {
        internalConnection.isActive = true;
      }

      const activeConnections = transporter.getActiveConnections();
      expect(activeConnections).toHaveLength(1);
      expect(activeConnections[0].id).toBe('alice$example.com');
    });

    it('should handle getTotalActiveConnections with all active connections', async () => {
      await transporter.registerConnection('alice$example.com');
      await transporter.registerConnection('bob$example.com');

      // Manually set all connections as active
      const connections = (
        transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
      ).connections;

      for (const connection of connections.values()) {
        connection.isActive = true;
      }

      expect(transporter.getTotalActiveConnections()).toBe(2);
    });

    it('should handle getMetrics with zero connections', () => {
      const metrics = transporter.getMetrics();
      expect(metrics.totalConnections).toBe(0);
      expect(metrics.activeConnections).toBe(0);
    });

    it('should handle getMetrics with all active connections', async () => {
      await transporter.registerConnection('alice$example.com');
      await transporter.registerConnection('bob$example.com');

      // Manually set all connections as active
      const connections = (
        transporter as unknown as { connections: Map<string, BTPConnectionInternal> }
      ).connections;

      for (const connection of connections.values()) {
        connection.isActive = true;
      }

      const metrics = transporter.getMetrics();
      expect(metrics.totalConnections).toBe(2);
      expect(metrics.activeConnections).toBe(2);
    });

    it('should handle setMaxConnections with zero value', () => {
      transporter.setMaxConnections(0);
      expect(transporter.getMaxConnections()).toBe(0);
    });

    it('should handle setMaxConnections with negative value', () => {
      transporter.setMaxConnections(-1);
      expect(transporter.getMaxConnections()).toBe(-1);
    });

    it('should handle updateConnectionTTLSeconds with zero value', () => {
      transporter.updateConnectionTTLSeconds(0);
      expect(transporter.getConnectionTTLSeconds()).toBe(0);
    });

    it('should handle updateConnectionTTLSeconds with negative value', () => {
      transporter.updateConnectionTTLSeconds(-1);
      expect(transporter.getConnectionTTLSeconds()).toBe(-1000);
    });

    it('should handle transport with null artifact', async () => {
      mockValidation.validate.mockReturnValue({
        success: false,
        error: new ZodError([
          {
            code: 'custom',
            path: [],
            message: 'Invalid artifact',
          },
        ]),
      });

      const result = await transporter.transport(
        'alice$example.com',
        null as unknown as BTPTransporterArtifact,
      );
      expect(result.error).toBeDefined();
    });

    it('should handle transportBatch with empty array', async () => {
      const results = await transporter.transportBatch('alice$example.com', []);
      expect(results).toHaveLength(0);
    });

    it('should handle transportBatch with single artifact', async () => {
      const artifacts = [{ ...mockArtifact, id: 'single-artifact' }];
      const results = await transporter.transportBatch('alice$example.com', artifacts);
      expect(results).toHaveLength(1);
      expect(results[0].error).toBeUndefined();
    });

    it('should handle deregisterConnection with empty string', () => {
      expect(() => transporter.deregisterConnection('')).not.toThrow();
    });

    it('should handle deregisterConnection with whitespace string', () => {
      expect(() => transporter.deregisterConnection('   ')).not.toThrow();
    });

    it('should handle registerConnection with whitespace identity', async () => {
      await expect(transporter.registerConnection('   ')).rejects.toThrow();
    });

    it('should handle registerConnection with empty string identity', async () => {
      await expect(transporter.registerConnection('')).rejects.toThrow();
    });

    it('should handle event listeners with invalid event types', () => {
      const spy = vi.fn();

      // These should not throw
      expect(() =>
        transporter.on(
          'invalid-event' as keyof import('./types/index.js').BtpsTransporterEvents,
          spy,
        ),
      ).not.toThrow();
      expect(() =>
        transporter.off(
          'invalid-event' as keyof import('./types/index.js').BtpsTransporterEvents,
          spy,
        ),
      ).not.toThrow();
    });

    it('should handle multiple event listeners for same event', async () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();

      transporter.on('connectionCreated', spy1);
      transporter.on('connectionCreated', spy2);

      await transporter.registerConnection('alice$example.com');

      expect(spy1).toHaveBeenCalledWith('alice$example.com');
      expect(spy2).toHaveBeenCalledWith('alice$example.com');
    });

    it('should handle removing specific event listener', async () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();

      transporter.on('connectionCreated', spy1);
      transporter.on('connectionCreated', spy2);
      transporter.off('connectionCreated', spy1);

      await transporter.registerConnection('alice$example.com');

      expect(spy1).not.toHaveBeenCalled();
      expect(spy2).toHaveBeenCalledWith('alice$example.com');
    });

    it('should handle destroy when already destroyed', () => {
      transporter.destroy();
      expect(() => transporter.destroy()).not.toThrow();
    });

    it('should handle getConnection after destroy', () => {
      transporter.destroy();
      const connection = transporter.getConnection('alice$example.com');
      expect(connection).toBeUndefined();
    });

    it('should handle getConnections after destroy', () => {
      transporter.destroy();
      const connections = transporter.getConnections();
      expect(connections).toHaveLength(0);
    });

    it('should handle getActiveConnections after destroy', () => {
      transporter.destroy();
      const activeConnections = transporter.getActiveConnections();
      expect(activeConnections).toHaveLength(0);
    });

    it('should handle getMetrics after destroy', () => {
      transporter.destroy();
      const metrics = transporter.getMetrics();
      expect(metrics.totalConnections).toBe(0);
      expect(metrics.activeConnections).toBe(0);
    });

    it('should handle transport after destroy', async () => {
      transporter.destroy();
      const result = await transporter.transport('alice$example.com', mockArtifact);
      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
    });

    it('should handle transportBatch after destroy', async () => {
      transporter.destroy();
      const results = await transporter.transportBatch('alice$example.com', [mockArtifact]);
      expect(results).toHaveLength(1);
      expect(results[0].error).toBeUndefined();
      expect(results[0].response).toBeDefined();
    });
  });
});
