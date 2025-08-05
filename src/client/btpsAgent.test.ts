/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { BtpsAgent } from './btpsAgent.js';
import {
  BTPErrorException,
  BTP_ERROR_VALIDATION,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_UNSUPPORTED_ENCRYPT,
} from '../core/error/index.js';
import * as utils from '../core/utils/index.js';
import * as crypto from '../core/crypto/index.js';
import { BTPDocType, BTPServerResponse } from '../core/server/types.js';
import { BTPAgentOptions } from './types/index.js';
import { BTP_PROTOCOL_VERSION } from '../core/server/constants/index.js';

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
    ref: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  let mockOptions: BTPAgentOptions;
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
      ref: vi.fn(),
      unref: vi.fn(),
      destroyed: false,
    }) as EventEmitter & {
      writable: boolean;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      setTimeout: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
      pipe: ReturnType<typeof vi.fn>;
      ref: ReturnType<typeof vi.fn>;
      unref: ReturnType<typeof vi.fn>;
      destroyed: boolean;
    };

    mockStream = Object.assign(new EventEmitter(), {
      on: vi.fn(),
    });
    (mockSocket.pipe as ReturnType<typeof vi.fn>).mockReturnValue(mockStream);

    mockOptions = {
      agent: {
        id: 'test-agent-123',
        identityKey: 'PRIVATE_KEY',
        identityCert: 'PUBLIC_KEY',
      },
      btpIdentity: 'test$example.com',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
      btpMtsOptions: {
        rejectUnauthorized: false,
      },
    };

    // Mock DNS resolution to return valid data
    mockUtils.getHostAndSelector.mockResolvedValue({
      version: '1.0.0',
      host: 'localhost',
      selector: 'btps1',
    });
    mockUtils.getBtpAddressParts.mockReturnValue({
      hostname: 'localhost',
      port: '3443',
    } as URL);
    mockUtils.isValidIdentity.mockImplementation((identity?: string) => {
      if (!identity) return false;
      return identity.includes('$') && identity.split('$').length === 2;
    });

    mockCrypto.signBtpPayload.mockReturnValue({
      algorithmHash: 'sha256' as const,
      value: 'test-signature',
      fingerprint: 'test-fingerprint',
    });

    mockCrypto.encryptBtpPayload.mockReturnValue({
      data: 'encrypted-data',
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'encrypted-key',
        iv: 'test-iv',
        type: 'standardEncrypt',
        authTag: 'test-tag',
      },
    });

    agent = new BtpsAgent(mockOptions);

    // Mock the inherited BtpsClient methods
    vi.spyOn(agent, 'resolveBtpsHostDnsTxt').mockResolvedValue({
      hostname: 'localhost',
      port: 3443,
      selector: 'btps1',
      version: '1.0.0',
    });
    vi.spyOn(agent, 'resolveIdentity').mockResolvedValue({
      response: {
        hostname: 'localhost',
        port: 3443,
        selector: 'btps1',
        version: '1.0.0',
        publicKey: 'PUBLIC_KEY',
        keyType: 'rsa',
      },
      error: undefined,
    });
    vi.spyOn(agent, 'send').mockResolvedValue({
      response: {
        reqId: 'test-req-id',
        status: { ok: true, code: 200 },
        type: 'btps_response',
        version: '1.0.0',
        id: 'test-id',
        issuedAt: '2023-12-31T00:00:00.000Z',
      },
      error: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    agent.destroy();
  });

  describe('constructor', () => {
    it('should construct with valid options', () => {
      expect(agent).toBeInstanceOf(BtpsAgent);
    });

    it('should throw error for invalid agent options', () => {
      expect(() => {
        new BtpsAgent({
          ...mockOptions,
          agent: {
            id: '',
            identityKey: 'PRIVATE_KEY',
            identityCert: 'PUBLIC_KEY',
          },
        });
      }).toThrow(BTPErrorException);
    });

    it('should throw error for invalid btpIdentity', () => {
      expect(() => {
        new BtpsAgent({
          ...mockOptions,
          btpIdentity: 'invalid-identity',
        });
      }).toThrow(BTPErrorException);
    });
  });

  describe('command method', () => {
    it('should execute system.ping command successfully', async () => {
      const result = await agent.command('system.ping', 'alice$example.com');

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
    });

    it('should execute trust.request command with document', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const result = await agent.command('trust.request', 'bob$company.com', document);

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
    });

    it('should reject invalid action type', async () => {
      const result = await agent.command('invalid.action' as never, 'alice$example.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
    });

    it('should reject invalid identity format', async () => {
      const result = await agent.command('system.ping', 'invalid-identity');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
    });

    it('should reject missing document for trust.request', async () => {
      const result = await agent.command('trust.request', 'bob$company.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
    });

    it('should handle command with encryption options', async () => {
      const result = await agent.command('system.ping', 'alice$example.com', undefined, {
        signature: {
          algorithmHash: 'sha256' as const,
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
    });

    it('should handle multiple commands with Promise.all', async () => {
      // Mock send to return different responses for each command
      vi.spyOn(agent, 'send').mockImplementation(async (artifact) => {
        const reqId = artifact.id;
        return {
          response: {
            reqId,
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: '1.0.0',
            id: reqId,
            issuedAt: '2023-12-31T00:00:00.000Z',
            document: `Response for ${reqId}`,
          },
          error: undefined,
        };
      });

      const commands = [
        agent.command('system.ping', 'alice$example.com'),
        agent.command('system.ping', 'bob$example.com'),
        agent.command('system.ping', 'charlie$example.com'),
      ];

      const results = await Promise.all(commands);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.error).toBeUndefined();
        expect(result.response).toBeDefined();
        expect(result.response?.reqId).toBeDefined();
        expect(result.response?.document).toContain('Response for');
      });
    });

    it('should handle multiple commands sequentially', async () => {
      // Mock send to return different responses for each command
      vi.spyOn(agent, 'send').mockImplementation(async (artifact) => {
        const reqId = artifact.id;
        return {
          response: {
            reqId,
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: '1.0.0',
            id: reqId,
            issuedAt: '2023-12-31T00:00:00.000Z',
            document: `Sequential response for ${reqId}`,
          },
          error: undefined,
        };
      });

      const results = [];

      // Execute commands sequentially
      results.push(await agent.command('system.ping', 'alice$example.com'));
      results.push(await agent.command('system.ping', 'bob$example.com'));
      results.push(await agent.command('system.ping', 'charlie$example.com'));

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.error).toBeUndefined();
        expect(result.response).toBeDefined();
        expect(result.response?.reqId).toBeDefined();
        expect(result.response?.document).toContain('Sequential response for');
      });
    });

    it('should handle mixed command types with Promise.all', async () => {
      // Mock send to return different responses based on command type
      vi.spyOn(agent, 'send').mockImplementation(async (artifact) => {
        const reqId = artifact.id;
        const commandType = (artifact as { action?: string }).action || 'unknown';

        return {
          response: {
            reqId,
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: '1.0.0',
            id: reqId,
            issuedAt: '2023-12-31T00:00:00.000Z',
            document: `Mixed response for ${commandType} - ${reqId}`,
          },
          error: undefined,
        };
      });

      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const commands = [
        agent.command('system.ping', 'alice$example.com'),
        agent.command('trust.request', 'bob$company.com', document),
        agent.command('system.ping', 'charlie$example.com'),
      ];

      const results = await Promise.all(commands);

      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.error).toBeUndefined();
        expect(result.response).toBeDefined();
        expect(result.response?.reqId).toBeDefined();
        expect(result.response?.document).toContain('Mixed response for');
      });
    });

    it('should handle Promise.all with some commands failing', async () => {
      // Mock send to return errors for specific commands
      vi.spyOn(agent, 'send').mockImplementation(async (artifact) => {
        const reqId = artifact.id;
        const target = (artifact as { to?: string }).to;

        // Fail commands to specific targets
        if (target === 'bob$example.com' || target === 'david$example.com') {
          return {
            response: undefined,
            error: new BTPErrorException({
              message: `Command failed for ${target}`,
            }),
          };
        }

        return {
          response: {
            reqId,
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: '1.0.0',
            id: reqId,
            issuedAt: '2023-12-31T00:00:00.000Z',
            document: `Success response for ${target}`,
          },
          error: undefined,
        };
      });

      const commands = [
        agent.command('system.ping', 'alice$example.com'),
        agent.command('system.ping', 'bob$example.com'),
        agent.command('system.ping', 'charlie$example.com'),
        agent.command('system.ping', 'david$example.com'),
      ];

      const results = await Promise.all(commands);

      expect(results).toHaveLength(4);

      // Check successful commands
      expect(results[0].error).toBeUndefined();
      expect(results[0].response?.document).toContain('Success response for alice$example.com');

      expect(results[2].error).toBeUndefined();
      expect(results[2].response?.document).toContain('Success response for charlie$example.com');

      // Check failed commands
      expect(results[1].error).toBeInstanceOf(BTPErrorException);
      expect(results[1].error?.message).toContain('Command failed for bob$example.com');

      expect(results[3].error).toBeInstanceOf(BTPErrorException);
      expect(results[3].error?.message).toContain('Command failed for david$example.com');
    });

    it('should handle sequential commands with mixed success/failure', async () => {
      // Mock send to return different results based on command
      vi.spyOn(agent, 'send').mockImplementation(async (artifact) => {
        const reqId = artifact.id;
        const target = (artifact as { to?: string }).to;

        // Fail commands to specific targets
        if (target === 'bob$example.com' || target === 'david$example.com') {
          return {
            response: undefined,
            error: new BTPErrorException({
              message: `Sequential command failed for ${target}`,
            }),
          };
        }

        return {
          response: {
            reqId,
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: '1.0.0',
            id: reqId,
            issuedAt: '2023-12-31T00:00:00.000Z',
            data: `Sequential success for ${target}`,
          },
          error: undefined,
        };
      });

      const results = [];

      // Execute commands sequentially with mixed results
      results.push(await agent.command('system.ping', 'alice$example.com'));
      results.push(await agent.command('system.ping', 'bob$example.com'));
      results.push(await agent.command('system.ping', 'charlie$example.com'));
      results.push(await agent.command('system.ping', 'david$example.com'));

      expect(results).toHaveLength(4);

      // Check successful commands
      expect(results[0].error).toBeUndefined();
      expect(results[0].response).toBeDefined();

      expect(results[2].error).toBeUndefined();
      expect(results[2].response).toBeDefined();

      // Check failed commands
      expect(results[1].error).toBeInstanceOf(BTPErrorException);
      expect(results[1].error?.message).toContain('Sequential command failed for bob$example.com');

      expect(results[3].error).toBeInstanceOf(BTPErrorException);
      expect(results[3].error?.message).toContain(
        'Sequential command failed for david$example.com',
      );
    });

    it('should handle Promise.allSettled with all commands', async () => {
      // Mock send to return mixed results
      vi.spyOn(agent, 'send').mockImplementation(async (artifact) => {
        const reqId = artifact.id;
        const target = (artifact as { to?: string }).to;

        // Fail specific commands by throwing an error
        if (target === 'charlie$example.com' || target === 'frank$example.com') {
          throw new BTPErrorException({
            message: `Promise.allSettled failed for ${target}`,
          });
        }

        return {
          response: {
            reqId,
            status: { ok: true, code: 200 },
            type: 'btps_response',
            version: '1.0.0',
            id: reqId,
            issuedAt: '2023-12-31T00:00:00.000Z',
            document: `Promise.allSettled success for ${target}`,
          },
          error: undefined,
        };
      });

      const commands = [
        agent.command('system.ping', 'alice$example.com'),
        agent.command('system.ping', 'bob$example.com'),
        agent.command('system.ping', 'charlie$example.com'),
        agent.command('system.ping', 'david$example.com'),
        agent.command('system.ping', 'eve$example.com'),
        agent.command('system.ping', 'frank$example.com'),
      ];

      const results = await Promise.allSettled(commands);

      expect(results).toHaveLength(6);

      // Check fulfilled promises
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
      expect(results[3].status).toBe('fulfilled');
      expect(results[4].status).toBe('fulfilled');

      // Check rejected promises
      expect(results[2].status).toBe('rejected');
      expect(results[5].status).toBe('rejected');

      // Verify successful results
      const successfulResults = results.filter(
        (r) => r.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ error?: BTPErrorException; response?: BTPServerResponse }>[];
      successfulResults.forEach((result) => {
        expect(result.value.error).toBeUndefined();
        expect(result.value.response?.document).toContain('Promise.allSettled success for');
      });

      // Verify failed results
      const failedResults = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];
      failedResults.forEach((result) => {
        expect(result.reason).toBeInstanceOf(BTPErrorException);
        expect(result.reason.message).toContain('Promise.allSettled failed for');
      });
    });
  });

  describe('artifact creation', () => {
    it('should create agent artifact with correct structure', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      await agent.command('trust.request', 'bob$company.com', document);

      // Check that the artifact was created with correct structure
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'trust.request',
          agentId: 'test-agent-123',
          to: 'bob$company.com',
          document: expect.any(Object),
          version: BTP_PROTOCOL_VERSION,
        }),
        expect.any(Object),
      );
    });

    it('should create transport artifact for trust actions', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      await agent.command('trust.request', 'bob$company.com', document);

      // Check that transport artifact was created
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TRUST_REQ',
          from: 'test$example.com',
          to: 'bob$company.com',
          document: expect.any(Object),
        }),
        expect.any(Object),
      );
    });
  });

  describe('error handling', () => {
    it('should handle artifact creation errors', async () => {
      mockCrypto.signBtpPayload.mockImplementation(() => {
        throw new Error('Signing failed');
      });

      const result = await agent.command('system.ping', 'alice$example.com');

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain('Signing failed');
    });

    it('should handle encryption errors', async () => {
      mockCrypto.encryptBtpPayload.mockImplementation(() => {
        throw new Error('Unsupported encryption algorithm');
      });

      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const result = await agent.command('trust.request', 'bob$company.com', document, {
        signature: {
          algorithmHash: 'sha256' as const,
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      });

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toContain('Unsupported encryption algorithm');
    });

    it('should handle DNS resolution errors', async () => {
      vi.spyOn(agent, 'resolveBtpsHostDnsTxt').mockResolvedValue(undefined);

      // Mock send to return an error for this specific test
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: undefined,
        error: new BTPErrorException({
          message: 'Could not resolve host and selector for: bob$company.com',
        }),
      });

      const result = await agent.command(
        'trust.request',
        'bob$company.com',
        {
          id: 'doc-1',
          name: 'Test Company',
          email: 'test@company.com',
          reason: 'Business partnership',
          phone: '+1234567890',
        },
        {
          signature: {
            algorithmHash: 'sha256' as const,
          },
          encryption: {
            algorithm: 'aes-256-gcm',
            mode: 'standardEncrypt',
          },
        },
      );

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toContain(
        'Could not resolve host and selector for: bob$company.com',
      );
    });
  });

  describe('action mapping', () => {
    it('should map trust.request to TRUST_REQ', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      await agent.command('trust.request', 'bob$company.com', document);

      // Check that the correct artifact type was created
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TRUST_REQ',
        }),
        expect.any(Object),
      );
    });

    it('should map artifact.send to BTPS_DOC', async () => {
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

      await agent.command('artifact.send', 'bob$company.com', document);

      // Check that the correct artifact type was created
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'BTPS_DOC',
        }),
        expect.any(Object),
      );
    });
  });

  describe('destroy method', () => {
    it('should support soft destroy', () => {
      // Test that destroy(true) doesn't throw an error
      expect(() => {
        agent.destroy(true);
      }).not.toThrow();
    });

    it('should support hard destroy', () => {
      // Test that destroy(false) doesn't throw an error
      expect(() => {
        agent.destroy(false);
      }).not.toThrow();
    });
  });

  describe('getAgentArtifact method', () => {
    it('should create agent artifact successfully', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock the send method to return success
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: {
          reqId: 'test-req-id',
          status: { ok: true, code: 200 },
          type: 'btps_response',
          version: '1.0.0',
          id: 'test-id',
          issuedAt: '2023-12-31T00:00:00.000Z',
        },
        error: undefined,
      });

      const result = await agent.command('trust.request', 'bob$company.com', document);

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'trust.request',
          agentId: 'test-agent-123',
          to: 'bob$company.com',
          document: expect.any(Object),
          version: BTP_PROTOCOL_VERSION,
        }),
        expect.any(Object),
      );
    });

    it('should handle missing document for required actions', async () => {
      // Mock the send method to return validation error
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: undefined,
        error: new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: 'Document is required for trust.request',
        }),
      });

      const result = await agent.command('trust.request', 'bob$company.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
      expect(result.error?.message).toContain('BTPS artifact validation failed');
    });

    it('should handle artifact creation errors', async () => {
      // Mock signBtpPayload to throw an error
      mockCrypto.signBtpPayload.mockImplementation(() => {
        throw new Error('Signing failed');
      });

      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      const result = await agent.command('trust.request', 'bob$company.com', document);

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain('Signing failed');
    });

    it('should create agent artifact with encryption options', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock the send method to return success
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: {
          reqId: 'test-req-id',
          status: { ok: true, code: 200 },
          type: 'btps_response',
          version: '1.0.0',
          id: 'test-id',
          issuedAt: '2023-12-31T00:00:00.000Z',
        },
        error: undefined,
      });

      const result = await agent.command('trust.request', 'bob$company.com', document, {
        signature: {
          algorithmHash: 'sha256' as const,
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'trust.request',
          agentId: 'test-agent-123',
          to: 'bob$company.com',
          document: expect.any(Object),
          version: BTP_PROTOCOL_VERSION,
        }),
        expect.any(Object),
      );
    });
  });

  describe('buildTransportArtifact method', () => {
    it('should create transport artifact successfully', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock the send method to return success
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: {
          reqId: 'test-req-id',
          status: { ok: true, code: 200 },
          type: 'btps_response',
          version: '1.0.0',
          id: 'test-id',
          issuedAt: '2023-12-31T00:00:00.000Z',
        },
        error: undefined,
      });

      const result = await agent.command('trust.request', 'bob$company.com', document);

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TRUST_REQ',
          from: 'test$example.com',
          to: 'bob$company.com',
          document: expect.any(Object),
        }),
        expect.any(Object),
      );
    });

    it('should handle missing document for transport artifact', async () => {
      // Mock the send method to return validation error
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: undefined,
        error: new BTPErrorException(BTP_ERROR_VALIDATION, {
          cause: 'Document is required for trust.request',
        }),
      });

      const result = await agent.command('trust.request', 'bob$company.com');

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_VALIDATION.code);
      expect(result.error?.message).toContain('BTPS artifact validation failed');
    });

    it('should handle DNS resolution failure for transport artifact', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock resolveBtpsHostDnsTxt to return undefined (DNS resolution failure)
      vi.spyOn(agent, 'resolveBtpsHostDnsTxt').mockResolvedValue(undefined);

      // Mock the send method to return DNS error
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: undefined,
        error: new BTPErrorException(BTP_ERROR_RESOLVE_DNS, {
          cause: 'Could not resolve host and selector for: bob$company.com',
        }),
      });

      const result = await agent.command('trust.request', 'bob$company.com', document);

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_RESOLVE_DNS.code);
      expect(result.error?.message).toContain('No valid DNS record found');
    });

    it('should handle encryption errors in transport artifact', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock encryptBtpPayload to throw an error
      mockCrypto.encryptBtpPayload.mockImplementation(() => {
        throw new Error('Unsupported encryption algorithm');
      });

      // Mock resolveIdentity to return valid response
      vi.spyOn(agent, 'resolveIdentity').mockResolvedValue({
        response: {
          hostname: 'localhost',
          port: 3443,
          selector: 'btps1',
          version: '1.0.0',
          publicKey: 'PUBLIC_KEY',
          keyType: 'rsa',
        },
        error: undefined,
      });

      // Mock the send method to return encryption error
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: undefined,
        error: new BTPErrorException(BTP_ERROR_UNSUPPORTED_ENCRYPT, {
          cause: 'Failed to encrypt document for bob$company.com',
        }),
      });

      const result = await agent.command('trust.request', 'bob$company.com', document, {
        signature: {
          algorithmHash: 'sha256' as const,
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      });

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.code).toBe(BTP_ERROR_UNSUPPORTED_ENCRYPT.code);
      expect(result.error?.message).toContain('Unsupported encryption algorithm');
    });

    it('should create transport artifact with encryption', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock encryptBtpPayload to return encrypted data
      mockCrypto.encryptBtpPayload.mockReturnValue({
        data: 'encrypted-data',
        encryption: {
          algorithm: 'aes-256-gcm',
          encryptedKey: 'encrypted-key',
          iv: 'test-iv',
          type: 'standardEncrypt',
          authTag: 'test-tag',
        },
      });

      // Mock resolveIdentity to return valid response
      vi.spyOn(agent, 'resolveIdentity').mockResolvedValue({
        response: {
          hostname: 'localhost',
          port: 3443,
          selector: 'btps1',
          version: '1.0.0',
          publicKey: 'PUBLIC_KEY',
          keyType: 'rsa',
        },
        error: undefined,
      });

      // Mock the send method to return success
      vi.spyOn(agent, 'send').mockResolvedValue({
        response: {
          reqId: 'test-req-id',
          status: { ok: true, code: 200 },
          type: 'btps_response',
          version: '1.0.0',
          id: 'test-id',
          issuedAt: '2023-12-31T00:00:00.000Z',
        },
        error: undefined,
      });

      const result = await agent.command('trust.request', 'bob$company.com', document, {
        signature: {
          algorithmHash: 'sha256' as const,
        },
        encryption: {
          algorithm: 'aes-256-gcm',
          mode: 'standardEncrypt',
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.response).toBeDefined();
      expect(mockCrypto.encryptBtpPayload).toHaveBeenCalledWith(document, 'PUBLIC_KEY', {
        algorithm: 'aes-256-gcm',
        mode: 'standardEncrypt',
      });
      expect(mockCrypto.signBtpPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TRUST_REQ',
          from: 'test$example.com',
          to: 'bob$company.com',
          document: 'encrypted-data',
          encryption: expect.objectContaining({
            algorithm: 'aes-256-gcm',
            encryptedKey: 'encrypted-key',
            iv: 'test-iv',
            type: 'standardEncrypt',
            authTag: 'test-tag',
          }),
        }),
        expect.any(Object),
      );
    });

    it('should handle signing errors in transport artifact', async () => {
      const document: BTPDocType = {
        id: 'doc-1',
        name: 'Test Company',
        email: 'test@company.com',
        reason: 'Business partnership',
        phone: '+1234567890',
      };

      // Mock signBtpPayload to throw an error for transport artifact
      mockCrypto.signBtpPayload.mockImplementation((payload) => {
        if ((payload as { type?: string }).type === 'TRUST_REQ') {
          throw new Error('Transport signing failed');
        }
        return {
          algorithmHash: 'sha256' as const,
          value: 'test-signature',
          fingerprint: 'test-fingerprint',
        };
      });

      const result = await agent.command('trust.request', 'bob$company.com', document);

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain('Transport signing failed');
    });
  });
});
