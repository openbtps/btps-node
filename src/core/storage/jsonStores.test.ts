/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { JsonStorageStore } from './JsonStorageStore.js';
import { JsonIdentityStore } from './JsonIdentityStore.js';
import JsonTrustStore from '../trust/storage/JsonTrustStore.js';
import type { BTPIdentityRecord, BTPStorageRecord } from './types.js';
import type { BTPTrustRecord } from '../trust/types.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'btps-json-'));
let count = 0;
const file = () => path.join(dir, `store-${count++}.json`);
// Each store writes a second after a change; flushed here so none writes after the folder is gone.
const stores: Array<{ flushNow(): Promise<void> }> = [];
const kept = <S extends { flushNow(): Promise<void> }>(store: S) => (stores.push(store), store);

afterAll(async () => {
  for (const store of stores) await store.flushNow();
  rmSync(dir, { recursive: true, force: true });
});

describe('the JSON stores', () => {
  it.each([
    ['JsonStorageStore', () => new JsonStorageStore({ connection: {} as never })],
    ['JsonIdentityStore', () => new JsonIdentityStore({ connection: 42 as never })],
  ])('%s needs a file path', (_name, create) => {
    expect(create).toThrow(/file path/);
  });

  it('JsonStorageStore creates once per identity, and updates only what exists', async () => {
    const store = kept(new JsonStorageStore<BTPStorageRecord>({ connection: file() }));
    const record = { name: 'alice' } as unknown as Omit<BTPStorageRecord, 'id'>;

    const created = await store.create(record, 'alice$example.com');

    expect(created.id).toBeDefined();
    await expect(store.create(record, 'alice$example.com')).rejects.toThrow(/already exists/);
    await expect(store.create(created as never, 'bob$example.com')).rejects.toThrow(/id/);
    await expect(store.update('no-such-id', {})).rejects.toThrow(/No record found/);
  });

  it('JsonIdentityStore creates once per identity, and refuses a record with an id', async () => {
    const store = kept(new JsonIdentityStore({ connection: file() }));
    const record = {
      identity: 'alice$example.com',
      currentSelector: 'btps1',
      publicKey: 'key',
    } as unknown as Omit<BTPIdentityRecord, 'id'>;

    await store.create(record);

    await expect(store.create(record)).rejects.toThrow(/already exists/);
    await expect(store.create({ ...record, id: 'x' } as never)).rejects.toThrow(/id/);
  });

  it('JsonTrustStore creates once per pair, refuses a record with an id, and knows no artifacts', async () => {
    const store = kept(new JsonTrustStore({ connection: file(), entityName: 'trusted_sender' }));
    const record = {
      senderId: 'alice$a.test',
      receiverId: 'bob$b.test',
      status: 'accepted',
    } as unknown as Omit<BTPTrustRecord, 'id'>;

    await store.create(record);

    await expect(store.create(record)).rejects.toThrow(/already exists/);
    await expect(store.create({ ...record, id: 'x' } as never)).rejects.toThrow(/id/);
    expect(await store.isKnownArtifact()).toBe(false);
  });
});
