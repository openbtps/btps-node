/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import * as keygen from './keygen.js';

/*
 * Expected failures (`it.fails`) until EBA-116 (BTPS 1.1 item 6a, separate
 * signing and encryption keys and selectors) lands. On baseline 367cd09,
 * getBTPKeyPair() produces one RSA keypair used for both signing and
 * encryption, and keygen.ts has no generateIdentityKeyPairs export. When the
 * fix lands these turn red, and that change must flip `it.fails` to `it`.
 * Same ratchet as test/vectors/known-failing.json.
 */
const XFAIL = 'expected failure until EBA-116 lands';

interface KeyPairWithFingerprint {
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}
interface IdentityKeyPairs {
  signing: KeyPairWithFingerprint;
  encryption: KeyPairWithFingerprint;
}

function generateIdentityKeyPairs(): IdentityKeyPairs {
  // Looked up at call time so the file loads on a baseline without the export.
  const fn = (keygen as Record<string, unknown>).generateIdentityKeyPairs;
  if (typeof fn !== 'function') {
    throw new Error('keygen.ts does not export generateIdentityKeyPairs');
  }
  return fn() as IdentityKeyPairs;
}

describe('EBA-116: signing and encryption use separate keys from day one', () => {
  it.fails(
    `returns a dedicated signing keypair and a dedicated encryption keypair (${XFAIL})`,
    () => {
      const identity = generateIdentityKeyPairs();

      expect(identity.signing.publicKey).toBeTruthy();
      expect(identity.encryption.publicKey).toBeTruthy();
      expect(identity.signing.publicKey).not.toBe(identity.encryption.publicKey);
      expect(identity.signing.privateKey).not.toBe(identity.encryption.privateKey);
    },
  );

  it.fails(`gives the signing and encryption keys different fingerprints (${XFAIL})`, () => {
    const identity = generateIdentityKeyPairs();

    expect(identity.signing.fingerprint).not.toBe(identity.encryption.fingerprint);
  });
});
