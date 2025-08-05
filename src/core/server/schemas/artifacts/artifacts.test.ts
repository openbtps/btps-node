/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { BtpArtifactServerSchema } from './artifacts.js';

describe('BtpArtifactServerSchema', () => {
  it('should validate a valid control artifact', () => {
    const validControl = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      action: 'QUIT',
    };

    const result = BtpArtifactServerSchema.safeParse(validControl);
    expect(result.success).toBe(true);
  });

  it('should validate a valid identity lookup request', () => {
    const validIdentityLookup = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      identity: 'alice$example.com',
      from: 'bob$example.com',
      hostSelector: 'default',
    };

    const result = BtpArtifactServerSchema.safeParse(validIdentityLookup);
    expect(result.success).toBe(true);
  });

  it('should validate a valid agent artifact', () => {
    const validAgent = {
      id: 'test-id-123',
      action: 'system.ping',
      agentId: 'agent$example.com',
      to: 'alice$example.com',
      issuedAt: '2024-01-01T00:00:00.000Z',
      signature: {
        algorithmHash: 'sha256',
        value: 'test-signature',
        fingerprint: 'test-fingerprint',
      },
      encryption: null,
    };

    const result = BtpArtifactServerSchema.safeParse(validAgent);
    expect(result.success).toBe(true);
  });

  it('should validate a valid transporter artifact', () => {
    const validTransporter = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      type: 'TRUST_REQ',
      from: 'alice$example.com',
      to: 'bob$example.com',
      signature: {
        algorithmHash: 'sha256',
        value: 'test-signature',
        fingerprint: 'test-fingerprint',
      },
      encryption: null,
      document: {
        id: 'trust-req-123',
        name: 'Test Company',
        email: 'test@example.com',
        reason: 'Business partnership',
        phone: '+1234567890',
        address: '123 Test St, Test City, TC 12345',
        logoUrl: 'https://example.com/logo.png',
        displayName: 'Test Company Inc',
        websiteUrl: 'https://example.com',
        message: 'We would like to establish a trust relationship',
        expiresAt: '2024-12-31T23:59:59.000Z',
        privacyType: 'unencrypted',
      },
      selector: 'default',
    };

    const result = BtpArtifactServerSchema.safeParse(validTransporter);
    if (!result.success) {
      console.log('Validation errors:', JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('should fail validation for invalid artifact type', () => {
    const invalidArtifact = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      // Missing required fields for any artifact type
    };

    const result = BtpArtifactServerSchema.safeParse(invalidArtifact);
    expect(result.success).toBe(false);
  });
});
