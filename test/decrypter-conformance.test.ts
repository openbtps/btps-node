/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Decrypter conformance: PemDecrypter and KmsDecrypter behave alike, the
 * interface is runtime-agnostic, a KMS failure fails closed, and no private
 * key material is exposed.
 *
 * These tests were written before any implementation existed.
 *
 * Shape assumed, for the same reason given in signer-conformance.test.ts
 * (naming follows the existing BTPEncryption fields: encryptedKey, iv,
 * authTag):
 *
 *   interface DecryptRequest {
 *     encryptedKey: Uint8Array;      // RSA-OAEP wrapped AES-256 key
 *     iv: Uint8Array;
 *     ciphertext: Uint8Array;
 *     authTag: Uint8Array;           // must be exactly 16 bytes; a short tag is refused
 *     additionalData?: Uint8Array;   // recipient-binding AAD
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
 * same change rather than treating the mismatch as separate work.
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
import {
  decryptBtpPayload,
  decryptVerify,
  encryptBtpPayload,
  signBtpPayload,
  type BTPEncryption,
} from '@core/crypto/index.js';

// The two tests that spawn a real `tsc` can pass 5 s under a parallel CI
// run, so they get 30 s each, as in signer-conformance.test.ts. The tsc
// child is killed first, so a hung compiler fails the spawn, not the test.
const TSC_SPAWN_TIMEOUT_MS = 25000;

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

describe.each(implementations)('$name conformance', ({ name, makeDecrypter }) => {
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
  )(`${name} rejects the sdk-defects.vector.json case: %s (a short GCM tag)`, async (_caseName, defectCase) => {
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

  it(`${name} enforces exactly 16-byte authTagLength even when the short tag happens to be a valid prefix of the real one`, async () => {
    const request = encryptAesGcm(vectors.encryption.plaintext, vectors.encryption.publicKeyPem);
    const shortButRealPrefixTag = request.authTag.slice(0, 12);

    await expect(
      makeDecrypter().decrypt({ ...request, authTag: shortButRealPrefixTag }),
    ).rejects.toThrow();
  });

  it(`${name} fails the tag check when additionalData does not match what the sender bound (recipient binding)`, async () => {
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

  it(`${name} passes correct additionalData through unchanged, so a correctly bound recipient still decrypts (recipient binding, positive case)`, async () => {
    const boundAad = vectors.encryption.additionalData;
    const request = encryptAesGcm(vectors.encryption.plaintext, vectors.encryption.publicKeyPem, boundAad);

    const plaintext = await makeDecrypter().decrypt({
      ...request,
      additionalData: new TextEncoder().encode(boundAad),
    });

    expect(new TextDecoder().decode(plaintext)).toBe(vectors.encryption.plaintext);
  });
});

describe('KMS failure fails closed, with no partial/fallback plaintext', () => {
  const validTag = new Uint8Array(16);

  it('rejects with a typed retryable error when KMS throttles', async () => {
    const client: KmsDecryptClient = {
      async decrypt() {
        throw Object.assign(new Error('ThrottlingException'), { name: 'ThrottlingException' });
      },
    };
    const decrypter = new KmsDecrypter({ client, keyId: 'test-encryption-key' });

    await expect(
      decrypter.decrypt({
        encryptedKey: new Uint8Array(8),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(8),
        authTag: validTag,
      }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('rejects with a typed retryable error when KMS is unavailable, and never produces partial/fallback plaintext', async () => {
    const client: KmsDecryptClient = {
      async decrypt() {
        throw Object.assign(new Error('KMSInternalException'), { name: 'KMSInternalException' });
      },
    };
    const decrypter = new KmsDecrypter({ client, keyId: 'test-encryption-key' });

    let plaintext: Uint8Array | undefined;
    let caught: unknown;
    try {
      plaintext = await decrypter.decrypt({
        encryptedKey: new Uint8Array(8),
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(8),
        authTag: validTag,
      });
    } catch (err) {
      caught = err;
    }

    expect(plaintext).toBeUndefined();
    expect(caught).toMatchObject({ retryable: true });
  });
});

describe('KmsDecrypter exposes no private key material', () => {
  it('the KmsDecrypter constructor options do not accept a private key', () => {
    type KmsDecrypterOptions = ConstructorParameters<typeof KmsDecrypter>[0];
    expectTypeOf<KmsDecrypterOptions>().not.toHaveProperty('privateKey');
    expectTypeOf<KmsDecrypterOptions>().not.toHaveProperty('privateKeyPem');
  });

  it('no Decrypter method accepts a private key as an argument', () => {
    // Decrypter.decrypt takes only the wrapped-key/ciphertext request shape;
    // nothing in DecryptRequest is private key material.
    expectTypeOf<Decrypter['decrypt']>().parameters.toEqualTypeOf<
      [Parameters<Decrypter['decrypt']>[0]]
    >();
    expectTypeOf<Parameters<Decrypter['decrypt']>[0]>().not.toHaveProperty('privateKey');
    expectTypeOf<Parameters<Decrypter['decrypt']>[0]>().not.toHaveProperty('privateKeyPem');
  });

  // The expectTypeOf assertions above only fail a build under `vitest
  // typecheck` — the project's actual `test` script is `vitest run`, which
  // never type-checks test files, so a regression there would report green.
  // This test forces a real tsc pass over this file (same approach as the
  // runtime-agnostic tsc subprocess test below), so the assertions are enforced by
  // `yarn test`.
  it('this file type-checks under tsc (so the expectTypeOf assertions above are actually enforced)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'btps-decrypter-no-private-key-'));
    const tsconfigPath = join(tmpDir, 'tsconfig.json');
    const repoRoot = join(__dirname, '..');
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          skipLibCheck: true,
          allowSyntheticDefaultImports: true,
          resolveJsonModule: true,
          target: 'ES2022',
          noEmit: true,
          baseUrl: join(repoRoot, 'src'),
          paths: { '@core/*': ['core/*'] },
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          strict: true,
          isolatedModules: true,
        },
        files: [join(__dirname, 'decrypter-conformance.test.ts')],
      }),
    );

    const tscBin = join(process.cwd(), 'node_modules', '.bin', 'tsc');
    const result = spawnSync(tscBin, ['-p', tsconfigPath], {
      encoding: 'utf8',
      timeout: TSC_SPAWN_TIMEOUT_MS,
    });

    expect(result.error).toBeUndefined();
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 30000);
});

describe('src/decrypter-interface.ts is runtime-agnostic', () => {
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

  it('type-checks under tsc with lib es2022+dom and no @types/node', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'btps-decrypter-interface-'));
    const tsconfigPath = join(tmpDir, 'tsconfig.json');
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          target: 'es2022',
          lib: ['es2022', 'dom'],
          module: 'esnext',
          moduleResolution: 'bundler',
          types: [],
        },
        files: [SRC_PATH],
      }),
    );

    const tscBin = join(process.cwd(), 'node_modules', '.bin', 'tsc');
    const result = spawnSync(tscBin, ['-p', tsconfigPath], {
      encoding: 'utf8',
      timeout: TSC_SPAWN_TIMEOUT_MS,
    });

    expect(result.error).toBeUndefined();
    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 30000);
});

// The same implementations, through the SDK's own
// decryption paths rather than called directly.
describe.each(implementations)('$name through the SDK core', ({ name, makeDecrypter }) => {
  const forOaepWrap = (): Decrypter =>
    name === 'PemDecrypter'
      ? new PemDecrypter({ privateKey: oaepWrapVector.privateKeyPem })
      : new KmsDecrypter({
          client: fakeKmsDecryptClient(oaepWrapVector.privateKeyPem),
          keyId: 'test-encryption-key',
        });

  it(`decryptBtpPayload opens what encryptBtpPayload sealed, through ${name}`, async () => {
    const document = { plaintext: vectors.encryption.plaintext };
    const { data, encryption } = encryptBtpPayload(document, vectors.encryption.publicKeyPem);
    const result = await decryptBtpPayload(data, encryption, makeDecrypter());
    expect(result).toEqual({ data: document, error: undefined });
  });

  it.each(sdkDefects.gcmTag.cases.map((c) => [c.name, c] as const))(
    `decryptBtpPayload through ${name}: sdk-defects.vector.json case %s`,
    async (_caseName, defectCase) => {
      const result = await decryptBtpPayload(
        sdkDefects.gcmTag.data,
        defectCase.encryption as BTPEncryption,
        forOaepWrap(),
      );
      if (defectCase.expect === 'accept') {
        expect(result.error).toBeUndefined();
        expect(JSON.stringify(result.data)).toBe(sdkDefects.gcmTag.plaintext);
      } else {
        expect(result.data).toBeUndefined();
        expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
      }
    },
  );

  it(`decryptVerify verifies, then opens through ${name}`, async () => {
    const sender = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const document = { plaintext: vectors.encryption.plaintext };
    const { data, encryption } = encryptBtpPayload(document, vectors.encryption.publicKeyPem);
    const unsigned = {
      from: 'alice$saas.example',
      to: 'bob$receiver.example',
      document: data,
      encryption,
      encryptionSelector: 'btps1',
    };
    const artifact = { ...unsigned, signature: await signBtpPayload(unsigned, sender) };

    for (const receiverKeys of [makeDecrypter(), () => makeDecrypter()]) {
      const { payload, error } = await decryptVerify(sender.publicKey, artifact, receiverKeys);
      expect(error).toBeUndefined();
      expect(payload?.document).toEqual(document);
    }
  });
});
