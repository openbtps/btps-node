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
 * is revoked and `refreshTokenReused` fires. The `it.fails` cases pass once
 * 1.2 lands.
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

  it.fails(
    'says the retired key came into use when the device registered, not when it last refreshed',
    async () => {
      const { agentId } = await registerRefreshAndRotate();
      const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

      expect(record?.keyHistory[0]?.firstSeen).toBe(registeredAt);
    },
  );

  it.fails(
    'treats a refresh token used a second time as theft: the device is revoked',
    async () => {
      const { agentId, refreshToken } = await registerRefreshAndRotate();
      const reused = vi.fn();
      const on: unknown = Reflect.get(auth, 'on');
      expect(typeof on).toBe('function');
      (on as (event: string, listener: (info: unknown) => void) => void).call(
        auth,
        'refreshTokenReused',
        reused,
      );

      const { error } = await auth.validateAndReissueRefreshToken(agentId, refreshToken, {
        decidedBy: identity,
        decryptBy: identity,
      });
      const record = await trustStore.getById(computeAgentTrustId(agentId, identity));

      expect(error).toBeDefined();
      expect(record?.status).toBe('revoked');
      expect(reused).toHaveBeenCalledWith(expect.objectContaining({ agentId, identity }));
    },
  );
});
