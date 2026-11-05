/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: a device reads an encrypted document with its own key. The
 * provider unwraps the document's content key with the identity's key and
 * wraps it again to the device's key, as `agentKey` beside the result; the
 * artifact is untouched. A Decrypter that holds the identity's key elsewhere
 * (a KMS) unwraps through an optional `unwrapKey`. The `it.fails` cases pass
 * once 1.2 lands.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PemDecrypter } from './pem-decrypter.js';
import { BtpQueryResultEntrySchema } from '@core/server/schemas/responseSchema.js';

// The golden wrap: an AES key wrapped with RSA-OAEP-SHA256 to a test-only key.
const wrap: { privateKeyPem: string; plaintextKeyBase64: string; wrappedKeyBase64: string } =
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../test/vectors/oaep-wrap.vector.json'), 'utf8'),
  );

const artifact = {
  version: '1.1.0',
  issuedAt: new Date().toISOString(),
  id: 'artifact-1',
  type: 'BTPS_DOC',
  from: 'billing$vendor.example',
  to: 'alice$saas.example',
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
};
const agentKey = { key: 'AA==', fingerprint: 'device-fingerprint', wrappedAt: artifact.issuedAt };

describe("a device's own key to an encrypted result", () => {
  it.fails("a PEM Decrypter unwraps a document's content key", async () => {
    const decrypter = new PemDecrypter({ privateKey: wrap.privateKeyPem });
    const unwrapKey: unknown = Reflect.get(decrypter, 'unwrapKey');

    expect(typeof unwrapKey).toBe('function');
    const key = await (unwrapKey as (wrapped: Uint8Array) => Promise<Uint8Array>).call(
      decrypter,
      Buffer.from(wrap.wrappedKeyBase64, 'base64'),
    );
    expect(Buffer.from(key).toString('base64')).toBe(wrap.plaintextKeyBase64);
  });

  it.fails('travels as agentKey beside the result, which keeps it', () => {
    const parsed = BtpQueryResultEntrySchema.safeParse({ artifact, agentKey });

    expect(parsed.success && Reflect.get(parsed.data, 'agentKey')).toEqual(agentKey);
  });

  it.fails('is refused without the fingerprint of the key it is wrapped to', () => {
    const { fingerprint: _fingerprint, ...withoutFingerprint } = agentKey;

    expect(
      BtpQueryResultEntrySchema.safeParse({ artifact, agentKey: withoutFingerprint }).success,
    ).toBe(false);
  });

  it('leaves a result without agentKey as 1.1 has it', () => {
    expect(BtpQueryResultEntrySchema.safeParse({ artifact, meta: { seen: true } }).success).toBe(
      true,
    );
  });
});
