/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  consumeRegistrationToken,
  isAgentId,
  resolveAgentKey,
  REGISTRATION_ERRORS,
} from './registration.js';
import { InMemoryTokenStore } from './storage/InMemoryTokenStore.js';
import { BtpsAuthentication } from './BtpsAuthentication.js';
import { computeTrustId } from '@core/trust/index.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { TokenStore } from './types.js';

const ALICE = 'alice$saas.example';
const BOB = 'bob$saas.example';
const MINUTE = 60 * 1000;

const storeWith = async (token: string, identity: string, expiryMs = 15 * MINUTE) => {
  const store = new InMemoryTokenStore();
  await store.store(token, null, identity, expiryMs, identity);
  return store;
};

describe('TokenStore.consume (InMemoryTokenStore)', () => {
  afterEach(() => vi.useRealTimers());

  it('consumes a token once, then answers used until it would have expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'));
    const store = await storeWith('K7Q2M9X4P8RW', ALICE);
    const first = await store.consume(ALICE, 'K7Q2M9X4P8RW');
    expect(first.status).toBe('consumed');
    expect(first.status === 'consumed' && first.record.userIdentity).toBe(ALICE);
    expect((await store.consume(ALICE, 'K7Q2M9X4P8RW')).status).toBe('used');
    expect(await store.get(ALICE, 'K7Q2M9X4P8RW')).toBeUndefined();
    vi.setSystemTime(new Date('2026-10-16T00:15:01.000Z'));
    expect((await store.consume(ALICE, 'K7Q2M9X4P8RW')).status).toBe('invalid');
  });

  it('refuses an expired token as invalid', async () => {
    const store = await storeWith('K7Q2M9X4P8RW', ALICE, -MINUTE);
    expect((await store.consume(ALICE, 'K7Q2M9X4P8RW')).status).toBe('invalid');
  });

  it('looks a token up only under the key it was stored under', async () => {
    const store = await storeWith('K7Q2M9X4P8RW', BOB);
    expect((await store.consume(ALICE, 'K7Q2M9X4P8RW')).status).toBe('invalid');
    expect((await store.consume(BOB, 'K7Q2M9X4P8RW')).status).toBe('consumed');
  });

  it('gives one of many concurrent calls the token', async () => {
    const store = await storeWith('K7Q2M9X4P8RW', ALICE);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.consume(ALICE, 'K7Q2M9X4P8RW')),
    );
    expect(results.filter((r) => r.status === 'consumed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'used')).toHaveLength(9);
  });
});

describe('consumeRegistrationToken (item E)', () => {
  const request = (authToken: string, identity = ALICE, to = ALICE) => ({
    identity,
    to,
    authToken,
  });

  it('accepts a token issued to the identity, once', async () => {
    const store = await storeWith('K7Q2M9X4P8RW', ALICE);
    const result = await consumeRegistrationToken(store, request('K7Q2M9X4P8RW'));
    expect(result.ok && result.identity).toBe(ALICE);
    const again = await consumeRegistrationToken(store, request('K7Q2M9X4P8RW'));
    expect(!again.ok && again.reason).toBe('used');
    expect(!again.ok && again.error.code).toBe('BTP_ERROR_REGISTRATION_TOKEN_USED');
  });

  it.each([
    ['unavailable', undefined, request('K7Q2M9X4P8RW'), 'BTP_ERROR_REGISTRATION_UNAVAILABLE'],
    ['missing', 'store', request(''), 'BTP_ERROR_REGISTRATION_TOKEN_MISSING'],
    ['missing', 'store', request('   '), 'BTP_ERROR_REGISTRATION_TOKEN_MISSING'],
    [
      'identity-mismatch',
      'store',
      request('K7Q2M9X4P8RW', BOB, ALICE),
      'BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH',
    ],
    ['invalid', 'store', request('ZZZZZZZZZZZZ'), 'BTP_ERROR_REGISTRATION_TOKEN_INVALID'],
  ] as const)('refuses as %s', async (reason, hasStore, req, code) => {
    const store = hasStore ? await storeWith('K7Q2M9X4P8RW', ALICE) : undefined;
    const result = await consumeRegistrationToken(store, req);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe(reason);
    expect(!result.ok && result.error.code).toBe(code);
  });

  it('refuses a mismatch before touching the token', async () => {
    const store = await storeWith('K7Q2M9X4P8RW', BOB);
    await consumeRegistrationToken(store, request('K7Q2M9X4P8RW', BOB, ALICE));
    expect((await consumeRegistrationToken(store, request('K7Q2M9X4P8RW', BOB, BOB))).ok).toBe(
      true,
    );
  });

  it('refuses a record issued to another identity, from a store that ignores the key', async () => {
    const lax: TokenStore = {
      store: async () => {},
      get: async () => undefined,
      remove: async () => {},
      cleanup: async () => {},
      consume: async () => ({
        status: 'consumed',
        record: {
          token: 'K7Q2M9X4P8RW',
          agentId: 'anonymous',
          userIdentity: BOB,
          createdAt: '',
          expiresAt: '',
          decryptBy: BOB,
        },
      }),
    };
    const result = await consumeRegistrationToken(lax, request('K7Q2M9X4P8RW'));
    expect(!result.ok && result.reason).toBe('identity-mismatch');
  });

  it('has one distinct error per reason', () => {
    const codes = REGISTRATION_ERRORS.map((e) => e.code);
    expect(new Set(codes).size).toBe(5);
  });

  it('BtpsAuthentication.validateAuthToken consumes through it', async () => {
    const tokenStore = new InMemoryTokenStore();
    const auth = new BtpsAuthentication({
      trustStore: {} as AbstractTrustStore<BTPTrustRecord>,
      tokenStore,
    });
    await auth.storeAuthToken('K7Q2M9X4P8RW', ALICE, ALICE);
    const results = await Promise.all([
      auth.validateAuthToken(ALICE, 'K7Q2M9X4P8RW'),
      auth.validateAuthToken(ALICE, 'K7Q2M9X4P8RW'),
    ]);
    expect(results.filter((r) => r.isValid)).toHaveLength(1);
  });
});

describe('resolveAgentKey (fix-list item 5)', () => {
  const record = (senderId: string, receiverId: string): BTPTrustRecord => ({
    id: computeTrustId(senderId, receiverId),
    senderId,
    receiverId,
    status: 'accepted',
    createdAt: '',
    decidedBy: receiverId,
    decidedAt: '',
    publicKeyBase64: 'VEVTVA',
    publicKeyFingerprint: 'fp',
    keyHistory: [],
    privacyType: 'unencrypted',
  });
  const storeOf = (...records: BTPTrustRecord[]) =>
    ({
      getById: async (id: string) => records.find((r) => r.id === id),
    }) as unknown as AbstractTrustStore<BTPTrustRecord>;

  it('tells an agent id from an identity', () => {
    expect(isAgentId(BtpsAuthentication.generateAgentId())).toBe(true);
    expect(isAgentId('carol$other.example')).toBe(false);
    expect(isAgentId('')).toBe(false);
  });

  it('resolves the key in an agent record', async () => {
    const agentId = BtpsAuthentication.generateAgentId();
    const result = await resolveAgentKey(storeOf(record(agentId, ALICE)), { agentId, to: ALICE });
    expect(result.ok && result.publicKeyPem).toContain('VEVTVA');
  });

  it('never resolves a record between two identities', async () => {
    const carol = 'carol$other.example';
    const result = await resolveAgentKey(storeOf(record(carol, ALICE)), {
      agentId: carol,
      to: ALICE,
    });
    expect(!result.ok && result.reason).toBe('not-an-agent');
  });

  it('refuses a missing record, and a record that is not this binding', async () => {
    const agentId = BtpsAuthentication.generateAgentId();
    const missing = await resolveAgentKey(storeOf(), { agentId, to: ALICE });
    expect(!missing.ok && missing.reason).toBe('no-record');
    const wrong = { ...record('btps_ag_other', ALICE), id: computeTrustId(agentId, ALICE) };
    const mismatch = await resolveAgentKey(storeOf(wrong), { agentId, to: ALICE });
    expect(!mismatch.ok && mismatch.reason).toBe('record-mismatch');
  });
});
