/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isTrustActive,
  validateTrustRequest,
  computeTrustId,
  validateTrustResponse,
  canRetryTrust,
  AbstractTrustStore,
  trustPermissionsFromRequest,
  trustPermissionsFromResponse,
} from './index.js';
import { BTPTrustRecord } from './types.js';

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

  describe('since 1.2, a change', () => {
    const change = { change: true as const };
    const pending = {
      requested: [{ name: 'send:invoice' as const, required: true }],
      requestedAt: past.toISOString(),
    };
    const permissions = { requested: [], granted: [], detailsHeld: [], detailsShared: [] };

    it('is taken on an active trust, a 1.1 trust without permissions too', () => {
      const withPermissions = makeTrust({ status: 'accepted', permissions });
      expect(validateTrustRequest(withPermissions, change).isValid).toBe(true);
      expect(validateTrustRequest(makeTrust({ status: 'accepted' }), change).isValid).toBe(true);
    });

    it('is refused while another change is pending on the trust', () => {
      const trust = makeTrust({
        status: 'accepted',
        permissions: { ...permissions, pendingChange: pending },
      });
      const { isValid, error } = validateTrustRequest(trust, change);
      expect(isValid).toBe(false);
      expect(error?.cause).toBe('a change is already pending on this trust');
    });

    it('is refused without an active trust: none, pending, blocked, rejected, expired, before its retry date', () => {
      const inactive = [
        undefined,
        makeTrust({ status: 'pending' }),
        makeTrust({ status: 'blocked' }),
        makeTrust({ status: 'rejected' }),
        makeTrust({ status: 'accepted', expiresAt: past.toISOString() }),
        makeTrust({ status: 'rejected', retryAfterDate: future.toISOString() }),
      ];
      for (const trust of inactive) {
        expect(validateTrustRequest(trust, change).isValid, trust?.status ?? 'none').toBe(false);
      }
    });

    it('leaves a request that is not a change refused on an active trust, as before', () => {
      const { error } = validateTrustRequest(makeTrust({ status: 'accepted' }), {});
      expect(error?.code).toBe('BTP_ERROR_TRUST_ALREADY_ACTIVE');
    });
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

  describe('since 1.2, with granted', () => {
    const permissions = {
      requested: [
        { name: 'send:invoice' as const, required: true },
        { name: 'detail:email' as const, required: false },
      ],
      granted: [],
      detailsHeld: [],
      detailsShared: [],
    };
    const answer = (granted: ('send:invoice' | 'detail:email' | 'send:letter')[]) =>
      validateTrustResponse('b$domain.com', 'a$domain.com', mockTrustStore, { granted });

    it('takes an answer granting every required name', async () => {
      mockTrustStore.getById = vi.fn().mockResolvedValue(makeTrust({ permissions }));
      expect((await answer(['send:invoice'])).isValid).toBe(true);
    });

    it('refuses an answer without a required name: BTP_ERROR_PERMISSION_REQUIRED', async () => {
      mockTrustStore.getById = vi.fn().mockResolvedValue(makeTrust({ permissions }));
      const result = await answer(['detail:email']);
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('BTP_ERROR_PERMISSION_REQUIRED');
    });

    it('refuses a name the request never asked for: BTP_ERROR_PERMISSION', async () => {
      mockTrustStore.getById = vi.fn().mockResolvedValue(makeTrust({ permissions }));
      const result = await answer(['send:invoice', 'send:letter']);
      expect(result.error?.code).toBe('BTP_ERROR_PERMISSION');
    });

    it('refuses granted where the record has no permissions to check it against', async () => {
      mockTrustStore.getById = vi.fn().mockResolvedValue(makeTrust({}));
      const result = await answer(['send:invoice']);
      expect(result.error?.code).toBe('BTP_ERROR_PERMISSION_REQUIRED');
    });

    it('takes an answer to the change an accepted trust has pending, checked against the change', async () => {
      const pendingChange = {
        requested: [...permissions.requested, { name: 'send:letter' as const, required: true }],
        requestedAt: now.toISOString(),
      };
      mockTrustStore.getById = vi
        .fn()
        .mockResolvedValue(
          makeTrust({ status: 'accepted', permissions: { ...permissions, pendingChange } }),
        );
      expect((await answer(['send:invoice', 'send:letter'])).isValid).toBe(true);
      expect((await answer(['send:invoice'])).error?.code).toBe('BTP_ERROR_PERMISSION_REQUIRED');
    });

    it('refuses a further answer once the platform has cleared the answered change', async () => {
      mockTrustStore.getById = vi
        .fn()
        .mockResolvedValue(makeTrust({ status: 'accepted', permissions }));
      const result = await answer(['send:invoice']);
      expect(result.isValid).toBe(false);
      expect(result.error?.code).toBe('BTP_ERROR_TRUST_NOT_ALLOWED');
    });
  });
});

describe('trust record permissions, for the platform to save', () => {
  const request = {
    permissions: [
      { name: 'send:invoice' as const, required: true },
      { name: 'detail:email' as const, required: true },
    ],
    given: ['detail:email' as const, 'detail:registrationNumber' as const],
    issuedAt: now.toISOString(),
  };

  it('keeps what a request asked for on the requester own record', () => {
    expect(trustPermissionsFromRequest(request)).toEqual({
      requested: request.permissions,
      granted: [],
      detailsHeld: [],
      detailsShared: [],
    });
  });

  it('keeps nothing for a request without permissions, a 1.1 trust', () => {
    expect(trustPermissionsFromRequest({ issuedAt: request.issuedAt })).toBeUndefined();
  });

  it('adds a change as pending, so the trust runs on its old grant meanwhile', () => {
    const current = {
      ...trustPermissionsFromRequest(request)!,
      granted: ['send:invoice' as const],
    };
    expect(trustPermissionsFromRequest({ ...request, change: true }, current)).toEqual({
      ...current,
      pendingChange: { requested: request.permissions, requestedAt: request.issuedAt },
    });
  });

  it('gives each side what it holds of the other once accepted', () => {
    const saved = trustPermissionsFromResponse(
      { granted: ['send:invoice', 'detail:email'] },
      request,
    );
    expect(saved?.requester).toMatchObject({
      detailsHeld: ['detail:email'],
      detailsShared: request.given,
    });
    expect(saved?.responder).toMatchObject({
      detailsHeld: request.given,
      detailsShared: ['detail:email'],
    });
  });

  it('keeps nothing for an answer that grants nothing by name', () => {
    expect(trustPermissionsFromResponse({}, request)).toBeUndefined();
  });
});
