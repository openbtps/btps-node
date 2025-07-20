/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { BtpsTransporter } from './btpsTransporter';
import { BTPErrorException } from '../core/error/index';
import * as validation from '../core/utils/validation';
import { BtpsClientOptions } from './types/index';
import type { BTPTransporterArtifact, BTPDocType, BTPArtifactType } from '../core/server/types';
import { ZodError } from 'zod';

// --- Mocks ---
vi.mock('../core/utils/validation');
vi.mock('../core/crypto/index');

const mockValidation = vi.mocked(validation);

describe('BtpsTransporter', () => {
  let transporter: BtpsTransporter;
  let mockOptions: BtpsClientOptions;
  let mockEvents: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockOptions = {
      identity: 'test$example.com',
      btpIdentityKey: 'PRIVATE_KEY',
      bptIdentityCert: 'PUBLIC_KEY',
      maxRetries: 2,
      retryDelayMs: 10,
      connectionTimeoutMs: 100,
    };

    mockEvents = new EventEmitter();

    // Mock the parent class connect method
    transporter = new BtpsTransporter(mockOptions);
    vi.spyOn(transporter, 'connect').mockImplementation((_receiverId, callbacks) => {
      if (callbacks) {
        callbacks({
          on: (event: string, callback: (...args: unknown[]) => void) => {
            mockEvents.on(event, callback);
          },
        });
      }
    });

    // Mock the parent class methods using type assertion
    (transporter as unknown as { sendArtifact: () => void }).sendArtifact = vi.fn();

    (transporter as unknown as { buildClientErrorResponse: () => void }).buildClientErrorResponse =
      vi.fn().mockImplementation((error) => {
        return Promise.resolve({ response: undefined, error });
      });

    (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact = vi
      .fn()
      .mockResolvedValue({
        payload: {
          id: 'test-id',
          from: 'test$example.com',
          to: 'recipient$example.com',
          type: 'BTPS_DOC',
          issuedAt: '2023-01-01T00:00:00.000Z',
          document: { test: 'data' },
          signature: { algorithm: 'sha256', value: 'sig', fingerprint: 'fp' },
          encryption: null,
        },
        error: undefined,
      });

    // Mock the parent class getProtocolVersion method
    vi.spyOn(transporter, 'getProtocolVersion').mockReturnValue('1.0.0');

    // Default validation success
    mockValidation.validate.mockReturnValue({ success: true, data: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    mockEvents.removeAllListeners();
  });

  describe('constructor', () => {
    it('should create a BtpsTransporter instance with options', () => {
      const newTransporter = new BtpsTransporter(mockOptions);
      expect(newTransporter).toBeInstanceOf(BtpsTransporter);
    });
  });

  describe('transport', () => {
    const validArtifact: BTPTransporterArtifact = {
      version: '1.0.0',
      issuedAt: '2023-01-01T00:00:00.000Z',
      document: {
        title: 'Test Invoice',
        id: 'inv-001',
        issuedAt: '2023-01-01T00:00:00.000Z',
        status: 'unpaid',
        totalAmount: {
          value: 100,
          currency: 'USD',
        },
        lineItems: {
          columns: ['item', 'amount'],
          rows: [{ item: 'Test Item', amount: 100 }],
        },
      },
      id: 'test-id',
      type: 'BTPS_DOC',
      from: 'sender$example.com',
      to: 'recipient$example.com',
      signature: {
        algorithm: 'sha256',
        value: 'signature-value',
        fingerprint: 'fingerprint-value',
      },
      encryption: null,
    };

    it('should successfully transport a valid artifact', async () => {
      const mockResponse = {
        version: '1.0.0',
        status: { ok: true, code: 200 },
        id: 'response-id',
        issuedAt: '2023-01-01T00:00:00.000Z',
        type: 'btps_response',
        document: { success: true },
      };

      const transportPromise = transporter.transport(validArtifact);

      // Simulate successful connection and message
      mockEvents.emit('connected');
      mockEvents.emit('message', mockResponse);

      const result = await transportPromise;

      expect(transporter.connect).toHaveBeenCalledWith(validArtifact.to, expect.any(Function));
      expect(
        (transporter as unknown as { sendArtifact: () => void }).sendArtifact,
      ).toHaveBeenCalledWith(validArtifact);
      expect(result).toEqual({
        response: mockResponse,
        error: undefined,
      });
    });

    it('should handle validation failure', async () => {
      const invalidArtifact = { ...validArtifact, version: '' };
      mockValidation.validate.mockReturnValue({
        success: false,
        error: { message: 'Validation failed' } as unknown as ZodError,
      });

      const result = await transporter.transport(invalidArtifact);

      expect(mockValidation.validate).toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Invalid artifact');
      expect(result.response).toBeUndefined();
    });

    it('should handle connection error without retry', async () => {
      const transportPromise = transporter.transport(validArtifact);

      // Simulate connection error with no retry
      mockEvents.emit('error', {
        error: new Error('Connection failed'),
        willRetry: false,
      });

      const result = await transportPromise;

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });

    it('should handle connection error with retry', async () => {
      const transportPromise = transporter.transport(validArtifact);

      // Simulate connection error with retry
      mockEvents.emit('error', {
        error: new Error('Connection failed'),
        willRetry: true,
      });

      // Should not resolve yet due to retry
      await vi.advanceTimersByTimeAsync(1);
      expect(transportPromise).toBeInstanceOf(Promise);

      // Simulate successful message after retry
      mockEvents.emit('message', { success: true });

      const result = await transportPromise;
      expect(result.response).toEqual({ success: true });
    });

    it('should handle connection end without retry', async () => {
      const transportPromise = transporter.transport(validArtifact);

      // Simulate connection end with no retry
      mockEvents.emit('end', { willRetry: false });

      const result = await transportPromise;

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Connection ended before message was received');
      expect(result.response).toBeUndefined();
    });

    it('should handle connection end with retry', async () => {
      const transportPromise = transporter.transport(validArtifact);

      // Simulate connection end with retry
      mockEvents.emit('end', { willRetry: true });

      // Should not resolve yet due to retry
      await vi.advanceTimersByTimeAsync(1);
      expect(transportPromise).toBeInstanceOf(Promise);

      // Simulate successful message after retry
      mockEvents.emit('message', { success: true });

      const result = await transportPromise;
      expect(result.response).toEqual({ success: true });
    });

    it('should handle unexpected errors during transport', async () => {
      // Mock connect to throw an error
      vi.spyOn(transporter, 'connect').mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await transporter.transport(validArtifact);

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.response).toBeUndefined();
    });

    it('should handle message received after error', async () => {
      const transportPromise = transporter.transport(validArtifact);

      // Simulate message received first
      mockEvents.emit('message', { success: true });

      // Then simulate error (should not affect the result)
      mockEvents.emit('error', {
        error: new Error('Connection failed'),
        willRetry: false,
      });

      const result = await transportPromise;

      // Should resolve with the message, not the error
      expect(result.response).toEqual({ success: true });
      expect(result.error).toBeUndefined();
    });

    it('should handle multiple errors with retry', async () => {
      const transportPromise = transporter.transport(validArtifact);

      // Simulate multiple errors with retry
      mockEvents.emit('error', {
        error: new Error('Connection failed 1'),
        willRetry: true,
      });

      mockEvents.emit('error', {
        error: new Error('Connection failed 2'),
        willRetry: true,
      });

      // Should not resolve yet due to retry
      await vi.advanceTimersByTimeAsync(1);
      expect(transportPromise).toBeInstanceOf(Promise);

      // Simulate successful message after retries
      mockEvents.emit('message', { success: true });

      const result = await transportPromise;
      expect(result.response).toEqual({ success: true });
    });
  });

  describe('signEncrypt', () => {
    const validPayload = {
      to: 'recipient$example.com',
      document: {
        title: 'Test Invoice',
        id: 'inv-001',
        issuedAt: '2023-01-01T00:00:00.000Z',
        status: 'unpaid',
        totalAmount: {
          value: 100,
          currency: 'USD',
        },
        lineItems: {
          columns: ['item', 'amount'],
          rows: [{ item: 'Test Item', amount: 100 }],
        },
      } as BTPDocType,
      type: 'BTPS_DOC' as BTPArtifactType,
    };

    it('should successfully sign and encrypt a valid payload', async () => {
      const result = await transporter.signEncrypt(validPayload);

      expect(mockValidation.validate).toHaveBeenCalled();
      expect(
        (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact,
      ).toHaveBeenCalledWith({
        ...validPayload,
        version: '1.0.0',
        from: 'test$example.com',
      });
      expect(result.payload).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should handle document validation failure', async () => {
      const invalidPayload = {
        ...validPayload,
        document: { invalid: 'document' } as BTPDocType,
      };

      mockValidation.validate.mockReturnValue({
        success: false,
        error: { message: 'Document validation failed' } as unknown as ZodError,
      });

      const result = await transporter.signEncrypt(invalidPayload);

      expect(mockValidation.validate).toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Invalid artifact');
      expect(result.payload).toBeUndefined();
    });

    it('should handle signEncryptArtifact error', async () => {
      const cryptoError = new BTPErrorException({ message: 'Crypto operation failed' });
      (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact = vi
        .fn()
        .mockResolvedValue({
          payload: undefined,
          error: cryptoError,
        });

      const result = await transporter.signEncrypt(validPayload);

      expect(result.error).toBe(cryptoError);
      expect(result.payload).toBeUndefined();
    });

    it('should handle unexpected errors during signEncrypt', async () => {
      // Mock signEncryptArtifact to throw an error
      (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact = vi
        .fn()
        .mockRejectedValue(new Error('Unexpected crypto error'));

      try {
        await transporter.signEncrypt(validPayload);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Unexpected crypto error');
      }
    });

    it('should handle different document types', async () => {
      const trustReqPayload = {
        ...validPayload,
        document: {
          name: 'Test Company',
          email: 'test@example.com',
          reason: 'Business partnership',
          phone: '+1234567890',
        } as BTPDocType,
        type: 'TRUST_REQ' as BTPArtifactType,
      };

      const result = await transporter.signEncrypt(trustReqPayload);

      expect(mockValidation.validate).toHaveBeenCalled();
      expect(
        (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact,
      ).toHaveBeenCalledWith({
        ...trustReqPayload,
        version: '1.0.0',
        from: 'test$example.com',
      });
      expect(result.payload).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should handle trust response document type', async () => {
      const trustResPayload = {
        ...validPayload,
        document: {
          decision: 'accepted',
          decidedAt: '2023-01-01T00:00:00.000Z',
          decidedBy: 'admin$example.com',
        } as BTPDocType,
        type: 'TRUST_RES' as BTPArtifactType,
      };

      const result = await transporter.signEncrypt(trustResPayload);

      expect(mockValidation.validate).toHaveBeenCalled();
      expect(
        (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact,
      ).toHaveBeenCalledWith({
        ...trustResPayload,
        version: '1.0.0',
        from: 'test$example.com',
      });
      expect(result.payload).toBeDefined();
      expect(result.error).toBeUndefined();
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle empty artifact in transport', async () => {
      const emptyArtifact = {} as BTPTransporterArtifact;
      mockValidation.validate.mockReturnValue({
        success: false,
        error: { message: 'Empty artifact' } as unknown as ZodError,
      });

      const result = await transporter.transport(emptyArtifact);

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Invalid artifact');
    });

    it('should handle null document in signEncrypt', async () => {
      const payloadWithNullDoc = {
        to: 'recipient$example.com',
        document: null as unknown as BTPDocType,
        type: 'BTPS_DOC' as BTPArtifactType,
      };

      mockValidation.validate.mockReturnValue({
        success: false,
        error: { message: 'Null document' } as unknown as ZodError,
      });

      const result = await transporter.signEncrypt(payloadWithNullDoc);

      expect(result.error).toBeInstanceOf(BTPErrorException);
      expect(result.error?.message).toBe('Invalid artifact');
    });

    it('should handle undefined payload properties', async () => {
      const incompletePayload = {
        to: 'recipient$example.com',
        // Missing document and type
      } as unknown as { to: string; document: BTPDocType; type: BTPArtifactType };

      await transporter.signEncrypt(incompletePayload);

      expect(mockValidation.validate).toHaveBeenCalled();
      // Should still attempt to sign encrypt with incomplete data
      expect(
        (transporter as unknown as { signEncryptArtifact: () => void }).signEncryptArtifact,
      ).toHaveBeenCalled();
    });

    it('should handle transport with encrypted document', async () => {
      const encryptedArtifact: BTPTransporterArtifact = {
        version: '1.0.0',
        issuedAt: '2023-01-01T00:00:00.000Z',
        document: 'encrypted-document-string',
        id: 'test-id',
        type: 'BTPS_DOC',
        from: 'sender$example.com',
        to: 'recipient$example.com',
        signature: {
          algorithm: 'sha256',
          value: 'signature-value',
          fingerprint: 'fingerprint-value',
        },
        encryption: {
          algorithm: 'aes-256-cbc',
          encryptedKey: 'encrypted-key',
          iv: 'initialization-vector',
          type: 'standardEncrypt',
        },
      };

      const transportPromise = transporter.transport(encryptedArtifact);

      mockEvents.emit('connected');
      mockEvents.emit('message', { success: true });

      const result = await transportPromise;

      expect(result.response).toEqual({ success: true });
      expect(result.error).toBeUndefined();
    });

    it('should handle delegation in artifact', async () => {
      const artifactWithDelegation: BTPTransporterArtifact = {
        version: '1.0.0',
        issuedAt: '2023-01-01T00:00:00.000Z',
        document: {
          title: 'Test Invoice',
          id: 'inv-001',
          issuedAt: '2023-01-01T00:00:00.000Z',
          status: 'unpaid',
          totalAmount: {
            value: 100,
            currency: 'USD',
          },
          lineItems: {
            columns: ['item', 'amount'],
            rows: [{ item: 'Test Item', amount: 100 }],
          },
        },
        id: 'test-id',
        type: 'BTPS_DOC',
        from: 'sender$example.com',
        to: 'recipient$example.com',
        signature: {
          algorithm: 'sha256',
          value: 'signature-value',
          fingerprint: 'fingerprint-value',
        },
        encryption: null,
        delegation: {
          agentId: 'agent-001',
          agentPubKey: 'agent-public-key',
          signedBy: 'delegator$example.com',
          signature: {
            algorithm: 'sha256',
            value: 'delegation-signature',
            fingerprint: 'delegation-fingerprint',
          },
          issuedAt: '2023-01-01T00:00:00.000Z',
        },
      };

      const transportPromise = transporter.transport(artifactWithDelegation);

      mockEvents.emit('connected');
      mockEvents.emit('message', { success: true });

      const result = await transportPromise;

      expect(result.response).toEqual({ success: true });
      expect(result.error).toBeUndefined();
    });
  });
});
