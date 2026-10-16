/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Separate selectors: the sender's key is found at signatureSelector,
 * the receiver's at encryptionSelector. Real keys; only DNS lookup is faked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { resolveSignatureKey, selectDecryptionKey } from './keySelection.js';
import { decryptBtpPayload, decryptVerify, signEncrypt } from './index.js';
import type { PemKeys } from './types.js';
import { BTP_ERROR_DECRYPTION_UNINTENDED, BTP_ERROR_VALIDATION } from '../error/constant.js';
import * as utils from '../utils/index.js';

vi.mock('../utils/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/index.js')>();
  return { ...actual, resolvePublicKey: vi.fn() };
});

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

// Published keys, by identity and selector.
const published: Record<string, Record<string, PemKeys>> = {
  'alice$saas.example': { btps1: genKeys(), btps2: genKeys() },
  'bob$receiver.example': { btps1: genKeys(), btps2: genKeys() },
};
const alice = published['alice$saas.example']!;
const bob = published['bob$receiver.example']!;
const document = { invoiceId: 'INV-116', amountCents: 9900, currency: 'AUD' };
const encrypt = {
  signature: { algorithmHash: 'sha256' as const },
  encryption: { algorithm: 'aes-256-gcm' as const, mode: 'standardEncrypt' as const },
};

/** alice signs with the key at `signWith` and encrypts to bob's key at `encryptTo`. */
const send = async (signWith: 'btps1' | 'btps2', encryptTo: 'btps1' | 'btps2') => {
  const { payload, error } = await signEncrypt(
    'bob$receiver.example',
    {
      accountName: 'alice',
      domainName: 'saas.example',
      selector: signWith,
      pemFiles: alice[signWith]!,
    },
    {
      type: 'BTPS_DOC',
      from: 'alice$saas.example',
      to: 'bob$receiver.example',
      document,
      encryptionSelector: encryptTo,
    },
    encrypt,
  );
  expect(error).toBeUndefined();
  return payload as unknown as {
    from: string;
    signatureSelector: string;
    encryptionSelector: string;
    document: string;
    encryption: NonNullable<Parameters<typeof decryptBtpPayload>[1]>;
    signature: Parameters<typeof decryptVerify>[1]['signature'];
    [key: string]: unknown;
  };
};

describe('key selection', () => {
  beforeEach(() => {
    vi.mocked(utils.resolvePublicKey).mockImplementation(
      async (identity: string, selector: string) => published[identity]?.[selector]?.publicKey,
    );
  });

  it('resolveSignatureKey resolves the sender key at signatureSelector', async () => {
    const artifact = await send('btps2', 'btps1');
    expect(await resolveSignatureKey(artifact)).toBe(alice.btps2!.publicKey);
    expect(utils.resolvePublicKey).toHaveBeenLastCalledWith('alice$saas.example', 'btps2');
  });

  it('resolveSignatureKey resolves nothing for an artifact that names no signing key', async () => {
    expect(await resolveSignatureKey({ from: 'alice$saas.example' })).toBeUndefined();
  });

  it('selectDecryptionKey hands back a PEM the caller already chose', async () => {
    expect(await selectDecryptionKey(undefined, 'pem')).toEqual({ privateKeyPem: 'pem' });
  });

  it('selectDecryptionKey asks the lookup for the key at encryptionSelector', async () => {
    const lookup = vi.fn((selector: string) => bob[selector]?.privateKey);
    expect(await selectDecryptionKey('btps1', lookup)).toEqual({
      privateKeyPem: bob.btps1!.privateKey,
    });
    expect(lookup).toHaveBeenCalledWith('btps1');
  });

  it('selectDecryptionKey refuses an encrypted artifact that names no encryptionSelector', async () => {
    const { error } = await selectDecryptionKey(undefined, () => bob.btps1!.privateKey);
    expect(error?.code).toBe(BTP_ERROR_VALIDATION.code);
  });

  it('selectDecryptionKey says when no key is held at encryptionSelector', async () => {
    const { error } = await selectDecryptionKey('btps9', () => undefined);
    expect(error?.code).toBe(BTP_ERROR_DECRYPTION_UNINTENDED.code);
  });

  describe('each selector changes on its own', () => {
    const cases = [
      { signWith: 'btps1', encryptTo: 'btps1' },
      { signWith: 'btps2', encryptTo: 'btps1' }, // the sender rotated
      { signWith: 'btps1', encryptTo: 'btps2' }, // the receiver rotated
      { signWith: 'btps2', encryptTo: 'btps2' },
    ] as const;

    for (const { signWith, encryptTo } of cases) {
      it(`signed at ${signWith}, encrypted to ${encryptTo}: verifies at signatureSelector and decrypts at encryptionSelector`, async () => {
        const artifact = await send(signWith, encryptTo);
        expect(artifact).toMatchObject({
          signatureSelector: signWith,
          encryptionSelector: encryptTo,
        });

        const senderKey = await resolveSignatureKey(artifact);
        const { payload, error } = await decryptVerify(
          senderKey!,
          artifact,
          (selector) => bob[selector]?.privateKey,
        );
        expect(error).toBeUndefined();
        expect(payload?.document).toEqual(document);
      });
    }
  });

  it('a receiver that rotated keeps decrypting with its old key, chosen by encryptionSelector', async () => {
    // Encrypted to bob at btps1; bob has since moved to btps2 and keeps btps1.
    const artifact = await send('btps1', 'btps1');
    const current = bob.btps2!.privateKey;

    expect(decryptBtpPayload(artifact.document, artifact.encryption, current).error).toBeDefined();

    const kept: Record<string, string> = { btps1: bob.btps1!.privateKey, btps2: current };
    const { payload, error } = await decryptVerify(
      alice.btps1!.publicKey,
      artifact,
      (selector) => kept[selector],
    );
    expect(error).toBeUndefined();
    expect(payload?.document).toEqual(document);
  });

  it('a receiver that dropped the key at encryptionSelector is told so, not handed garbage', async () => {
    const artifact = await send('btps1', 'btps1');
    const { payload, error } = await decryptVerify(alice.btps1!.publicKey, artifact, (selector) =>
      selector === 'btps2' ? bob.btps2!.privateKey : undefined,
    );
    expect(payload).toBeUndefined();
    expect(error?.code).toBe(BTP_ERROR_DECRYPTION_UNINTENDED.code);
  });

  it('the signature does not verify with the sender key at the encryption selector', async () => {
    const artifact = await send('btps2', 'btps1');
    const wrongKey = alice[artifact.encryptionSelector]!.publicKey;
    const { error } = await decryptVerify(wrongKey, artifact, bob.btps1!.privateKey);
    expect(error).toBeDefined();
  });
});
