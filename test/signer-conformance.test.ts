/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * What every Signer must do, checked against the built-in PemSigner, and
 * that the Signer interface stays loadable in any runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import crypto from 'crypto';

import { PemSigner } from '@core/crypto/pem-signer.js';
import { canonicalizeValue, verifySignature } from '@core/crypto/index.js';

// The tsc run below can take several seconds on a busy CI runner, so it gets
// its own timeout, and the tsc child is killed a little before it.
const TSC_SPAWN_TIMEOUT_MS = 25000;

interface SigningVector {
  algorithm: string;
  publicKeyPem: string;
  privateKeyPem: string;
  payload: Record<string, unknown>;
}

interface Vectors {
  signing: SigningVector;
}

const vectors: Vectors = JSON.parse(readFileSync(join(__dirname, 'vectors.json'), 'utf8'));

const makeSigner = () =>
  new PemSigner({
    publicKey: vectors.signing.publicKeyPem,
    privateKey: vectors.signing.privateKeyPem,
  });

describe('PemSigner', () => {
  it('reports the RSA PKCS#1 v1.5 SHA-256 algorithm', () => {
    expect(makeSigner().algorithm).toBe('RSASSA_PKCS1_V1_5_SHA_256');
  });

  it("returns its own public key and that key's fingerprint", async () => {
    const { publicKey, fingerprint } = await makeSigner().getPublicKey();
    const der = crypto
      .createPublicKey(vectors.signing.publicKeyPem)
      .export({ format: 'der', type: 'spki' });

    expect(publicKey.trim()).toBe(vectors.signing.publicKeyPem.trim());
    expect(fingerprint).toBe(crypto.createHash('sha256').update(der).digest('base64'));
  });

  it('signs bytes that verify against its own public key', async () => {
    const data = new TextEncoder().encode(JSON.stringify(vectors.signing.payload));

    const signature = await makeSigner().sign(data);

    const isValid = crypto.verify(
      'sha256',
      Buffer.from(data),
      vectors.signing.publicKeyPem,
      Buffer.from(signature),
    );
    expect(isValid).toBe(true);
  });

  it("signs a payload's canonical bytes so the SDK's verifySignature accepts it", async () => {
    const payload = vectors.signing.payload;
    const data = new TextEncoder().encode(canonicalizeValue(payload));
    const signer = makeSigner();

    const signature = await signer.sign(data);
    const { fingerprint } = await signer.getPublicKey();

    const { isValid, error } = verifySignature(
      payload,
      { algorithmHash: 'sha256', value: Buffer.from(signature).toString('base64'), fingerprint },
      vectors.signing.publicKeyPem,
    );
    expect(error).toBeUndefined();
    expect(isValid).toBe(true);
  });
});

describe('the Signer interface loads in any runtime', () => {
  const SRC_PATH = join(__dirname, '../src/core/crypto/signer-interface.ts');
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
    const tmpDir = mkdtempSync(join(tmpdir(), 'btps-signer-interface-'));
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
