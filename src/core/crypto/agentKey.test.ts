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
 * (a KMS) unwraps through an optional `unwrapKey`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveTxt } from 'dns/promises';
import { PemDecrypter } from './pem-decrypter.js';
import { encryptBtpPayload, getFingerprintFromPem, signBtpPayload } from './index.js';
import { getBTPKeyPair } from './keygen.js';
import { BtpQueryResultEntrySchema } from '@core/server/schemas/responseSchema.js';
import { pemToBase64 } from '@core/utils/index.js';
import { wrapForAgent } from '../../server/libs/wrapForAgent.js';
import { BtpsAgent } from '../../client/btpsAgent.js';
import type { BTPTransporterArtifact } from '@core/server/types.js';
import type { Decrypter } from './decrypter-interface.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const dns = vi.mocked(resolveTxt);

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
  it("a PEM Decrypter unwraps a document's content key", async () => {
    const decrypter = new PemDecrypter({ privateKey: wrap.privateKeyPem });

    const key = await decrypter.unwrapKey(Buffer.from(wrap.wrappedKeyBase64, 'base64'));

    expect(Buffer.from(key).toString('base64')).toBe(wrap.plaintextKeyBase64);
  });

  it('travels as agentKey beside the result, which keeps it', () => {
    const parsed = BtpQueryResultEntrySchema.safeParse({ artifact, agentKey });

    expect(parsed.success && parsed.data.agentKey).toEqual(agentKey);
  });

  it('is refused without the fingerprint of the key it is wrapped to', () => {
    const { fingerprint: _fingerprint, ...withoutFingerprint } = agentKey;

    expect(
      BtpQueryResultEntrySchema.safeParse({ artifact, agentKey: withoutFingerprint }).success,
    ).toBe(false);
  });

  it('is refused with anything more than its key, fingerprint and when', () => {
    expect(
      BtpQueryResultEntrySchema.safeParse({ artifact, agentKey: { ...agentKey, identityKey: 'x' } })
        .success,
    ).toBe(false);
  });

  it('leaves a result without agentKey as 1.1 has it', () => {
    expect(BtpQueryResultEntrySchema.safeParse({ artifact, meta: { seen: true } }).success).toBe(
      true,
    );
  });
});

describe('a provider wrapping a result for a device, and the device opening it', () => {
  const sender = getBTPKeyPair();
  const identity = getBTPKeyPair();
  const device = getBTPKeyPair();
  const deviceRecord = {
    publicKeyBase64: pemToBase64(device.publicKey),
    publicKeyFingerprint: getFingerprintFromPem(device.publicKey),
  };
  const invoice = {
    type: 'invoice',
    title: 'October',
    id: 'INV-1',
    issuedAt: new Date().toISOString(),
    totalAmount: { amount: 150000, currency: 'AUD' },
    lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Build', Amount: 150000 }] },
  };
  const { data, encryption } = encryptBtpPayload(invoice, identity.publicKey, {
    algorithm: 'aes-256-gcm',
    mode: 'standardEncrypt',
  });
  const { signature: _signature, ...envelope } = artifact;
  const unsigned = {
    ...envelope,
    issuedAt: new Date().toISOString(),
    document: data,
    encryption,
  };
  const sent = {
    ...unsigned,
    signature: signBtpPayload(unsigned, sender),
  } as BTPTransporterArtifact;
  const agent = (keys = device) =>
    new BtpsAgent({
      agent: { id: 'btps_ag_1', identityKey: keys.privateKey, identityCert: keys.publicKey },
      btpIdentity: 'alice$saas.example',
      host: 'btps.saas.example',
    });

  beforeEach(() => {
    dns.mockReset();
    dns.mockResolvedValue([[`k=rsa; v=1.1.0; p=${pemToBase64(sender.publicKey)}`]]);
  });

  it('opens with the PEM identity key: the device reads the document, the artifact untouched', async () => {
    const before = JSON.stringify(sent);
    const wrapped = await wrapForAgent(sent, identity.privateKey, deviceRecord);

    const { payload, error } = await agent().openResult({ artifact: sent, agentKey: wrapped });

    expect(error).toBeUndefined();
    expect(payload?.document).toEqual(invoice);
    expect(wrapped.fingerprint).toBe(deviceRecord.publicKeyFingerprint);
    expect(JSON.stringify(sent)).toBe(before);
  });

  it('opens with a Decrypter that unwraps, as a KMS would', async () => {
    const wrapped = await wrapForAgent(
      sent,
      new PemDecrypter({ privateKey: identity.privateKey }),
      deviceRecord,
    );

    const { payload } = await agent().openResult({ artifact: sent, agentKey: wrapped });

    expect(payload?.document).toEqual(invoice);
  });

  it('is refused by a Decrypter that cannot unwrap, and for an unencrypted artifact', async () => {
    const decryptOnly: Decrypter = {
      algorithm: 'aes-256-gcm',
      decrypt: async () => new Uint8Array(),
    };

    await expect(wrapForAgent(sent, decryptOnly, deviceRecord)).rejects.toHaveProperty(
      'cause',
      expect.stringMatching(/unwrapKey/),
    );
    await expect(
      wrapForAgent({ ...sent, encryption: null }, identity.privateKey, deviceRecord),
    ).rejects.toHaveProperty('cause', expect.stringMatching(/encrypted/));
  });

  it('is refused by a device holding another key, before anything is looked up', async () => {
    const wrapped = await wrapForAgent(sent, identity.privateKey, deviceRecord);

    const { error } = await agent(getBTPKeyPair()).openResult({
      artifact: sent,
      agentKey: wrapped,
    });

    expect(error?.cause).toMatch(/finish moving to the new key/);
    expect(dns).not.toHaveBeenCalled();
  });

  it('is refused when the artifact was changed after it was signed', async () => {
    const wrapped = await wrapForAgent(sent, identity.privateKey, deviceRecord);

    const { payload, error } = await agent().openResult({
      artifact: { ...sent, to: 'mallory$saas.example' },
      agentKey: wrapped,
    });

    expect(payload).toBeUndefined();
    expect(error).toBeDefined();
  });

  it('is refused without an agentKey', async () => {
    const { error } = await agent().openResult({ artifact: sent });

    expect(error?.cause).toMatch(/no agentKey/);
  });
});
