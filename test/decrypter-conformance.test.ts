/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * What every Decrypter must do, checked against the built-in PemDecrypter,
 * and that the Decrypter interface stays loadable in any runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import crypto from 'crypto';

import { PemDecrypter } from '@core/crypto/pem-decrypter.js';

// The tsc run below can take several seconds on a busy CI runner, so it gets
// its own timeout, and the tsc child is killed a little before it.
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

function encryptAesGcm(plaintext: string, publicKeyPem: string, additionalData?: string) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
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

const makeDecrypter = () => new PemDecrypter({ privateKey: vectors.encryption.privateKeyPem });

describe('PemDecrypter', () => {
  it('reports the aes-256-gcm algorithm', () => {
    expect(makeDecrypter().algorithm).toBe('aes-256-gcm');
  });

  it('unwraps the RSA-OAEP-wrapped key and decrypts the ciphertext', async () => {
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

  it('decrypts the frozen oaep-wrap / sdk-defects fixture to its known plaintext', async () => {
    expect(sdkDefects.gcmTag.receiverKeyVector).toBe('oaep-wrap.vector.json');
    const okCase = sdkDefects.gcmTag.cases.find((c) => c.name === 'full-16-byte-tag-decrypts');
    if (!okCase) throw new Error('fixture missing full-16-byte-tag-decrypts case');

    const plaintext = await new PemDecrypter({ privateKey: oaepWrapVector.privateKeyPem }).decrypt({
      encryptedKey: b64(okCase.encryption.encryptedKey),
      iv: b64(okCase.encryption.iv),
      ciphertext: b64(sdkDefects.gcmTag.data),
      authTag: b64(okCase.encryption.authTag),
    });

    expect(new TextDecoder().decode(plaintext)).toBe(sdkDefects.gcmTag.plaintext);
  });

  it.each(
    sdkDefects.gcmTag.cases.filter((c) => c.expect === 'reject').map((c) => [c.name, c] as const),
  )('rejects the sdk-defects fixture case: %s', async (_caseName, defectCase) => {
    const decrypter = new PemDecrypter({ privateKey: oaepWrapVector.privateKeyPem });

    await expect(
      decrypter.decrypt({
        encryptedKey: b64(defectCase.encryption.encryptedKey),
        iv: b64(defectCase.encryption.iv),
        ciphertext: b64(sdkDefects.gcmTag.data),
        authTag: b64(defectCase.encryption.authTag),
      }),
    ).rejects.toThrow();
  });

  it('refuses a tag shorter than 16 bytes, even one that is a prefix of the real tag', async () => {
    const request = encryptAesGcm(vectors.encryption.plaintext, vectors.encryption.publicKeyPem);
    const shortButRealPrefixTag = request.authTag.slice(0, 12);

    await expect(
      makeDecrypter().decrypt({ ...request, authTag: shortButRealPrefixTag }),
    ).rejects.toThrow();
  });

  it('fails the tag check when additionalData does not match what the sender bound', async () => {
    const boundAad = vectors.encryption.additionalData;
    const request = encryptAesGcm(
      vectors.encryption.plaintext,
      vectors.encryption.publicKeyPem,
      boundAad,
    );

    await expect(
      makeDecrypter().decrypt({
        ...request,
        additionalData: new TextEncoder().encode(`${boundAad}-tampered`),
      }),
    ).rejects.toThrow();
  });
});

describe('the Decrypter interface loads in any runtime', () => {
  const SRC_PATH = join(__dirname, '../src/core/crypto/decrypter-interface.ts');
  const source = readFileSync(SRC_PATH, 'utf8');

  it('imports nothing from node:*, fs or crypto', () => {
    const importSpecifiers = [
      ...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);

    const forbidden = importSpecifiers.filter(
      (spec) => spec?.startsWith('node:') || spec === 'fs' || spec === 'crypto',
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
