import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { BTPTrustRecord } from '../types';
import JsonTrustStore from './JsonTrustStore';

const TEST_FILE = path.join(__dirname, 'test-trust-store.json');

const receiverId = 'from$vendor.com';
const senderId = 'to$host.com';

const sampleRecord: BTPTrustRecord = {
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
    await store.create(receiverId, senderId, sampleRecord);
    const record = await store.getBySender(receiverId, senderId);
    expect(record?.senderId).toBe(senderId);
    expect(record?.receiverId).toBe(receiverId);
  });

  it('should retrieve all records', async () => {
    await store.create(receiverId, senderId, sampleRecord);
    const records = await store.getAll();
    expect(records.length).toBe(1);
  });

  it('should filter records by to', async () => {
    await store.create(receiverId, senderId, sampleRecord);
    await store.create('to2$host.com', 'another$from.com', {
      ...sampleRecord,
      senderId: 'another$from.com',
      receiverId: 'to2$host.com',
    });

    const filtered = await store.getAll(receiverId);
    expect(filtered.length).toBe(1);
    expect(filtered[0].receiverId).toBe(receiverId);
  });

  it('should update an existing record', async () => {
    await store.create(receiverId, senderId, sampleRecord);
    await store.update(receiverId, senderId, { status: 'revoked' });
    const updated = await store.getBySender(receiverId, senderId);
    expect(updated?.status).toBe('revoked');
  });

  it('should delete a trust record', async () => {
    await store.create(receiverId, senderId, sampleRecord);
    await store.delete(receiverId, senderId);
    const deleted = await store.getBySender(receiverId, senderId);
    expect(deleted).toBeUndefined();
  });

  it('should flush and reload the trust store', async () => {
    await store.create(receiverId, senderId, sampleRecord);
    await store.flushAndReload();
    const reloaded = await store.getBySender(receiverId, senderId);
    expect(reloaded?.senderId).toBe(senderId);
  });

  it('should handle locking and release file with flushed contents', async () => {
    await store.create(receiverId, senderId, sampleRecord);
    await store.flushNow();
    const content = await fs.readFile(TEST_FILE, 'utf8');
    expect(content).toContain(senderId);
    expect(content).toContain(receiverId);
    expect(content).toContain('test-key');
  });
});
