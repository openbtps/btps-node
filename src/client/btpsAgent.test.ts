/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { BtpsAgent } from './btpsAgent';
import { BTPErrorException, BTP_ERROR_VALIDATION } from '../core/error/index';
import * as utils from '../core/utils/index';
import * as crypto from '../core/crypto/index';
import { BTPDocType } from '../core/server/types';
import { BtpsClientOptions } from './types/index';

// --- Mocks ---
vi.mock('../core/utils/index');
vi.mock('../core/crypto/index');

const mockUtils = vi.mocked(utils);
const mockCrypto = vi.mocked(crypto);

describe('BtpsAgent', () => {
  let agent: BtpsAgent;
  let mockSocket: EventEmitter & {
    writable: boolean;
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setTimeout: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    pipe: ReturnType<typeof vi.fn>;
  };
  let mockOptions: BtpsClientOptions & { agentId: string };
  let mockStream: EventEmitter & { on: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockSocket = Object.assign(new EventEmitter(), {
      writable: true,
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
      once: vi.fn(),
      pipe: vi.fn(),
    }) as EventEmitter & {
      writable: boolean;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      setTimeout: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
      pipe: ReturnType<typeof vi.fn>;
    };

    mockStream = Object.assign(new EventEmitter(), {
      on: vi.fn(),
    });
    (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    mockOptions = {
      identity: 'test$example.com',
      agentId: 'test-agent-123',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };

    mockUtils.getHostAndSelector.mockResolvedValue({
      host: 'server.example.com',
      selector: 'btps1',
    });
    mockUtils.getBtpAddressParts.mockReturnValue({
      hostname: 'server.example.com',
      port: '3443',
    } as URL);
    mockUtils.parseIdentity.mockImplementation((id: string) => {
      const [accountName, domainName] = id.split('$');
      if (!accountName || !domainName) return null;
      return { accountName, domainName };
    });

    mockCrypto.signEncrypt.mockResolvedValue({
      payload: {
        id: 'id',
        from: 'test$example.com',
        to: 'recipient$example.com',
        type: 'TRUST_REQ',
        issuedAt: '2023-01-01T00:00:00.000Z',
        document: {} as BTPDocType,
        signature: { algorithmHash: 'sha256', value: 'sig', fingerprint: 'fp' },
        encryption: null,
      },
      error: undefined,
    });

    agent = new BtpsAgent(mockOptions);
    (agent as unknown as { socket: typeof mockSocket }).socket = mockSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.destroy();
  });

  describe('constructor', () => {
    it('should construct with options including agentId', () => {
      expect(agent).toBeInstanceOf(BtpsAgent);
      expect((agent as unknown as { agentId: string }).agentId).toBe('test-agent-123');
    });

    it('should extend BtpsClient', () => {
      expect(agent).toBeInstanceOf(BtpsAgent);
      // Should have BtpsClient methods
      expect(typeof agent.connect).toBe('function');
      expect(typeof agent.destroy).toBe('function');
    });
  });

  describe('command validation', () => {
    it('should validate valid system.ping command', async () => {
      const promise = agent.command('system.ping', 'alice$example.com');

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();
      expect(result.response).toEqual({ status: 'ok' });
    });

    it('should validate valid trust.request with document', async () => {
      const document: BTPDocType = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const promise = agent.command('trust.request', 'bob$company.com', document);

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();
      expect(result.response).toEqual({ status: 'ok' });
    });

    it('should reject invalid action type', async () => {
      const result = await agent.command('invalid.action' as never, 'alice$example.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
      expect(result.error?.message).toContain('BTPS artifact validation failed');
    });

    it('should reject invalid identity format', async () => {
      const result = await agent.command('system.ping', 'invalid-identity');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
      expect(result.error?.message).toContain('BTPS artifact validation failed');
    });

    it('should reject missing document for trust.request', async () => {
      const result = await agent.command('trust.request', 'bob$company.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
      expect(result.error?.message).toContain('BTPS artifact validation failed');
    });

    it('should reject invalid crypto options', async () => {
      const result = await agent.command('system.ping', 'alice$example.com', undefined, {
        signature: {
          algorithmHash: 'md5' as never, // Invalid algorithm
        },
      });

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
      expect(result.error?.message).toContain('BTPS artifact validation failed');
    });

    it('should accept valid crypto options', async () => {
      const promise = agent.command('system.ping', 'alice$example.com', undefined, {
        signature: {
          algorithmHash: 'sha256',
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      });

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();
      expect(result.response).toEqual({ status: 'ok' });
    });
  });

  describe('command execution', () => {
    it('should handle system.ping command without transport', async () => {
      const promise = agent.command('system.ping', 'alice$example.com');

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();
      expect(result.response).toEqual({ status: 'ok' });

      // Verify signEncrypt was called for agent artifact only
      expect(mockCrypto.signEncrypt).toHaveBeenCalledTimes(1);
    });

    it('should handle trust.request command with transport', async () => {
      const document: BTPDocType = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const promise = agent.command('trust.request', 'bob$company.com', document);

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();
      expect(result.response).toEqual({ status: 'ok' });

      // Verify signEncrypt was called twice: once for transporter artifact, once for agent artifact
      expect(mockCrypto.signEncrypt).toHaveBeenCalledTimes(2);
    });

    it('should handle signEncrypt errors gracefully', async () => {
      // Test that the agent can handle signEncrypt errors without hanging
      mockCrypto.signEncrypt.mockResolvedValueOnce({
        payload: undefined,
        error: new BTPErrorException({ message: 'Crypto error' }),
      });

      const document: BTPDocType = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const promise = agent.command('trust.request', 'bob$company.com', document);

      // Simulate connection events to trigger the signEncrypt call
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');

      const result = await promise;

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Crypto error');
    });

    it('should handle connection error', async () => {
      const promise = agent.command('system.ping', 'alice$example.com');

      // Simulate error event
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('error', {
        error: new BTPErrorException({ message: 'Connection failed' }),
        willRetry: false,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Connection failed');
    });

    it('should handle connection end without retry', async () => {
      const promise = agent.command('system.ping', 'alice$example.com');

      // Simulate end event without retry
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('end', {
        willRetry: false,
      });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Connection ended before message was received');
    });

    it('should handle socket write failure and backpressure', async () => {
      mockSocket.write.mockReturnValue(false); // Simulate backpressure

      const promise = agent.command('system.ping', 'alice$example.com');

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();
      expect(result.response).toEqual({ status: 'ok' });

      // Note: Backpressure queue is cleared after successful write, so we can't test it here
      // The test verifies that the command completes successfully despite backpressure
    });
  });

  describe('signEncryptTransportArtifact', () => {
    it('should create transporter artifact for trust.request', async () => {
      const document: BTPDocType = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const payload = {
        to: 'bob$company.com',
        document,
        actionType: 'trust.request' as const,
        from: 'test$example.com',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (agent as any).signEncryptTransportArtifact(payload);

      expect(result.error).toBeUndefined();
      expect(result.payload).toBeDefined();

      // Verify signEncrypt was called with correct transporter artifact
      expect(mockCrypto.signEncrypt).toHaveBeenCalledWith(
        'bob$company.com',
        expect.any(Object),
        expect.objectContaining({
          version: '1.0.0',
          type: 'TRUST_REQ',
          document,
          from: 'test$example.com',
          to: 'bob$company.com',
        }),
        undefined,
      );
    });

    it('should handle signEncrypt failure in transport artifact', async () => {
      mockCrypto.signEncrypt.mockResolvedValue({
        payload: undefined,
        error: new BTPErrorException({ message: 'Transport signing failed' }),
      });

      const document: BTPDocType = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const payload = {
        to: 'bob$company.com',
        document,
        actionType: 'trust.request' as const,
        from: 'test$example.com',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (agent as any).signEncryptTransportArtifact(payload);

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Transport signing failed');
    });
  });

  describe('error handling', () => {
    it('should handle destroyed agent', async () => {
      agent.destroy();

      const result = await agent.command('system.ping', 'alice$example.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toContain('destroyed');
    });
  });

  describe('action type mapping', () => {
    it('should correctly map trust.request to TRUST_REQ', async () => {
      const document: BTPDocType = {
        id: 'randomId',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const promise = agent.command('trust.request', 'bob$company.com', document);

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();

      // Verify the transporter artifact was created with correct type
      expect(mockCrypto.signEncrypt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          type: 'TRUST_REQ',
        }),
        undefined,
      );
    });

    it('should correctly map artifact.send to BTPS_DOC', async () => {
      const document: BTPDocType = {
        title: 'Invoice #INV-001',
        id: 'INV-001',
        issuedAt: '2023-12-31T00:00:00.000Z',
        status: 'unpaid',
        totalAmount: {
          value: 100.5,
          currency: 'USD',
        },
        lineItems: {
          columns: ['description', 'quantity', 'unitPrice'],
          rows: [
            {
              description: 'Item 1',
              quantity: 1,
              unitPrice: 100.5,
            },
          ],
        },
      };

      const promise = agent.command('artifact.send', 'bob$company.com', document);

      // Simulate connection events
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('connected');
      (agent as unknown as { emitter: EventEmitter }).emitter.emit('message', { status: 'ok' });

      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error).toBeUndefined();

      // Verify the transporter artifact was created with correct type
      expect(mockCrypto.signEncrypt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          type: 'BTPS_DOC',
        }),
        undefined,
      );
    });
  });
});
