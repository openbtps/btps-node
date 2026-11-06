/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: device-key theft signals and a device key's age. A key's age is
 * read from the record as it is: the current key came into use when the key
 * before it was retired (the newest keyHistory entry's lastSeen), or when the
 * device registered. A refresh token used a second time is theft: the device
 * is revoked and `refreshTokenReused` fires. A server may refuse a key older
 * than `maxKeyAgeMs` until the device moves to a new one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BtpsAuthentication } from './BtpsAuthentication.js';
import { InMemoryTokenStore } from './storage/InMemoryTokenStore.js';
import { AbstractTrustStore } from '../trust/storage/AbstractTrustStore.js';
import { computeAgentTrustId } from '../trust/trustUtils.js';
import type { BTPTrustRecord } from '../trust/types.js';
import { getBTPKeyPair } from '../crypto/keygen.js';

class MemoryTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  private records = new Map<string, BTPTrustRecord>();
  constructor() {
    super({ connection: 'memory' });
  }
  async getById(id: string) {
    return this.records.get(id);
  }
  async create(record: Omit<BTPTrustRecord, 'id'>, id = 'trust') {
    const full = { ...record, id };
    this.records.set(id, full);
    return full;
  }
  async update(id: string, patch: Partial<BTPTrustRecord>) {
    const updated = { ...this.records.get(id), ...patch } as BTPTrustRecord;
    this.records.set(id, updated);
    return updated;
  }
  async delete(id: string) {
    this.records.delete(id);
  }
  async getAll() {
    return [...this.records.values()];
  }
  async isKnownArtifact() {
    return false;
  }
}

const identity = 'alice$saas.example';
// Inside a refresh token's life, so each refresh is taken.
const registeredAt = '2026-01-01T00:00:00.000Z';
const refreshedAt = '2026-01-02T00:00:00.000Z';
const rotatedAt = '2026-01-03T00:00:00.000Z';
// Past the default 30 s grace window from registration, so a second use is theft, not a retry.
const afterGrace = '2026-01-01T00:00:31.000Z';

describe("a device key's history", () => {
  let trustStore: MemoryTrustStore;
  let auth: BtpsAuthentication;

  beforeEach(() => {
    vi.useFakeTimers();
    trustStore = new MemoryTrustStore();
    auth = new BtpsAuthentication({ trustStore, tokenStore: new InMemoryTokenStore() });
  });

  afterEach(() => vi.useRealTimers());

  /** Registers a device, refreshes it once with the same key, then moves it to a new key. */
  const registerRefreshAndRotate = async () => {
    vi.setSystemTime(new Date(registeredAt));
    const first = getBTPKeyPair();
    const { agentId, refreshToken } = await auth.createAgent(
      { userIdentity: identity, publicKey: first.publicKey, decidedBy: identity },
      identity,
    );
    vi.setSystemTime(new Date(refreshedAt));
    const refreshed = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
      decidedBy: identity,
      decryptBy: identity,
    });
    vi.setSystemTime(new Date(rotatedAt));
    await auth.validateAndReissueRefreshToken(agentId, refreshed.data?.refreshToken ?? '', {
      decidedBy: identity,
      decryptBy: identity,
      publicKey: getBTPKeyPair().publicKey,
    });
    return { agentId, firstFingerprint: first.fingerprint, refreshToken };
  };

  it('keeps the retired key, retired when the device moved to the new one', async () => {
    const { agentId, firstFingerprint } = await registerRefreshAndRotate();
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(record?.keyHistory).toEqual([
      expect.objectContaining({ fingerprint: firstFingerprint, lastSeen: rotatedAt }),
    ]);
  });

  it('says the retired key came into use when the device registered, not when it last refreshed', async () => {
    const { agentId } = await registerRefreshAndRotate();
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(record?.keyHistory[0]?.firstSeen).toBe(registeredAt);
  });

  it('says a later key came into use when the key before it was retired', async () => {
    const { agentId } = await registerRefreshAndRotate();
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));
    const tokens = new InMemoryTokenStore();
    const later = new BtpsAuthentication({ trustStore, tokenStore: tokens });
    const rotatedAgainAt = '2026-01-04T00:00:00.000Z';
    vi.setSystemTime(new Date(rotatedAgainAt));
    await tokens.store('next', agentId, identity, 60_000, identity);

    await later.validateAndReissueRefreshToken(agentId, 'next', {
      decidedBy: identity,
      decryptBy: identity,
      publicKey: getBTPKeyPair().publicKey,
    });
    const after = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(after?.keyHistory[1]).toEqual({
      fingerprint: record?.publicKeyFingerprint,
      firstSeen: rotatedAt,
      lastSeen: rotatedAgainAt,
    });
  });

  it('tells its listeners when a device moves to a new key', async () => {
    const rotated = vi.fn();
    auth.on('keyRotated', rotated);

    const { agentId, firstFingerprint } = await registerRefreshAndRotate();
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(rotated).toHaveBeenCalledOnce();
    expect(rotated).toHaveBeenCalledWith({
      agentId,
      identity,
      previousFingerprint: firstFingerprint,
      fingerprint: record?.publicKeyFingerprint,
      at: rotatedAt,
    });
  });

  it('treats a refresh token used a second time as theft: the device is revoked', async () => {
    const { agentId, refreshToken } = await registerRefreshAndRotate();
    const reused = vi.fn();
    auth.on('refreshTokenReused', reused);

    const { error } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
      decidedBy: identity,
      decryptBy: identity,
    });
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(error).toBeDefined();
    expect(record?.status).toBe('revoked');
    expect(reused).toHaveBeenCalledWith({
      agentId,
      identity,
      fingerprint: record?.publicKeyFingerprint,
      at: rotatedAt,
    });
  });

  it('refuses the newer token too once the device is revoked, whoever holds it', async () => {
    vi.setSystemTime(new Date(registeredAt));
    const { agentId, refreshToken } = await auth.createAgent(
      { userIdentity: identity, publicKey: getBTPKeyPair().publicKey, decidedBy: identity },
      identity,
    );
    const options = { decidedBy: identity, decryptBy: identity };
    const newer = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
    vi.setSystemTime(new Date(afterGrace));
    await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    const { data, error } = await auth.validateAndReissueRefreshToken(
      agentId,
      newer.data?.refreshToken ?? '',
      options,
    );

    expect(data).toBeUndefined();
    expect(error?.cause).toMatch(/revoked/);
  });

  it('refuses a made-up token without revoking anything', async () => {
    const { agentId } = await registerRefreshAndRotate();
    const reused = vi.fn();
    auth.on('refreshTokenReused', reused);

    const { error } = await auth.validateAndReissueRefreshToken(agentId, 'made-up', {
      decidedBy: identity,
      decryptBy: identity,
    });
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(error?.cause).toBe('Invalid or expired refresh token');
    expect(record?.status).toBe('accepted');
    expect(reused).not.toHaveBeenCalled();
  });

  it('never lets a listener that throws break a refresh or stop the other listeners', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rotated = vi.fn();
    const reused = vi.fn();
    auth.on('keyRotated', () => {
      throw new Error('listener broke');
    });
    auth.on('keyRotated', rotated);
    auth.on('refreshTokenReused', () => {
      throw new Error('listener broke');
    });
    auth.on('refreshTokenReused', reused);

    vi.setSystemTime(new Date(registeredAt));
    const { agentId, refreshToken } = await auth.createAgent(
      { userIdentity: identity, publicKey: getBTPKeyPair().publicKey, decidedBy: identity },
      identity,
    );
    const options = { decidedBy: identity, decryptBy: identity };
    const moved = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
      ...options,
      publicKey: getBTPKeyPair().publicKey,
    });
    vi.setSystemTime(new Date(afterGrace));
    const again = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    expect(moved.data?.refreshToken).toBeDefined();
    expect(rotated).toHaveBeenCalledOnce();
    expect(again.error?.cause).toMatch(/revoked/);
    expect(reused).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('a refresh retried inside the grace window', () => {
  let trustStore: MemoryTrustStore;
  let tokenStore: InMemoryTokenStore;
  const options = { decidedBy: identity, decryptBy: identity };

  beforeEach(() => {
    vi.useFakeTimers();
    trustStore = new MemoryTrustStore();
    tokenStore = new InMemoryTokenStore();
  });

  afterEach(() => vi.useRealTimers());

  /** Registers a device and refreshes it once, as a device whose answer is then lost. */
  const registerAndRefresh = async (auth: BtpsAuthentication) => {
    vi.setSystemTime(new Date(registeredAt));
    const { agentId, refreshToken } = await auth.createAgent(
      { userIdentity: identity, publicKey: getBTPKeyPair().publicKey, decidedBy: identity },
      identity,
    );
    const first = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
    return { agentId, refreshToken, first: first.data };
  };
  const after = (ms: number) => vi.setSystemTime(new Date(Date.parse(registeredAt) + ms));

  it('gives a retry at 29 s the same answer, the same new token included, and revokes nothing', async () => {
    const auth = new BtpsAuthentication({ trustStore, tokenStore });
    const reused = vi.fn();
    auth.on('refreshTokenReused', reused);
    const { agentId, refreshToken, first } = await registerAndRefresh(auth);

    after(29_000);
    const retried = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(retried.error).toBeUndefined();
    expect(retried.data).toEqual(first);
    expect(record?.status).toBe('accepted');
    expect(reused).not.toHaveBeenCalled();
  });

  it('treats a reuse at 31 s as theft: the device is revoked', async () => {
    const auth = new BtpsAuthentication({ trustStore, tokenStore });
    const reused = vi.fn();
    auth.on('refreshTokenReused', reused);
    const { agentId, refreshToken } = await registerAndRefresh(auth);

    after(31_000);
    const { data, error } = await auth.validateAndReissueRefreshToken(
      agentId,
      refreshToken,
      options,
    );
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(data).toBeUndefined();
    expect(error?.cause).toMatch(/revoked/);
    expect(record?.status).toBe('revoked');
    expect(reused).toHaveBeenCalledOnce();
  });

  it('is off at 0: a reuse straight after is theft, as before', async () => {
    const auth = new BtpsAuthentication({ trustStore, tokenStore, refreshGraceMs: 0 });
    const { agentId, refreshToken } = await registerAndRefresh(auth);

    const { error } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(error?.cause).toMatch(/revoked/);
    expect(record?.status).toBe('revoked');
  });

  it('treats a reuse as theft once the new token has been used', async () => {
    const auth = new BtpsAuthentication({ trustStore, tokenStore });
    const { agentId, refreshToken, first } = await registerAndRefresh(auth);
    await auth.validateAndReissueRefreshToken(agentId, first?.refreshToken ?? '', options);

    after(1_000);
    const { error } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    expect(error?.cause).toMatch(/revoked/);
  });

  it("keeps the answer sealed: the new token is nowhere on the old token's mark in plain text", async () => {
    const auth = new BtpsAuthentication({ trustStore, tokenStore });
    const { agentId, refreshToken, first } = await registerAndRefresh(auth);

    const mark = await tokenStore.isConsumed(agentId, refreshToken);

    expect(mark?.successor).toBeDefined();
    expect(JSON.stringify(mark)).not.toContain(first?.refreshToken);
  });

  it('is off, with one warning, for a store that cannot keep the answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = {
      store: tokenStore.store.bind(tokenStore),
      get: tokenStore.get.bind(tokenStore),
      remove: tokenStore.remove.bind(tokenStore),
      consume: tokenStore.consume.bind(tokenStore),
      isConsumed: tokenStore.isConsumed.bind(tokenStore),
      cleanup: tokenStore.cleanup.bind(tokenStore),
    };
    const auth = new BtpsAuthentication({ trustStore, tokenStore: store });
    const { agentId, refreshToken } = await registerAndRefresh(auth);

    const { error } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/markSuccessor/);
    expect(error?.cause).toMatch(/revoked/);
    warn.mockRestore();
  });
});

describe('a token store without isConsumed', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is warned about once, and a second use is refused as in 1.1, revoking nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tokens = new InMemoryTokenStore();
    const tokenStore = {
      store: tokens.store.bind(tokens),
      get: tokens.get.bind(tokens),
      remove: tokens.remove.bind(tokens),
      consume: tokens.consume.bind(tokens),
      cleanup: tokens.cleanup.bind(tokens),
    };
    const trustStore = new MemoryTrustStore();
    const auth = new BtpsAuthentication({ trustStore, tokenStore });
    const { agentId, refreshToken } = await auth.createAgent(
      { userIdentity: identity, publicKey: getBTPKeyPair().publicKey, decidedBy: identity },
      identity,
    );
    const options = { decidedBy: identity, decryptBy: identity };
    await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    const { error } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
    const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/isConsumed/);
    expect(error?.cause).toBe('Invalid or expired refresh token');
    expect(record?.status).toBe('accepted');
  });
});

describe('a maximum key age', () => {
  const day = 24 * 60 * 60 * 1000;
  let trustStore: MemoryTrustStore;
  let auth: BtpsAuthentication;
  const options = { decidedBy: identity, decryptBy: identity };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(registeredAt));
    trustStore = new MemoryTrustStore();
    auth = new BtpsAuthentication({
      trustStore,
      tokenStore: new InMemoryTokenStore(),
      tokenConfig: { refreshTokenExpiryMs: 30 * day },
      maxKeyAgeMs: 3 * day,
    });
  });

  afterEach(() => vi.useRealTimers());

  const register = () =>
    auth.createAgent(
      { userIdentity: identity, publicKey: getBTPKeyPair().publicKey, decidedBy: identity },
      identity,
    );

  it('lets a key younger than it refresh', async () => {
    const { agentId, refreshToken } = await register();
    vi.setSystemTime(new Date(Date.parse(registeredAt) + 2 * day));

    const { data } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    expect(data?.refreshToken).toBeDefined();
  });

  it('refuses a refresh with an older key, counted from registration however often it refreshed', async () => {
    const { agentId, refreshToken } = await register();
    vi.setSystemTime(new Date(Date.parse(registeredAt) + 2 * day));
    const refreshed = await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);
    vi.setSystemTime(new Date(Date.parse(registeredAt) + 4 * day));

    const { data, error } = await auth.validateAndReissueRefreshToken(
      agentId,
      refreshed.data?.refreshToken ?? '',
      options,
    );

    expect(data).toBeUndefined();
    expect(error?.code).toBe('BTP_ERROR_KEY_TOO_OLD');
  });

  it('keeps the token, so the device moves to a new key with it, and counts again from then', async () => {
    const { agentId, refreshToken } = await register();
    vi.setSystemTime(new Date(Date.parse(registeredAt) + 4 * day));
    await auth.validateAndReissueRefreshToken(agentId, refreshToken, options);

    const rotated = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
      ...options,
      publicKey: getBTPKeyPair().publicKey,
    });
    vi.setSystemTime(new Date(Date.parse(registeredAt) + 6 * day));
    const later = await auth.validateAndReissueRefreshToken(
      agentId,
      rotated.data?.refreshToken ?? '',
      options,
    );

    expect(rotated.error).toBeUndefined();
    expect(later.error).toBeUndefined();
  });

  it('is off unless set', async () => {
    const tokens = new InMemoryTokenStore();
    const unlimited = new BtpsAuthentication({
      trustStore,
      tokenStore: tokens,
      tokenConfig: { refreshTokenExpiryMs: 400 * day },
    });
    const { agentId, refreshToken } = await unlimited.createAgent(
      { userIdentity: identity, publicKey: getBTPKeyPair().publicKey, decidedBy: identity },
      identity,
    );
    vi.setSystemTime(new Date(Date.parse(registeredAt) + 365 * day));

    const { error } = await unlimited.validateAndReissueRefreshToken(
      agentId,
      refreshToken,
      options,
    );

    expect(error).toBeUndefined();
  });
});
