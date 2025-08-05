/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { BtpControlArtifactSchema } from './controlSchema.js';

describe('BtpControlArtifactSchema', () => {
  it('should validate a valid QUIT control artifact', () => {
    const validControl = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      action: 'QUIT',
    };

    const result = BtpControlArtifactSchema.safeParse(validControl);
    expect(result.success).toBe(true);
  });

  it('should validate a valid PING control artifact', () => {
    const validControl = {
      version: '1.0.0',
      id: 'test-id-456',
      issuedAt: '2024-01-01T00:00:00.000Z',
      action: 'PING',
    };

    const result = BtpControlArtifactSchema.safeParse(validControl);
    expect(result.success).toBe(true);
  });

  it('should fail validation for invalid action', () => {
    const invalidControl = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: '2024-01-01T00:00:00.000Z',
      action: 'INVALID',
    };

    const result = BtpControlArtifactSchema.safeParse(invalidControl);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['action']);
    }
  });

  it('should fail validation for missing required fields', () => {
    const invalidControl = {
      version: '1.0.0',
      id: 'test-id-123',
      // missing issuedAt and action
    };

    const result = BtpControlArtifactSchema.safeParse(invalidControl);
    expect(result.success).toBe(false);
  });

  it('should fail validation for invalid issuedAt format', () => {
    const invalidControl = {
      version: '1.0.0',
      id: 'test-id-123',
      issuedAt: 'invalid-date',
      action: 'QUIT',
    };

    const result = BtpControlArtifactSchema.safeParse(invalidControl);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['issuedAt']);
    }
  });
});
