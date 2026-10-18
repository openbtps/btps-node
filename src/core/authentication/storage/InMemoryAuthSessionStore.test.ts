/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuthSessionStore } from './InMemoryAuthSessionStore.js';
import type { AuthSession } from '../types.js';

const session = (agentId: string, userIdentity: string, expiresInMs: number) =>
  ({
    agentId,
    userIdentity,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    refreshToken: 'refresh',
    publicKeyFingerprint: 'fingerprint',
  }) as AuthSession;

describe('InMemoryAuthSessionStore', () => {
  let store: InMemoryAuthSessionStore;

  beforeEach(() => {
    store = new InMemoryAuthSessionStore();
  });

  it('finds a session by its agent id and by its identity', async () => {
    const live = session('btps_ag_1', 'alice$saas.test', 60_000);
    await store.store(live);

    expect(await store.getByAgentId('btps_ag_1')).toBe(live);
    expect(await store.getByIdentity('alice$saas.test')).toBe(live);
    expect(store.size).toBe(1);
  });

  it('finds nothing for an unknown agent or identity', async () => {
    expect(await store.getByAgentId('btps_ag_none')).toBeUndefined();
    expect(await store.getByIdentity('nobody$saas.test')).toBeUndefined();
  });

  it('drops an expired session when it is asked for', async () => {
    await store.store(session('btps_ag_old', 'bob$saas.test', -1000));

    expect(await store.getByIdentity('bob$saas.test')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('removes a session and its identity, and ignores an unknown one', async () => {
    await store.store(session('btps_ag_1', 'alice$saas.test', 60_000));

    await store.remove('btps_ag_1');
    await store.remove('btps_ag_none');

    expect(await store.getByIdentity('alice$saas.test')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('lists only live sessions, cleaning up the expired ones', async () => {
    const live = session('btps_ag_1', 'alice$saas.test', 60_000);
    await store.store(live);
    await store.store(session('btps_ag_2', 'bob$saas.test', -1000));

    expect(await store.getAll()).toEqual([live]);
    expect(store.size).toBe(1);
  });

  it('clears everything', async () => {
    await store.store(session('btps_ag_1', 'alice$saas.test', 60_000));

    store.clear();

    expect(store.size).toBe(0);
    expect(await store.getByIdentity('alice$saas.test')).toBeUndefined();
  });
});
