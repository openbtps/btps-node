/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { validate } from '../../utils/validation.js';
import { BtpServerResponseSchema } from './responseSchema.js';

describe('BtpServerResponseSchema', () => {
  it('should validate a valid btps_response', () => {
    const validResponse = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
    };

    const result = validate(BtpServerResponseSchema, validResponse);
    expect(result.success).toBe(true);
  });

  it('should validate a valid btps_error', () => {
    const validError = {
      version: '1.0.0',
      status: {
        ok: false,
        code: 400,
        message: 'Bad Request',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_error' as const,
      reqId: 'req-123',
    };

    const result = validate(BtpServerResponseSchema, validError);
    expect(result.success).toBe(true);
  });

  it('should validate response with auth document', () => {
    const validResponseWithAuth = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
      document: {
        agentId: 'agent-123',
        refreshToken: 'refresh-token-123',
        expiresAt: '2025-01-02T00:00:00.000Z',
        decryptBy: 'alice$example.com',
      },
    };

    const result = validate(BtpServerResponseSchema, validResponseWithAuth);
    expect(result.success).toBe(true);
  });

  it('should validate response with auth document including decryptBy', () => {
    const validResponseWithAuth = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
      document: {
        agentId: 'agent-123',
        refreshToken: 'refresh-token-123',
        expiresAt: '2025-01-02T00:00:00.000Z',
        decryptBy: 'alice$example.com',
      },
    };

    const result = validate(BtpServerResponseSchema, validResponseWithAuth);
    expect(result.success).toBe(true);
  });

  it('should fail validation for auth document without decryptBy', () => {
    const invalidResponseWithAuth = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
      document: {
        agentId: 'agent-123',
        refreshToken: 'refresh-token-123',
        expiresAt: '2025-01-02T00:00:00.000Z',
        // Missing decryptBy field
      },
    };

    const result = validate(BtpServerResponseSchema, invalidResponseWithAuth);
    expect(result.success).toBe(false);
  });

  it('should validate response with query result document', () => {
    const validResponseWithQuery = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
      document: {
        results: [],
        cursor: 'next-cursor',
        total: 0,
        hasNext: false,
      },
    };

    const result = validate(BtpServerResponseSchema, validResponseWithQuery);
    expect(result.success).toBe(true);
  });

  describe('a trust.fetch answer listing trust records', () => {
    const trustRecord = {
      id: 'fb275f18c0d1',
      createdAt: '2025-01-01T00:00:00.000Z',
      senderId: 'billing$vendor.com',
      receiverId: 'billing$yourdomain.com',
      status: 'accepted',
      decidedBy: 'billing$yourdomain.com',
      decidedAt: '2025-01-02T00:00:00.000Z',
      publicKeyBase64: 'cHVibGljLWtleQ==',
      publicKeyFingerprint: 'c'.repeat(64),
      keyHistory: [
        {
          fingerprint: 'b'.repeat(64),
          firstSeen: '2024-06-01T00:00:00.000Z',
          lastSeen: '2025-01-01T00:00:00.000Z',
        },
      ],
      privacyType: 'encrypted',
    };
    const answerWith = (artifact: unknown) => ({
      version: '1.0.0',
      status: { ok: true, code: 200 },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      document: { results: [{ artifact, meta: { status: 'accepted' } }] },
    });

    it('is valid', () => {
      expect(validate(BtpServerResponseSchema, answerWith(trustRecord)).success).toBe(true);
    });

    it('is refused when a record is not a trust record', () => {
      const unknownStatus = { ...trustRecord, status: 'maybe' };
      const noKey = { ...trustRecord, publicKeyBase64: undefined };

      expect(validate(BtpServerResponseSchema, answerWith(unknownStatus)).success).toBe(false);
      expect(validate(BtpServerResponseSchema, answerWith(noKey)).success).toBe(false);
    });

    it('takes a pending trust, not yet decided, and only a pending one, without a decision', () => {
      const undecided = { decidedBy: '', decidedAt: '' };

      expect(
        validate(
          BtpServerResponseSchema,
          answerWith({ ...trustRecord, ...undecided, status: 'pending' }),
        ).success,
      ).toBe(true);
      expect(
        validate(BtpServerResponseSchema, answerWith({ ...trustRecord, ...undecided })).success,
      ).toBe(false);
    });
  });

  it('should validate a signed identity lookup answer', () => {
    const identityAnswer = {
      version: '1.0.0',
      status: { ok: true, code: 200, message: 'success' },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
      document: { selector: 'btps1', publicKey: 'public-key', keyType: 'rsa', version: '1.0.0' },
      signature: { algorithmHash: 'sha256' as const, value: 'sig', fingerprint: 'fp' },
      signedBy: 'host$example.com',
      selector: 'btps1',
    };

    expect(validate(BtpServerResponseSchema, identityAnswer).success).toBe(true);
    expect(
      validate(BtpServerResponseSchema, {
        ...identityAnswer,
        document: { ...identityAnswer.document, keyType: 'ec' },
      }).success,
    ).toBe(false);
  });

  it('should validate response with signature and encryption', () => {
    const validResponseWithCrypto = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
      reqId: 'req-123',
      document: 'document-value',
      signature: {
        algorithmHash: 'sha256' as const,
        value: 'signature-value',
        fingerprint: 'fingerprint-value',
      },
      encryption: {
        algorithm: 'aes-256-gcm' as const,
        encryptedKey: 'encrypted-key',
        iv: 'iv-value',
        type: 'standardEncrypt' as const,
        authTag: 'auth-tag-value',
      },
      signedBy: 'alice$example.com',
      selector: 'btps1',
    };

    const result = validate(BtpServerResponseSchema, validResponseWithCrypto);
    expect(result.success).toBe(true);
  });

  it('should fail validation for invalid version', () => {
    const invalidResponse = {
      version: 'invalid-version',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
    };

    const result = validate(BtpServerResponseSchema, invalidResponse);
    expect(result.success).toBe(false);
  });

  it('should fail validation for invalid status', () => {
    const invalidResponse = {
      version: '1.0.0',
      status: {
        ok: 'not-boolean',
        code: 'not-number',
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'btps_response' as const,
    };

    const result = validate(BtpServerResponseSchema, invalidResponse);
    expect(result.success).toBe(false);
  });

  it('should fail validation for invalid type', () => {
    const invalidResponse = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: '2025-01-01T00:00:00.000Z',
      type: 'invalid_type',
    };

    const result = validate(BtpServerResponseSchema, invalidResponse);
    expect(result.success).toBe(false);
  });

  it('should fail validation for invalid issuedAt', () => {
    const invalidResponse = {
      version: '1.0.0',
      status: {
        ok: true,
        code: 200,
        message: 'Success',
      },
      id: '123e4567-e89b-12d3-a456-426614174000',
      issuedAt: 'invalid-date',
      type: 'btps_response' as const,
    };

    const result = validate(BtpServerResponseSchema, invalidResponse);
    expect(result.success).toBe(false);
  });
});
