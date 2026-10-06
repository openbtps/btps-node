/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
// EBA-116/117/118: on baseline 367cd09, getBTPKeyPair() produces a single RSA
// keypair used for both signing and encryption. There is no export that hands
// back two distinct keypairs, so this import is expected to fail until one
// is added.
import { generateIdentityKeyPairs } from './keygen.js';

describe('EBA-116/117/118: signing and encryption use separate keys from day one', () => {
  it('returns a dedicated signing keypair and a dedicated encryption keypair', () => {
    const identity = generateIdentityKeyPairs();

    expect(identity.signing.publicKey).toBeTruthy();
    expect(identity.encryption.publicKey).toBeTruthy();
    expect(identity.signing.publicKey).not.toBe(identity.encryption.publicKey);
    expect(identity.signing.privateKey).not.toBe(identity.encryption.privateKey);
  });

  it('gives the signing and encryption keys different fingerprints', () => {
    const identity = generateIdentityKeyPairs();

    expect(identity.signing.fingerprint).not.toBe(identity.encryption.fingerprint);
  });
});
