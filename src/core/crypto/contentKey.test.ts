/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: content-key side-cars. A stored artifact moves to a new key
 * without changing it: its content key, wrapped to the new key, is kept
 * beside it, and the old private key can then be deleted.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import {
  PemDecrypter,
  contentKeyOpens,
  decryptVerify,
  encryptBtpPayload,
  getFingerprintFromPem,
  signBtpPayload,
  verifySignature,
  wrapContentKeyFor,
} from './index.js';
import type { Decrypter } from './decrypter-interface.js';
import type { BTPTransporterArtifact } from '../server/types.js';

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const [sender, oldKey, newKey, otherKey] = [keyPair(), keyPair(), keyPair(), keyPair()];

const invoice = {
  type: 'invoice',
  title: 'Invoice',
  id: 'INV-1',
  issuedAt: '2026-11-01T00:00:00.000Z',
  totalAmount: { amount: 100, currency: 'AUD' },
  lineItems: { columns: ['a'], rows: [{ a: 1 }] },
};

/** An invoice encrypted to the receiver's old key, signed by its sender, as it was stored. */
const stored = () => {
  const { data, encryption } = encryptBtpPayload(invoice, oldKey.publicKey);
  const unsigned = {
    version: '1.2.0',
    id: 'a-1',
    issuedAt: '2026-11-08T00:00:00.000Z',
    type: 'BTPS_DOC',
    from: 'billing$vendor.example',
    to: 'pay$client.example',
    selector: 'btps1',
    document: data,
    encryption,
  };
  return { ...unsigned, signature: signBtpPayload(unsigned, sender) } as BTPTransporterArtifact;
};

describe('a content-key side-car', () => {
  it('opens the stored artifact with the new key, which is never changed', async () => {
    const artifact = stored();
    const before = structuredClone(artifact);

    const sidecar = await wrapContentKeyFor(artifact, oldKey.privateKey, newKey.publicKey);

    expect(sidecar.recipientFingerprint).toBe(getFingerprintFromPem(newKey.publicKey));
    expect(artifact).toEqual(before);
    const { signature, ...signed } = artifact;
    expect(verifySignature(signed, signature, sender.publicKey).isValid).toBe(true);
    expect(await contentKeyOpens(artifact, sidecar, newKey.privateKey)).toBe(true);
    const opened = await decryptVerify(
      sender.publicKey,
      artifact as never,
      newKey.privateKey,
      sidecar.encryptedKey,
    );
    expect(opened.error).toBeUndefined();
    expect(opened.payload?.document).toEqual(invoice);
  });

  it('is made and confirmed through a Decrypter, as a KMS holds a key', async () => {
    const artifact = stored();
    const sidecar = await wrapContentKeyFor(
      artifact,
      new PemDecrypter({ privateKey: oldKey.privateKey }),
      newKey.publicKey,
    );
    expect(
      await contentKeyOpens(artifact, sidecar, new PemDecrypter({ privateKey: newKey.privateKey })),
    ).toBe(true);
  });

  it('is not confirmed by another key, or for another artifact', async () => {
    const artifact = stored();
    const sidecar = await wrapContentKeyFor(artifact, oldKey.privateKey, newKey.publicKey);

    expect(await contentKeyOpens(artifact, sidecar, otherKey.privateKey)).toBe(false);
    expect(await contentKeyOpens(stored(), sidecar, newKey.privateKey)).toBe(false);
  });

  it('is refused when the old key does not open the document', async () => {
    const artifact = stored();
    // The right key for the wrap, the wrong document: its tag does not check.
    const other = stored();
    const swapped = { ...artifact, document: other.document };
    await expect(wrapContentKeyFor(swapped, oldKey.privateKey, newKey.publicKey)).rejects.toThrow(
      /DECRYPTION|intended/i,
    );
    await expect(
      wrapContentKeyFor(artifact, otherKey.privateKey, newKey.publicKey),
    ).rejects.toThrow();
  });

  it('needs an encrypted artifact, and a Decrypter that gives the content key', async () => {
    const plain = { ...stored(), encryption: null, document: { id: 'INV-1' } };
    await expect(
      wrapContentKeyFor(plain as never, oldKey.privateKey, newKey.publicKey),
    ).rejects.toMatchObject({ cause: expect.stringContaining('content key') });
    const other = stored();
    const unsupported = { ...other, encryption: { ...other.encryption!, algorithm: 'aes-128' } };
    await expect(
      wrapContentKeyFor(unsupported as never, oldKey.privateKey, newKey.publicKey),
    ).rejects.toThrow();
    const sealed: Decrypter = {
      algorithm: 'aes-256-gcm',
      decrypt: async () => new Uint8Array(),
    };
    await expect(wrapContentKeyFor(stored(), sealed, newKey.publicKey)).rejects.toMatchObject({
      cause: expect.stringContaining('unwrapKey'),
    });
  });
});
