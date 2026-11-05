/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a sync is an artifact.send to the user's own address, naming the
 * send it copies in `syncOf` on its envelope (readable, since the document is
 * encrypted to the user's own key), and a send's outcome is the provider's own
 * record, `meta.delivery`, on a sentbox result. The `it.fails` cases pass once
 * 1.2 lands.
 */

import { describe, expect, it } from 'vitest';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';
import { BtpQueryResultEntrySchema } from './responseSchema.js';

const issuedAt = new Date().toISOString();
const sha256 = 'a'.repeat(64);
const artifact = (from: string, to: string) => ({
  version: '1.2.0',
  issuedAt,
  id: 'sync-1',
  type: 'BTPS_DOC',
  from,
  to,
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: {
    algorithm: 'aes-256-gcm',
    encryptedKey: 'AA==',
    iv: 'AA==',
    authTag: 'AA==',
    type: 'standardEncrypt',
  },
  document: 'ciphertext',
  syncOf: { id: 'artifact-1', sha256 },
});

describe('a sync', () => {
  it.fails("names the send it copies on its envelope, to the user's own address", () => {
    const parsed = BtpTransporterArtifactSchema.safeParse(
      artifact('alice$saas.example', 'alice$saas.example'),
    );

    expect(parsed.success && Reflect.get(parsed.data, 'syncOf')).toEqual({
      id: 'artifact-1',
      sha256,
    });
  });

  it.fails('is refused to any address but the sender its own', () => {
    expect(
      BtpTransporterArtifactSchema.safeParse(artifact('alice$saas.example', 'pay$client.example'))
        .success,
    ).toBe(false);
  });

  it.fails('names the copied send by a SHA-256 in lowercase hex', () => {
    const sync = artifact('alice$saas.example', 'alice$saas.example');

    expect(
      BtpTransporterArtifactSchema.safeParse({
        ...sync,
        syncOf: { id: 'artifact-1', sha256: 'ABC' },
      }).success,
    ).toBe(false);
  });
});

describe("a send's outcome on a sentbox result", () => {
  const sent = artifact('alice$saas.example', 'pay$client.example');
  const { syncOf: _syncOf, ...send } = { ...sent, version: '1.1.0' };

  it('is taken as delivered, with when', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: { delivery: { status: 'delivered', at: issuedAt } },
      }).success,
    ).toBe(true);
  });

  it.fails('is refused with a status that is not pending, delivered or failed', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: { delivery: { status: 'lost', at: issuedAt } },
      }).success,
    ).toBe(false);
  });

  it.fails('is refused failed without being able to say when', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({
        artifact: send,
        meta: { delivery: { status: 'failed', code: 'BTP_ERROR_TRUST_NOT_ALLOWED' } },
      }).success,
    ).toBe(false);
  });
});
