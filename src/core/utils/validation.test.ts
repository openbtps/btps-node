/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from './validation.js';
import { validateAgentDocument } from '../server/schemas/helpers.js';
import { BtpArtifactServerSchema } from '../server/schemas/artifacts/artifacts.js';

describe('validate', () => {
  const testSchema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it('should return success for valid data', () => {
    const data = { name: 'John Doe', age: 30 };
    const result = validate(testSchema, data);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(data);
    }
  });

  it('should return an error for invalid data', () => {
    const data = { name: 'John Doe', age: 'thirty' }; // age is a string
    const result = validate(testSchema, data);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
      expect(result.error.issues[0].path).toEqual(['age']);
    }
  });

  it('should return an error for missing data', () => {
    const data = { name: 'John Doe' }; // age is missing
    const result = validate(testSchema, data);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

describe('BtpArtifactServerSchema superRefine', () => {
  const base = {
    version: '1.0.0',
    issuedAt: new Date().toISOString(),
    id: 'abc123',
    from: 'user$domain.com',
    to: 'user$domain.com',
    signature: {
      algorithm: 'sha256',
      value: 'sig',
      fingerprint: 'fp',
    },
  };

  it('should succeed when encryption is present and document is a string', () => {
    const data = {
      ...base,
      type: 'TRUST_REQ',
      document: 'encryptedstring',
      encryption: {
        algorithm: 'aes-256-cbc',
        encryptedKey: 'key',
        iv: 'iv',
        type: 'standardEncrypt',
      },
    };
    const result = BtpArtifactServerSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should fail when encryption is present and document is not a string', () => {
    const data = {
      ...base,
      type: 'TRUST_REQ',
      document: { foo: 'bar' },
      encryption: {
        algorithm: 'aes-256-cbc',
        encryptedKey: 'key',
        iv: 'iv',
        type: 'standardEncrypt',
      },
    };
    const result = BtpArtifactServerSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/must be a string/);
      expect(result.error.issues[0].path).toEqual(['document']);
    }
  });

  it('should succeed when encryption is null and document matches schema', () => {
    const data = {
      ...base,
      type: 'TRUST_REQ',
      document: {
        id: 'randomId',
        name: 'Alice',
        email: 'alice@example.com',
        reason: 'test',
        phone: '123',
      },
      encryption: null,
    };
    const result = BtpArtifactServerSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should fail when encryption is null and document does not match schema', () => {
    const data = {
      ...base,
      type: 'TRUST_REQ',
      document: { foo: 'bar' },
      encryption: null,
    };
    const result = BtpArtifactServerSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/does not match the artifact type/);
      expect(result.error.issues[0].path).toEqual(['document']);
    }
  });

  it('should fail when type is unknown', () => {
    const data = {
      ...base,
      type: 'unknown_type',
      document: {},
      encryption: null,
    };
    // Intentionally passing an invalid type to check runtime validation
    const result = BtpArtifactServerSchema.safeParse(data);
    expect(result.success).toBe(false);
    if (!result.success) {
      const unionError = result.error.issues.find((issue) => issue.code === 'invalid_union');
      const typeError = unionError?.unionErrors
        ?.flatMap((err) => err.issues)
        ?.find((issue) => issue.path[0] === 'type' && issue.code === 'invalid_enum_value');
      expect(typeError).toBeDefined();
      if (typeError) {
        expect(typeError.path).toEqual(['type']);
        expect(typeError.message).toMatch(/Invalid enum value/);
      }
    }
  });
});

describe('validateAgentDocument', () => {
  it('should return true for valid trust.request with correct document', () => {
    const doc = {
      id: 'randomId',
      name: 'Alice',
      email: 'alice@example.com',
      reason: 'test',
      phone: '123',
    };
    expect(validateAgentDocument('trust.request', doc)).toBe(true);
  });

  it('should return false for trust.request with missing document', () => {
    expect(validateAgentDocument('trust.request', undefined)).toBe(false);
  });

  it('should return false for trust.request with invalid document', () => {
    const doc = { foo: 'bar' };
    expect(validateAgentDocument('trust.request', doc)).toBe(false);
  });

  it('should return true for trust.update with valid mutation document', () => {
    const doc = {
      id: '1',
      document: {
        id: 'randomId',
        name: 'Alice',
        email: 'alice@example.com',
        reason: 'test',
        phone: '123',
      },
    };
    expect(validateAgentDocument('trust.update', doc)).toBe(true);
  });

  it('should return false for trust.update with invalid mutation document', () => {
    const doc = { id: '1', document: { foo: 'bar' } };
    expect(validateAgentDocument('trust.update', doc)).toBe(false);
  });

  it('should return true for trust.delete with valid delete cancel document', () => {
    const doc = { ids: ['1', '2'] };
    expect(validateAgentDocument('trust.delete', doc)).toBe(true);
  });

  it('should return false for trust.delete with invalid delete cancel document', () => {
    const doc = { foo: 'bar' };
    expect(validateAgentDocument('trust.delete', doc)).toBe(false);
  });

  it('should return true for draft.create with valid create document', () => {
    const doc = {
      type: 'TRUST_REQ',
      document: {
        id: 'randomId',
        name: 'Alice',
        email: 'alice@example.com',
        reason: 'test',
        phone: '123',
      },
    };
    expect(validateAgentDocument('draft.create', doc)).toBe(true);
  });

  it('should return false for draft.create with missing document', () => {
    expect(validateAgentDocument('draft.create', undefined)).toBe(false);
  });

  it('should return false for draft.create with invalid create document', () => {
    const doc = { foo: 'bar' };
    expect(validateAgentDocument('draft.create', doc)).toBe(false);
  });

  it('should return false for draft.create with invalid type in create document', () => {
    const doc = {
      type: 'INVALID_TYPE',
      document: {
        id: 'randomId',
        name: 'Alice',
        email: 'alice@example.com',
        reason: 'test',
        phone: '123',
      },
    };
    expect(validateAgentDocument('draft.create', doc)).toBe(false);
  });

  it('should return true for unknown action (not requiring document)', () => {
    expect(validateAgentDocument('system.ping', undefined)).toBe(true);
  });

  it('should return true for unknown action with document', () => {
    expect(validateAgentDocument('system.ping', { foo: 'bar' })).toBe(true);
  });

  it('should return false for required action with null document', () => {
    expect(validateAgentDocument('trust.request', null)).toBe(false);
  });

  it('should return false for required action with empty object', () => {
    expect(validateAgentDocument('trust.request', {})).toBe(false);
  });

  it('should return true for inbox.fetch with valid query document including cursor', () => {
    const doc = {
      cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
      limit: 10,
      sort: 'desc',
    };
    expect(validateAgentDocument('inbox.fetch', doc)).toBe(true);
  });

  it('should return true for outbox.fetch with valid query document including cursor', () => {
    const doc = {
      cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
      query: {
        title: { like: 'Invoice' },
        from: { eq: 'alice$example.com' },
      },
      limit: 20,
    };
    expect(validateAgentDocument('outbox.fetch', doc)).toBe(true);
  });

  it('should return true for draft.fetch with valid query document including cursor', () => {
    const doc = {
      cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
      since: '2024-01-01T00:00:00.000Z',
      until: '2024-12-31T23:59:59.999Z',
      limit: 50,
    };
    expect(validateAgentDocument('draft.fetch', doc)).toBe(true);
  });

  it('should return true for trash.fetch with valid query document including cursor', () => {
    const doc = {
      cursor: 'eyJpZCI6IjEyMyIsImlzc3VlZEF0IjoiMjAyNC0wMS0wMVQwMDowMDowMC4wMDBaIn0=',
      limit: 100,
    };
    expect(validateAgentDocument('trash.fetch', doc)).toBe(true);
  });

  it('should return false for fetch action with invalid query document', () => {
    const doc = { foo: 'bar' };
    expect(validateAgentDocument('inbox.fetch', doc)).toBe(false);
  });

  it('should return false for fetch action with empty query document', () => {
    const doc = {};
    expect(validateAgentDocument('outbox.fetch', doc)).toBe(false);
  });
});
