import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { BTPTrustRecord } from '../../types';
import JsonTrustStore from './JsonTrustStore';

const TEST_FILE = path.join(__dirname, 'test-trust-store.json');

const from = 'from$vendor.com';
const to = 'to$host.com';

const sampleRecord: BTPTrustRecord = {
  from,
  to,
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
    await store.create(to, from, sampleRecord);
    const record = await store.getBySender(to, from);
    expect(record?.from).toBe(from);
    expect(record?.to).toBe(to);
  });

  it('should retrieve all records', async () => {
    await store.create(to, from, sampleRecord);
    const records = await store.getAll();
    expect(records.length).toBe(1);
  });

  it('should filter records by to', async () => {
    await store.create(to, from, sampleRecord);
    await store.create('to2$host.com', 'another$from.com', {
      ...sampleRecord,
      from: 'another$from.com',
      to: 'to2$host.com',
    });

    const filtered = await store.getAll(to);
    expect(filtered.length).toBe(1);
    expect(filtered[0].to).toBe(to);
  });

  it('should update an existing record', async () => {
    await store.create(to, from, sampleRecord);
    await store.update(to, from, { status: 'revoked' });
    const updated = await store.getBySender(to, from);
    expect(updated?.status).toBe('revoked');
  });

  it('should delete a trust record', async () => {
    await store.create(to, from, sampleRecord);
    await store.delete(to, from);
    const deleted = await store.getBySender(to, from);
    expect(deleted).toBeUndefined();
  });

  it('should flush and reload the trust store', async () => {
    await store.create(to, from, sampleRecord);
    await store.flushAndReload();
    const reloaded = await store.getBySender(to, from);
    expect(reloaded?.from).toBe(from);
  });

  it('should handle locking and release file with flushed contents', async () => {
    await store.create(to, from, sampleRecord);
    await store.flushNow();
    const content = await fs.readFile(TEST_FILE, 'utf8');
    expect(content).toContain(from);
    expect(content).toContain(to);
    expect(content).toContain('test-key');
  });
});
