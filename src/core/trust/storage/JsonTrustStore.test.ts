/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { BTPTrustRecord } from '../types.js';
import JsonTrustStore from './JsonTrustStore.js';
import { computeTrustId } from '../index.js';

const TEST_FILE = path.join(__dirname, 'test-trust-store.json');

const receiverId = 'from$vendor.com';
const senderId = 'to$host.com';
const computedId = computeTrustId(senderId, receiverId);

const sampleRecord: BTPTrustRecord = {
  id: computedId,
  receiverId,
  senderId,
  status: 'accepted',
  createdAt: new Date().toISOString(),
  expiresAt: undefined,
  publicKeyBase64: 'test-key',
  publicKeyFingerprint: 'test-fingerprint',
  keyHistory: [],
  privacyType: 'unencrypted',
  decidedBy: 'admin@domain.com',
  decidedAt: new Date().toISOString(),
};

describe('JsonTrustStore (composite key)', () => {
  let store: JsonTrustStore;

  beforeEach(async () => {
    if (existsSync(TEST_FILE)) await fs.unlink(TEST_FILE);
    store = new JsonTrustStore({
      connection: TEST_FILE,
      entityName: 'trusted_sender',
    });
  });

  afterEach(async () => {
    await store.flushNow();
    if (existsSync(TEST_FILE)) await fs.unlink(TEST_FILE);
  });

  it('should create a new trust record', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    const record = await store.getById(computedId);
    expect(record?.senderId).toBe(senderId);
    expect(record?.receiverId).toBe(receiverId);
  });

  it('should retrieve all records', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    const records = await store.getAll();
    expect(records.length).toBe(1);
  });

  it('should filter records by receiverId', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    await store.create({
      ...recordWithoutId,
      senderId: 'another$from.com',
      receiverId: 'to2$host.com',
    });

    const filtered = await store.getAll(receiverId);
    expect(filtered.length).toBe(1);
    expect(filtered[0].receiverId).toBe(receiverId);
  });

  it('should update an existing record', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    await store.update(computedId, { status: 'revoked' });
    const updated = await store.getById(computedId);
    expect(updated?.status).toBe('revoked');
  });

  it('should delete a trust record', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    await store.delete(computedId);
    const deleted = await store.getById(computedId);
    expect(deleted).toBeUndefined();
  });

  it('should flush and reload the trust store', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    await store.flushAndReload();
    const reloaded = await store.getById(computedId);
    expect(reloaded?.senderId).toBe(senderId);
  });

  it('should handle locking and release file with flushed contents', async () => {
    const { id, ...recordWithoutId } = sampleRecord;
    await store.create(recordWithoutId);
    await store.flushNow();
    const content = await fs.readFile(TEST_FILE, 'utf8');
    expect(content).toContain(senderId);
    expect(content).toContain(receiverId);
    expect(content).toContain('test-key');
  });
});
