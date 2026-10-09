/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-233 (Item 8a) — AC1, AC3, AC4, AC5, AC6.
 *
 * These tests are the executable form of the acceptance criteria, written
 * from the ticket before any implementation existed.
 *
 * The ticket does not prescribe the exact shape of `Signer`, `PemSigner` or
 * `KmsSigner` — only the three things AC1 names (sign, getPublicKey,
 * algorithm id) and the threat-model constraints (T-06, T-27). This file
 * fixes a concrete shape so the criteria are checkable, following the
 * naming already used elsewhere in src/core/crypto (PemKeys has
 * `publicKey`/`privateKey`; BTPKeyPair adds `fingerprint`):
 *
 *   interface Signer {
 *     readonly algorithm: 'RSASSA_PKCS1_V1_5_SHA_256';
 *     sign(data: Uint8Array): Promise<Uint8Array>;
 *     getPublicKey(): Promise<{ publicKey: string; fingerprint: string }>;
 *   }
 *   new PemSigner({ publicKey, privateKey })
 *   new KmsSigner({ client, keyId })   // `client` is an injected, duck-typed
 *                                      // KMS facade so this suite never makes
 *                                      // a network call; AC7 is the real-KMS
 *                                      // proof and is out of scope here.
 *
 * If the implementation lands on different names, update this file in the
 * same change rather than treating the mismatch as a second ticket.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import crypto from 'crypto';

import type { Signer } from '../src/signer-interface.js';
import { PemSigner } from '../src/pem-signer.js';
import { KmsSigner, type KmsSignClient } from '../src/kms-signer.js';
import { verifySignature } from '@core/crypto/index.js';

interface SigningVector {
  algorithm: string;
  publicKeyPem: string;
  privateKeyPem: string;
  payload: Record<string, unknown>;
}

interface Vectors {
  signing: SigningVector;
}

const vectors: Vectors = JSON.parse(
  readFileSync(join(__dirname, 'vectors.json'), 'utf8'),
);

function fakeKmsSignClient(privateKeyPem: string, publicKeyPem: string): KmsSignClient {
  return {
    async sign({ message }) {
      // Stands in for AWS KMS's RSASSA_PKCS1_V1_5_SHA_256: deterministic
      // PKCS#1 v1.5 / SHA-256 over the raw bytes, same as KMS MessageType RAW.
      const signature = crypto.sign('sha256', Buffer.from(message), privateKeyPem);
      return { signature: new Uint8Array(signature) };
    },
    async getPublicKey() {
      return { publicKeyPem };
    },
  };
}

type Implementation = {
  name: string;
  makeSigner: () => Signer;
  publicKeyPem: string;
};

const implementations: Implementation[] = [
  {
    name: 'PemSigner',
    makeSigner: () =>
      new PemSigner({
        publicKey: vectors.signing.publicKeyPem,
        privateKey: vectors.signing.privateKeyPem,
      }),
    publicKeyPem: vectors.signing.publicKeyPem,
  },
  {
    name: 'KmsSigner',
    makeSigner: () =>
      new KmsSigner({
        client: fakeKmsSignClient(vectors.signing.privateKeyPem, vectors.signing.publicKeyPem),
        keyId: 'test-signing-key',
      }),
    publicKeyPem: vectors.signing.publicKeyPem,
  },
];

describe.each(implementations)('AC1: $name conformance', ({ name, makeSigner, publicKeyPem }) => {
  it(`${name} reports the pinned algorithm id`, () => {
    const signer = makeSigner();
    expect(signer.algorithm).toBe('RSASSA_PKCS1_V1_5_SHA_256');
  });

  it(`${name}.getPublicKey() returns the signer's own public key`, async () => {
    const signer = makeSigner();
    const { publicKey } = await signer.getPublicKey();
    expect(publicKey.trim()).toBe(publicKeyPem.trim());
  });

  it(`${name}.sign() produces bytes that verify against its own public key`, async () => {
    const signer = makeSigner();
    const data = new TextEncoder().encode(JSON.stringify(vectors.signing.payload));

    const signature = await signer.sign(data);

    const isValid = crypto.verify('sha256', Buffer.from(data), publicKeyPem, Buffer.from(signature));
    expect(isValid).toBe(true);
  });
});

describe('AC3: wire-format proof — a KMS signature and a PEM signature over the same input both verify through the unchanged 1.0 verify path', () => {
  it('signBtpPayload-equivalent output from both Signer implementations verifies via @core/crypto verifySignature', async () => {
    const pemSigner = new PemSigner({
      publicKey: vectors.signing.publicKeyPem,
      privateKey: vectors.signing.privateKeyPem,
    });
    const kmsSigner = new KmsSigner({
      client: fakeKmsSignClient(vectors.signing.privateKeyPem, vectors.signing.publicKeyPem),
      keyId: 'test-signing-key',
    });

    const payload = vectors.signing.payload;
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const fingerprint = crypto
      .createHash('sha256')
      .update(crypto.createPublicKey(vectors.signing.publicKeyPem).export({ format: 'der', type: 'spki' }))
      .digest('base64');

    for (const signer of [pemSigner, kmsSigner]) {
      const signature = await signer.sign(data);

      const { isValid, error } = verifySignature(
        payload,
        {
          algorithmHash: 'sha256',
          value: Buffer.from(signature).toString('base64'),
          fingerprint,
        },
        vectors.signing.publicKeyPem,
      );

      expect(error).toBeUndefined();
      expect(isValid).toBe(true);
    }
  });
});

describe('AC4: src/signer-interface.ts is runtime-agnostic', () => {
  const SRC_PATH = join(__dirname, '../src/signer-interface.ts');
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
    const tmpDir = mkdtempSync(join(tmpdir(), 'eba-233-signer-interface-'));
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
    const result = spawnSync(tscBin, ['-p', tsconfigPath], { encoding: 'utf8' });

    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('AC5: KMS failure fails closed, with no PEM fallback', () => {
  it('rejects with a typed retryable error when KMS throttles', async () => {
    const client: KmsSignClient = {
      async sign() {
        throw Object.assign(new Error('ThrottlingException'), { name: 'ThrottlingException' });
      },
      async getPublicKey() {
        return { publicKeyPem: vectors.signing.publicKeyPem };
      },
    };
    const signer = new KmsSigner({ client, keyId: 'test-signing-key' });

    await expect(signer.sign(new TextEncoder().encode('x'))).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('rejects with a typed retryable error when KMS is unavailable, and never produces an unsigned/PEM-signed fallback', async () => {
    const client: KmsSignClient = {
      async sign() {
        throw Object.assign(new Error('KMSInternalException'), { name: 'KMSInternalException' });
      },
      async getPublicKey() {
        return { publicKeyPem: vectors.signing.publicKeyPem };
      },
    };
    const signer = new KmsSigner({ client, keyId: 'test-signing-key' });

    let signature: Uint8Array | undefined;
    let caught: unknown;
    try {
      signature = await signer.sign(new TextEncoder().encode('x'));
    } catch (err) {
      caught = err;
    }

    expect(signature).toBeUndefined();
    expect(caught).toMatchObject({ retryable: true });
  });
});

describe('AC6: KmsSigner exposes no private key material (T-27)', () => {
  it('the KmsSigner constructor options do not accept a private key', () => {
    type KmsSignerOptions = ConstructorParameters<typeof KmsSigner>[0];
    expectTypeOf<KmsSignerOptions>().not.toHaveProperty('privateKey');
    expectTypeOf<KmsSignerOptions>().not.toHaveProperty('privateKeyPem');
  });

  it('no Signer method accepts a private key as an argument', () => {
    // Signer.sign takes only the bytes to sign; getPublicKey takes nothing.
    expectTypeOf<Signer['sign']>().parameters.toEqualTypeOf<[Uint8Array]>();
    expectTypeOf<Signer['getPublicKey']>().parameters.toEqualTypeOf<[]>();
  });

  // The two expectTypeOf assertions above only fail a build under `vitest
  // typecheck` — the project's actual `test` script is `vitest run`, which
  // never type-checks test files, so a regression there would report green.
  // This test forces a real tsc pass over this file (same approach as the
  // AC4 tsc subprocess test above), so the assertions are enforced by
  // `yarn test`.
  it('this file type-checks under tsc (so the expectTypeOf assertions above are actually enforced)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eba-233-signer-ac6-'));
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
        files: [join(__dirname, 'signer-conformance.test.ts')],
      }),
    );

    const tscBin = join(process.cwd(), 'node_modules', '.bin', 'tsc');
    const result = spawnSync(tscBin, ['-p', tsconfigPath], { encoding: 'utf8' });

    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
