import { describe, it, expect, vi } from 'vitest';
import {
  isTrustActive,
  validateTrustRequest,
  computeTrustId,
  validateTrustResponse,
  canRetryTrust,
  AbstractTrustStore,
} from './index.js';
import { BTPTrustRecord } from './types';

const now = new Date();
const past = new Date('2025-06-24T03:20:18.290Z');
const future = new Date('2050-06-26T03:20:18.290Z');

// Fake trust record factory
const makeTrust = (overrides: Partial<BTPTrustRecord>): BTPTrustRecord => ({
  id: 'mock',
  senderId: 'a$domain.com',
  receiverId: 'b$domain.com',
  status: 'pending',
  createdAt: now.toISOString(),
  decidedBy: 'admin',
  decidedAt: now.toISOString(),
  publicKeyBase64: 'key',
  publicKeyFingerprint: 'fp',
  keyHistory: [],
  privacyType: 'unencrypted',
  ...overrides,
});

describe('isTrustActive()', () => {
  it('returns false if trust is undefined or empty', () => {
    expect(isTrustActive(undefined)).toBe(false);
    expect(isTrustActive({} as BTPTrustRecord)).toBe(false);
  });

  it('returns false if trust is not accepted', () => {
    const trust = makeTrust({ status: 'pending' });
    expect(isTrustActive(trust)).toBe(false);
  });

  it('returns false if trust is expired', () => {
    const trust = makeTrust({ status: 'accepted', expiresAt: past.toISOString() });
    expect(isTrustActive(trust)).toBe(false);
  });

  it('returns true if trust is accepted and not expired', () => {
    const trust = makeTrust({ status: 'accepted', expiresAt: future.toISOString() });
    expect(isTrustActive(trust)).toBe(true);
  });

  it('returns true if accepted and no expiresAt', () => {
    const trust = makeTrust({ status: 'accepted', expiresAt: undefined });
    expect(isTrustActive(trust)).toBe(true);
  });
});

describe('validateTrustRequest()', () => {
  it('returns invalid if trust is active', () => {
    const trust = makeTrust({ status: 'accepted' });
    expect(validateTrustRequest(trust).isValid).toBe(false);
  });

  it('returns invalid if trust is blocked', () => {
    const trust = makeTrust({ status: 'blocked' });
    expect(validateTrustRequest(trust).isValid).toBe(false);
  });

  it('returns invalid if retryAfterDate is in future', () => {
    const trust = makeTrust({ retryAfterDate: future.toISOString() });
    expect(validateTrustRequest(trust).isValid).toBe(false);
  });

  it('returns valid if retryAfterDate has passed', () => {
    const trust = makeTrust({ retryAfterDate: past.toISOString() });
    expect(validateTrustRequest(trust).isValid).toBe(true);
  });

  it('returns valid if trust is rejected and no retryAfterDate', () => {
    const trust = makeTrust({ status: 'rejected', retryAfterDate: undefined });
    expect(validateTrustRequest(trust).isValid).toBe(true);
  });

  it('returns valid if trust is undefined (first-time)', () => {
    expect(validateTrustRequest(undefined).isValid).toBe(true);
  });
});

describe('canRetryTrust()', () => {
  it('returns true if trust is undefined or empty', () => {
    expect(canRetryTrust(undefined)).toBe(true);
    expect(canRetryTrust({} as BTPTrustRecord)).toBe(true);
  });

  it('returns false if status is accepted or blocked', () => {
    expect(canRetryTrust(makeTrust({ status: 'accepted' }))).toBe(false);
    expect(canRetryTrust(makeTrust({ status: 'blocked' }))).toBe(false);
  });

  it('returns false if retryAfterDate is in future', () => {
    const trust = makeTrust({ retryAfterDate: future.toISOString() });
    expect(canRetryTrust(trust)).toBe(false);
  });

  it('returns true if retryAfterDate has passed or not set', () => {
    expect(canRetryTrust(makeTrust({ retryAfterDate: past.toISOString() }))).toBe(true);
    expect(canRetryTrust(makeTrust({ retryAfterDate: undefined }))).toBe(true);
  });
});

describe('computeTrustId()', () => {
  it('produces a deterministic hash', () => {
    const id1 = computeTrustId('a$example.com', 'b$example.com');
    const id2 = computeTrustId('a$example.com', 'b$example.com');
    expect(id1).toEqual(id2);
  });

  it('is case insensitive and direction-sensitive', () => {
    const id1 = computeTrustId('A$example.com', 'B$example.com');
    const id2 = computeTrustId('a$example.com', 'b$example.com');
    const reversed = computeTrustId('b$example.com', 'a$example.com');
    expect(id1).toEqual(id2);
    expect(reversed).not.toEqual(id1);
  });
});

describe('validateTrustResponse()', () => {
  const mockTrustStore = {
    getById: vi.fn(),
  } as unknown as AbstractTrustStore<BTPTrustRecord>;

  it('rejects response if no pending trust exists', async () => {
    mockTrustStore.getById = vi.fn().mockResolvedValue(undefined);
    const result = await validateTrustResponse('b$domain.com', 'a$domain.com', mockTrustStore);
    expect(result.isValid).toBe(false);
    expect(result.error?.cause).toContain('No pending trust request');
  });

  it('rejects if trust is not pending', async () => {
    mockTrustStore.getById = vi.fn().mockResolvedValue(makeTrust({ status: 'accepted' }));
    const result = await validateTrustResponse('b$domain.com', 'a$domain.com', mockTrustStore);
    expect(result.isValid).toBe(false);
    expect(result.error?.cause).toContain('not pending');
  });

  it('rejects if response comes from wrong party (spoofed)', async () => {
    mockTrustStore.getById = vi.fn().mockResolvedValue(
      makeTrust({
        status: 'pending',
        receiverId: 'c$domain.com', // attacker sending as someone else
      }),
    );
    const result = await validateTrustResponse('b$domain.com', 'a$domain.com', mockTrustStore);
    expect(result.isValid).toBe(false);
    expect(result.error?.cause).toContain('can respond');
  });

  it('accepts valid trust response from correct receiver', async () => {
    mockTrustStore.getById = vi.fn().mockResolvedValue(
      makeTrust({
        status: 'pending',
        receiverId: 'b$domain.com',
      }),
    );
    const result = await validateTrustResponse('b$domain.com', 'a$domain.com', mockTrustStore);
    expect(result.isValid).toBe(true);
  });
});
