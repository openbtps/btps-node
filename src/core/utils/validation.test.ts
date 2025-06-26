import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from './validation';
import { BtpArtifactServerSchema } from '../server/schema';

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
      type: 'btp_trust_request',
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
      type: 'btp_trust_request',
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
      type: 'btp_trust_request',
      document: {
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
      type: 'btp_trust_request',
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
      expect(result.error.issues[0].path).toEqual(['type']);
      expect(result.error.issues[0].message).toMatch(/Invalid enum value/);
    }
  });
});
