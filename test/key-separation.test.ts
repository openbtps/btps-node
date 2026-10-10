/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-121 (Item 9) — signing and encryption are performed with distinct RSA
 * key pairs; decrypting with the signing key, or signing with the
 * encryption key, is rejected; neither key leaks into the other's role at
 * the type level; rotating one key leaves the other untouched.
 *
 * These tests are the executable form of the acceptance criteria, written
 * from the ticket before any implementation exists. None of
 * src/key-pair-management.ts, src/signing-key.ts or src/encryption-key.ts
 * exist yet, so every test below fails right now with a module-not-found
 * error — that is expected and correct for a test-first handoff.
 *
 * The ticket does not prescribe the exact shape of these three files, only
 * the behaviour the acceptance criteria name. This file fixes a concrete
 * shape so the criteria are checkable, following:
 *  - the EBA-233 Signer/Decrypter interfaces already in src/ (sign,
 *    getPublicKey, decrypt, DecryptRequest), which SigningKey/EncryptionKey
 *    are assumed to sit on top of for the actual crypto operations, and
 *  - the shape the key-separation vectors were already authored in
 *    (test/vectors/key-separation/*.vector.json), which tag every RSA key
 *    with an explicit `keyUse: 'signing' | 'encryption'` field. That field
 *    is the thing a wrong-key attempt is checked against, so the rejection
 *    is a deliberate business-logic check, not an incidental crypto
 *    failure (an RSA sign with the "wrong" private key would not fail on
 *    its own — it would just produce a signature that fails verification
 *    somewhere else, which is a weaker guarantee than the ticket asks for).
 *
 *   interface SigningKeyMaterial {
 *     keyUse: 'signing';
 *     algorithm: 'RSASSA_PKCS1_V1_5_SHA_256';
 *     publicKey: string;   // SPKI PEM
 *     privateKey: string;  // PKCS#8 PEM
 *     fingerprint?: string;
 *   }
 *   class SigningKey {
 *     readonly keyUse: 'signing';
 *     readonly algorithm: 'RSASSA_PKCS1_V1_5_SHA_256';
 *     constructor(material: SigningKeyMaterial);  // throws if material.keyUse !== 'signing'
 *     sign(data: Uint8Array): Promise<Uint8Array>;
 *     getPublicKey(): Promise<{ publicKey: string; fingerprint: string }>;
 *   }
 *
 *   interface EncryptionKeyMaterial {
 *     keyUse: 'encryption';
 *     algorithm: 'RSAES_OAEP_SHA_256';
 *     publicKey: string;
 *     privateKey: string;
 *     fingerprint?: string;
 *   }
 *   class EncryptionKey {
 *     readonly keyUse: 'encryption';
 *     readonly algorithm: 'RSAES_OAEP_SHA_256';
 *     constructor(material: EncryptionKeyMaterial);  // throws if material.keyUse !== 'encryption'
 *     decrypt(request: DecryptRequest): Promise<Uint8Array>;  // DecryptRequest from decrypter-interface.ts
 *     getPublicKey(): Promise<{ publicKey: string; fingerprint: string }>;
 *   }
 *
 *   interface KeyPair {
 *     signingKey: SigningKey;
 *     encryptionKey: EncryptionKey;
 *   }
 *   function createKeyPair(material: {
 *     signingKey: SigningKeyMaterial;
 *     encryptionKey: EncryptionKeyMaterial;
 *   }): KeyPair;
 *   function rotateSigningKey(pair: KeyPair, newSigningKey: SigningKeyMaterial): KeyPair;
 *   function rotateEncryptionKey(pair: KeyPair, newEncryptionKey: EncryptionKeyMaterial): KeyPair;
 *
 * If the implementation lands on different names, update this file in the
 * same change rather than treating the mismatch as a second ticket.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import crypto from 'crypto';

import { SigningKey, type SigningKeyMaterial } from '../src/signing-key.js';
import { EncryptionKey, type EncryptionKeyMaterial } from '../src/encryption-key.js';
import {
  createKeyPair,
  rotateSigningKey,
  rotateEncryptionKey,
  type KeyPair,
} from '../src/key-pair-management.js';

const VECTOR_DIR = join(__dirname, 'vectors/key-separation');

interface DistinctKeysVector {
  signingKey: SigningKeyMaterial;
  encryptionKey: EncryptionKeyMaterial;
  payload: Record<string, unknown>;
  plaintext: string;
}

interface RotationVector {
  rotatedSigningKey: SigningKeyMaterial;
  rotatedEncryptionKey: EncryptionKeyMaterial;
}

const distinctKeysVector: DistinctKeysVector = JSON.parse(
  readFileSync(join(VECTOR_DIR, 'distinct-keys.vector.json'), 'utf8'),
);
const rotationVector: RotationVector = JSON.parse(
  readFileSync(join(VECTOR_DIR, 'rotation.vector.json'), 'utf8'),
);

/** Wraps `plaintext` as the OAEP+AES-GCM envelope PemDecrypter/EncryptionKey
 * expect, mirroring decrypter-conformance.test.ts's helper. */
function encryptAesGcm(plaintext: string, publicKeyPem: string) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv) as crypto.CipherGCM;
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

function fingerprintOf(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' });
  return crypto.createHash('sha256').update(der).digest('base64');
}

describe('AC: vectors with distinct signing and encryption keys pass', () => {
  it('createKeyPair builds a pair whose signing side signs/verifies and whose encryption side unwraps/decrypts', async () => {
    const pair: KeyPair = createKeyPair({
      signingKey: distinctKeysVector.signingKey,
      encryptionKey: distinctKeysVector.encryptionKey,
    });

    const data = new TextEncoder().encode(JSON.stringify(distinctKeysVector.payload));
    const signature = await pair.signingKey.sign(data);
    const signatureValid = crypto.verify(
      'sha256',
      Buffer.from(data),
      distinctKeysVector.signingKey.publicKey,
      Buffer.from(signature),
    );
    expect(signatureValid).toBe(true);

    const envelope = encryptAesGcm(distinctKeysVector.plaintext, distinctKeysVector.encryptionKey.publicKey);
    const plaintext = await pair.encryptionKey.decrypt(envelope);
    expect(new TextDecoder().decode(plaintext)).toBe(distinctKeysVector.plaintext);
  });

  it('the signing and encryption keys in the vector are not the same key', () => {
    expect(distinctKeysVector.signingKey.publicKey.trim()).not.toBe(
      distinctKeysVector.encryptionKey.publicKey.trim(),
    );
    expect(distinctKeysVector.signingKey.fingerprint).not.toBe(
      distinctKeysVector.encryptionKey.fingerprint,
    );
  });
});

describe('AC: a shared private key is rejected even when each slot is tagged correctly', () => {
  it('createKeyPair refuses the same RSA key pair placed in both slots, merely re-tagged', () => {
    // Same publicKey/privateKey as the signing vector, re-tagged as the
    // encryption slot's material. Each slot's own keyUse check passes
    // (SigningKey sees 'signing', EncryptionKey sees 'encryption'), so this
    // must be refused by a check that the two slots' key material is
    // actually distinct, not by the keyUse guard.
    const sameKeyReTagged: EncryptionKeyMaterial = {
      ...distinctKeysVector.signingKey,
      keyUse: 'encryption',
      algorithm: 'RSAES_OAEP_SHA_256',
    };

    expect(() =>
      createKeyPair({
        signingKey: distinctKeysVector.signingKey,
        encryptionKey: sameKeyReTagged,
      }),
    ).toThrow();
  });

  it('rotating one slot onto the other slot\'s existing key is refused for the same reason', () => {
    const original = createKeyPair({
      signingKey: distinctKeysVector.signingKey,
      encryptionKey: distinctKeysVector.encryptionKey,
    });
    const encryptionKeyAsSigningMaterial: SigningKeyMaterial = {
      ...distinctKeysVector.encryptionKey,
      keyUse: 'signing',
      algorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
    };

    expect(() => rotateSigningKey(original, encryptionKeyAsSigningMaterial)).toThrow();
  });
});

describe('AC: both keys present in all test vectors', () => {
  const files = readdirSync(VECTOR_DIR).filter((f) => f.endsWith('.vector.json'));

  it('the key-separation vector directory is not empty', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s carries both a signing-use and an encryption-use key', (file) => {
    const parsed = JSON.parse(readFileSync(join(VECTOR_DIR, file), 'utf8'));
    const keyMaterials = Object.values(parsed).filter(
      (v): v is SigningKeyMaterial | EncryptionKeyMaterial =>
        typeof v === 'object' && v !== null && 'keyUse' in (v as Record<string, unknown>),
    );

    const signing = keyMaterials.filter((k) => k.keyUse === 'signing');
    const encryption = keyMaterials.filter((k) => k.keyUse === 'encryption');

    expect(signing.length, `${file} has no keyUse: 'signing' entry`).toBeGreaterThan(0);
    expect(encryption.length, `${file} has no keyUse: 'encryption' entry`).toBeGreaterThan(0);

    for (const s of signing) {
      for (const e of encryption) {
        expect(s.publicKey.trim()).not.toBe(e.publicKey.trim());
        expect(fingerprintOf(s.publicKey)).not.toBe(fingerprintOf(e.publicKey));
      }
    }
  });
});

describe('AC: a decrypt attempted with the signing key is rejected', () => {
  it('EncryptionKey refuses to be constructed from signing-use key material', () => {
    expect(() => new EncryptionKey(distinctKeysVector.signingKey as unknown as EncryptionKeyMaterial)).toThrow();
  });

  it('createKeyPair refuses an encryption slot filled with signing-use key material', () => {
    expect(() =>
      createKeyPair({
        signingKey: distinctKeysVector.signingKey,
        encryptionKey: distinctKeysVector.signingKey as unknown as EncryptionKeyMaterial,
      }),
    ).toThrow();
  });
});

describe('AC: a sign operation with the encryption key is rejected', () => {
  it('SigningKey refuses to be constructed from encryption-use key material', () => {
    expect(() => new SigningKey(distinctKeysVector.encryptionKey as unknown as SigningKeyMaterial)).toThrow();
  });

  it('createKeyPair refuses a signing slot filled with encryption-use key material', () => {
    expect(() =>
      createKeyPair({
        signingKey: distinctKeysVector.encryptionKey as unknown as SigningKeyMaterial,
        encryptionKey: distinctKeysVector.encryptionKey,
      }),
    ).toThrow();
  });
});

describe('AC: key confusion is impossible at the type level', () => {
  it('SigningKey and EncryptionKey are not mutually assignable', () => {
    expectTypeOf<SigningKey>().not.toExtend<EncryptionKey>();
    expectTypeOf<EncryptionKey>().not.toExtend<SigningKey>();
  });

  it('KeyPair.signingKey only accepts a SigningKey, KeyPair.encryptionKey only an EncryptionKey', () => {
    expectTypeOf<KeyPair['signingKey']>().toEqualTypeOf<SigningKey>();
    expectTypeOf<KeyPair['encryptionKey']>().toEqualTypeOf<EncryptionKey>();
  });

  it('SigningKey has no decrypt method and EncryptionKey has no sign method', () => {
    expectTypeOf<SigningKey>().not.toHaveProperty('decrypt');
    expectTypeOf<EncryptionKey>().not.toHaveProperty('sign');
  });

  // The expectTypeOf assertions above only fail a build under `vitest
  // typecheck` — the project's actual `test` script is `vitest run`, which
  // never type-checks test files, so a regression here would report green.
  // Forcing a real tsc pass (same approach as EBA-233's AC6 tests) makes
  // the assertions actually enforced by `yarn test`.
  it('this file type-checks under tsc (so the expectTypeOf assertions above are actually enforced)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eba-121-key-separation-'));
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
        files: [join(__dirname, 'key-separation.test.ts')],
      }),
    );

    const tscBin = join(process.cwd(), 'node_modules', '.bin', 'tsc');
    const result = spawnSync(tscBin, ['-p', tsconfigPath], { encoding: 'utf8' });

    expect(result.stdout + result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

describe('AC: rotation of either key does not affect the other', () => {
  it('rotating the signing key leaves the encryption key able to decrypt what it already could', async () => {
    const original = createKeyPair({
      signingKey: distinctKeysVector.signingKey,
      encryptionKey: distinctKeysVector.encryptionKey,
    });
    const envelope = encryptAesGcm(distinctKeysVector.plaintext, distinctKeysVector.encryptionKey.publicKey);

    const rotated = rotateSigningKey(original, rotationVector.rotatedSigningKey);

    // the encryption side is untouched: same fingerprint, still decrypts the
    // same envelope it could decrypt before the signing key rotated
    const fp = await rotated.encryptionKey.getPublicKey();
    expect(fp.fingerprint).toBe(distinctKeysVector.encryptionKey.fingerprint);
    const plaintext = await rotated.encryptionKey.decrypt(envelope);
    expect(new TextDecoder().decode(plaintext)).toBe(distinctKeysVector.plaintext);

    // the signing side did rotate: it now signs for the new key, not the old one
    const data = new TextEncoder().encode('post-rotation message');
    const signature = await rotated.signingKey.sign(data);
    expect(
      crypto.verify('sha256', Buffer.from(data), rotationVector.rotatedSigningKey.publicKey, Buffer.from(signature)),
    ).toBe(true);
    expect(
      crypto.verify('sha256', Buffer.from(data), distinctKeysVector.signingKey.publicKey, Buffer.from(signature)),
    ).toBe(false);
  });

  it('rotating the encryption key leaves the signing key able to sign/verify as before', async () => {
    const original = createKeyPair({
      signingKey: distinctKeysVector.signingKey,
      encryptionKey: distinctKeysVector.encryptionKey,
    });

    const rotated = rotateEncryptionKey(original, rotationVector.rotatedEncryptionKey);

    // the signing side is untouched: same fingerprint, still produces
    // signatures that verify against the original signing public key
    const fp = await rotated.signingKey.getPublicKey();
    expect(fp.fingerprint).toBe(distinctKeysVector.signingKey.fingerprint);
    const data = new TextEncoder().encode(JSON.stringify(distinctKeysVector.payload));
    const signature = await rotated.signingKey.sign(data);
    expect(
      crypto.verify('sha256', Buffer.from(data), distinctKeysVector.signingKey.publicKey, Buffer.from(signature)),
    ).toBe(true);

    // the encryption side did rotate: it now decrypts envelopes wrapped for
    // the new key, not the old one
    const envelopeForNewKey = encryptAesGcm('post-rotation secret', rotationVector.rotatedEncryptionKey.publicKey);
    const plaintext = await rotated.encryptionKey.decrypt(envelopeForNewKey);
    expect(new TextDecoder().decode(plaintext)).toBe('post-rotation secret');

    const envelopeForOldKey = encryptAesGcm('should not decrypt', distinctKeysVector.encryptionKey.publicKey);
    await expect(rotated.encryptionKey.decrypt(envelopeForOldKey)).rejects.toThrow();
  });
});
