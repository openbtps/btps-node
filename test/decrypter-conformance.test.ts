/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a) — AC2, AC4 and AC6 (decrypter half).
 *
 * src/decrypter-interface.ts, src/pem-decrypter.ts and src/kms-decrypter.ts
 * do not exist yet, so every test here fails at collection time. That is
 * the expected state of a test-writer's handover.
 *
 * Shape assumed, for the same reason given in signer-conformance.test.ts
 * (naming follows the existing BTPEncryption fields: encryptedKey, iv,
 * authTag):
 *
 *   interface DecryptRequest {
 *     encryptedKey: Uint8Array;      // RSA-OAEP wrapped AES-256 key
 *     iv: Uint8Array;
 *     ciphertext: Uint8Array;
 *     authTag: Uint8Array;           // must be exactly 16 bytes (T-26)
 *     additionalData?: Uint8Array;   // recipient-binding AAD (T-28)
 *   }
 *   interface Decrypter {
 *     readonly algorithm: 'aes-256-gcm';
 *     decrypt(request: DecryptRequest): Promise<Uint8Array>;
 *   }
 *   new PemDecrypter({ privateKey })
 *   new KmsDecrypter({ client, keyId })  // `client` is an injected, duck-typed
 *                                        // KMS facade; no network call here.
 *
 * If the implementation lands on different names, update this file in the
 * same change rather than treating the mismatch as a second ticket.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import crypto from 'crypto';

import type { Decrypter } from '../src/decrypter-interface.js';
import { PemDecrypter } from '../src/pem-decrypter.js';
import { KmsDecrypter, type KmsDecryptClient } from '../src/kms-decrypter.js';

interface EncryptionVector {
  algorithm: string;
  publicKeyPem: string;
  privateKeyPem: string;
  plaintext: string;
  additionalData: string;
}

interface Vectors {
  encryption: EncryptionVector;
}

const vectors: Vectors = JSON.parse(readFileSync(join(__dirname, 'vectors.json'), 'utf8'));

interface SdkDefectsVector {
  gcmTag: {
    receiverKeyVector: string;
    data: string;
    plaintext: string;
    cases: {
      name: string;
      encryption: { algorithm: string; encryptedKey: string; iv: string; authTag: string };
      expect: 'accept' | 'reject';
    }[];
  };
}

const oaepWrapVector: { privateKeyPem: string } = JSON.parse(
  readFileSync(join(__dirname, 'vectors/oaep-wrap.vector.json'), 'utf8'),
);
const sdkDefects: SdkDefectsVector = JSON.parse(
  readFileSync(join(__dirname, 'vectors/sdk-defects.vector.json'), 'utf8'),
);

function b64(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, 'base64'));
}

function fakeKmsDecryptClient(privateKeyPem: string): KmsDecryptClient {
  return {
    async decrypt({ encryptedKey }) {
      // Stands in for AWS KMS's RSAES_OAEP_SHA_256 Decrypt action: unwraps
      // the AES key with the key-holder's private key. The decrypter under
      // test still does the local AES-256-GCM decrypt itself.
      const plaintextKey = crypto.privateDecrypt(
        {
          key: privateKeyPem,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(encryptedKey),
      );
      return { plaintextKey: new Uint8Array(plaintextKey) };
    },
  };
}

function encryptAesGcm(plaintext: string, publicKeyPem: string, additionalData?: string) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv) as crypto.CipherGCM;
  if (additionalData) cipher.setAAD(Buffer.from(additionalData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  );
  return {
    encryptedKey: new Uint8Array(encryptedKey),
    iv: new Uint8Array(iv),
    ciphertext: new Uint8Array(ciphertext),
    authTag: new Uint8Array(authTag),
  };
}

type Implementation = {
  name: string;
  makeDecrypter: () => Decrypter;
};

const implementations: Implementation[] = [
  {
    name: 'PemDecrypter',
    makeDecrypter: () => new PemDecrypter({ privateKey: vectors.encryption.privateKeyPem }),
  },
  {
    name: 'KmsDecrypter',
    makeDecrypter: () =>
      new KmsDecrypter({
        client: fakeKmsDecryptClient(vectors.encryption.privateKeyPem),
        keyId: 'test-encryption-key',
      }),
  },
];

describe.each(implementations)('AC2: $name conformance', ({ name, makeDecrypter }) => {
  it(`${name} reports the aes-256-gcm algorithm id`, () => {
    expect(makeDecrypter().algorithm).toBe('aes-256-gcm');
  });

  it(`${name} unwraps the RSA-OAEP-wrapped key and decrypts the ciphertext (key-wrap + RSA unwrap)`, async () => {
    const request = encryptAesGcm(
      vectors.encryption.plaintext,
      vectors.encryption.publicKeyPem,
      vectors.encryption.additionalData,
    );

    const plaintext = await makeDecrypter().decrypt({
      ...request,
      additionalData: new TextEncoder().encode(vectors.encryption.additionalData),
    });

    expect(new TextDecoder().decode(plaintext)).toBe(vectors.encryption.plaintext);
  });

  it(`${name} unwraps the frozen oaep-wrap.vector.json / sdk-defects.vector.json fixture to its known plaintext`, async () => {
    expect(sdkDefects.gcmTag.receiverKeyVector).toBe('oaep-wrap.vector.json');
    const okCase = sdkDefects.gcmTag.cases.find((c) => c.name === 'full-16-byte-tag-decrypts');
    if (!okCase) throw new Error('fixture missing full-16-byte-tag-decrypts case');

    const decrypter =
      name === 'PemDecrypter'
        ? new PemDecrypter({ privateKey: oaepWrapVector.privateKeyPem })
        : new KmsDecrypter({
            client: fakeKmsDecryptClient(oaepWrapVector.privateKeyPem),
            keyId: 'test-encryption-key',
          });

    const plaintext = await decrypter.decrypt({
      encryptedKey: b64(okCase.encryption.encryptedKey),
      iv: b64(okCase.encryption.iv),
      ciphertext: b64(sdkDefects.gcmTag.data),
      authTag: b64(okCase.encryption.authTag),
    });

    expect(new TextDecoder().decode(plaintext)).toBe(sdkDefects.gcmTag.plaintext);
  });

  it.each(
    sdkDefects.gcmTag.cases
      .filter((c) => c.expect === 'reject')
      .map((c) => [c.name, c] as const),
  )(`${name} rejects the sdk-defects.vector.json case: %s (T-26)`, async (_caseName, defectCase) => {
    const decrypter =
      name === 'PemDecrypter'
        ? new PemDecrypter({ privateKey: oaepWrapVector.privateKeyPem })
        : new KmsDecrypter({
            client: fakeKmsDecryptClient(oaepWrapVector.privateKeyPem),
            keyId: 'test-encryption-key',
          });

    await expect(
      decrypter.decrypt({
        encryptedKey: b64(defectCase.encryption.encryptedKey),
        iv: b64(defectCase.encryption.iv),
        ciphertext: b64(sdkDefects.gcmTag.data),
        authTag: b64(defectCase.encryption.authTag),
      }),
    ).rejects.toThrow();
  });

  it(`${name} enforces exactly 16-byte authTagLength even when the short tag happens to be a valid prefix of the real one (T-26)`, async () => {
    const request = encryptAesGcm(vectors.encryption.plaintext, vectors.encryption.publicKeyPem);
    const shortButRealPrefixTag = request.authTag.slice(0, 12);

    await expect(
      makeDecrypter().decrypt({ ...request, authTag: shortButRealPrefixTag }),
    ).rejects.toThrow();
  });

  it(`${name} fails the tag check when additionalData does not match what the sender bound (T-28)`, async () => {
    const boundAad = vectors.encryption.additionalData;
    const wrongAad = `${boundAad}-tampered`;
    const request = encryptAesGcm(vectors.encryption.plaintext, vectors.encryption.publicKeyPem, boundAad);

    await expect(
      makeDecrypter().decrypt({
        ...request,
        additionalData: new TextEncoder().encode(wrongAad),
      }),
    ).rejects.toThrow();
  });

  it(`${name} passes correct additionalData through unchanged, so a correctly bound recipient still decrypts (T-28 positive case)`, async () => {
    const boundAad = vectors.encryption.additionalData;
    const request = encryptAesGcm(vectors.encryption.plaintext, vectors.encryption.publicKeyPem, boundAad);

    const plaintext = await makeDecrypter().decrypt({
      ...request,
      additionalData: new TextEncoder().encode(boundAad),
    });

    expect(new TextDecoder().decode(plaintext)).toBe(vectors.encryption.plaintext);
  });
});

describe('AC6: KmsDecrypter exposes no private key material (T-27)', () => {
  it('the KmsDecrypter constructor options do not accept a private key', () => {
    type KmsDecrypterOptions = ConstructorParameters<typeof KmsDecrypter>[0];
    expectTypeOf<KmsDecrypterOptions>().not.toHaveProperty('privateKey');
    expectTypeOf<KmsDecrypterOptions>().not.toHaveProperty('privateKeyPem');
  });

  it('no Decrypter method accepts a private key as an argument', () => {
    // Decrypter.decrypt takes only the wrapped-key/ciphertext request shape;
    // nothing in DecryptRequest is private key material (T-27).
    expectTypeOf<Decrypter['decrypt']>().parameters.toEqualTypeOf<
      [Parameters<Decrypter['decrypt']>[0]]
    >();
    expectTypeOf<Parameters<Decrypter['decrypt']>[0]>().not.toHaveProperty('privateKey');
    expectTypeOf<Parameters<Decrypter['decrypt']>[0]>().not.toHaveProperty('privateKeyPem');
  });
});

describe('AC4: src/decrypter-interface.ts is runtime-agnostic', () => {
  const SRC_PATH = join(__dirname, '../src/decrypter-interface.ts');
  const source = readFileSync(SRC_PATH, 'utf8');

  it('imports nothing from node:*, fs, crypto or @aws-sdk/*', () => {
    const importSpecifiers = [
      ...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);

    const forbidden = importSpecifiers.filter(
      (spec) =>
        spec.startsWith('node:') ||
        spec === 'fs' ||
        spec === 'crypto' ||
        spec.startsWith('@aws-sdk/'),
    );

    expect(forbidden).toEqual([]);
  });
});
