/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { BtpIdentityLookupRequestSchema } from './identityLookupSchema.js';

describe('BtpIdentityLookupRequestSchema', () => {
  it('should validate a valid identity lookup request', () => {
    const validRequest = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      identity: 'alice$example.com',
      from: 'bob$example.com',
      hostSelector: 'default',
    };

    const result = BtpIdentityLookupRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('should validate a valid identity lookup request with optional identitySelector', () => {
    const validRequest = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      identity: 'alice$example.com',
      from: 'bob$example.com',
      hostSelector: 'default',
      identitySelector: 'custom',
    };

    const result = BtpIdentityLookupRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('should fail validation for invalid identity format', () => {
    const invalidRequest = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      identity: 'invalid-identity',
      from: 'bob$example.com',
      hostSelector: 'default',
    };

    const result = BtpIdentityLookupRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['identity']);
    }
  });

  it('should fail validation for invalid from format', () => {
    const invalidRequest = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      identity: 'alice$example.com',
      from: 'invalid-from',
      hostSelector: 'default',
    };

    const result = BtpIdentityLookupRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['from']);
    }
  });

  it('should fail validation for missing required fields', () => {
    const invalidRequest = {
      version: '1.0.0',
      id: 'test-id-123',
      // missing issuedAt, identity, from, hostSelector
    };

    const result = BtpIdentityLookupRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
  });

  it('should fail validation for invalid issuedAt format', () => {
    const invalidRequest = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: 'invalid-date',
      identity: 'alice$example.com',
      from: 'bob$example.com',
      hostSelector: 'default',
    };

    const result = BtpIdentityLookupRequestSchema.safeParse(invalidRequest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['issuedAt']);
    }
  });
});
