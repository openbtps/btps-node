/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-121 (Item 9). Pairs a SigningKey with an EncryptionKey under one
 * identity, and rotates either side independently.
 *
 * Rotation returns a new KeyPair rather than mutating the one passed in —
 * the untouched side is carried over as the same SigningKey/EncryptionKey
 * instance (same object, same fingerprint), which is what "rotation of
 * either key does not affect the other" means here: the other side is not
 * just unchanged in value, it is literally not re-constructed.
 */

import { SigningKey, type SigningKeyMaterial } from './signing-key.js';
import { EncryptionKey, type EncryptionKeyMaterial } from './encryption-key.js';

export interface KeyPair {
  signingKey: SigningKey;
  encryptionKey: EncryptionKey;
}

export interface KeyPairMaterial {
  signingKey: SigningKeyMaterial;
  encryptionKey: EncryptionKeyMaterial;
}

/**
 * Refuses a KeyPair whose signing and encryption sides are the same RSA key
 * pair, merely tagged differently. keyUse is self-declared on the material
 * each class trusts at construction, so the same private key tagged
 * 'signing' in one slot and 'encryption' in the other passes both classes'
 * own checks and would otherwise sign and decrypt with one key — the exact
 * key confusion this ticket exists to prevent. Compared by fingerprint of
 * the public key (SHA-256 of the DER-encoded SPKI form), not by comparing
 * PEM text, so formatting differences in an otherwise-identical key cannot
 * slip past this check.
 */
function assertDistinctKeyMaterial(signingKey: SigningKey, encryptionKey: EncryptionKey): void {
  if (signingKey.fingerprint === encryptionKey.fingerprint) {
    throw new Error(
      'signingKey and encryptionKey must be distinct RSA key pairs: the same key material was supplied for both slots',
    );
  }
}

/** Builds a KeyPair from raw material. Each side is constructed through its
 * own class, so a signing-use key in the encryption slot (or vice versa)
 * throws from SigningKey's/EncryptionKey's own keyUse check rather than
 * being accepted here and failing later. The two constructed keys are then
 * checked against each other for actual distinctness (see
 * assertDistinctKeyMaterial) — the keyUse check alone cannot catch the same
 * key pair correctly tagged in both slots. */
export function createKeyPair(material: KeyPairMaterial): KeyPair {
  const signingKey = new SigningKey(material.signingKey);
  const encryptionKey = new EncryptionKey(material.encryptionKey);
  assertDistinctKeyMaterial(signingKey, encryptionKey);
  return { signingKey, encryptionKey };
}

/** Replaces `pair`'s signing key with one built from `newSigningKey`,
 * leaving the existing encryption key untouched. Refuses the rotation if
 * `newSigningKey` turns out to be the same RSA key pair as the untouched
 * encryption key. */
export function rotateSigningKey(pair: KeyPair, newSigningKey: SigningKeyMaterial): KeyPair {
  const signingKey = new SigningKey(newSigningKey);
  assertDistinctKeyMaterial(signingKey, pair.encryptionKey);
  return { signingKey, encryptionKey: pair.encryptionKey };
}

/** Replaces `pair`'s encryption key with one built from `newEncryptionKey`,
 * leaving the existing signing key untouched. Refuses the rotation if
 * `newEncryptionKey` turns out to be the same RSA key pair as the untouched
 * signing key. */
export function rotateEncryptionKey(
  pair: KeyPair,
  newEncryptionKey: EncryptionKeyMaterial,
): KeyPair {
  const encryptionKey = new EncryptionKey(newEncryptionKey);
  assertDistinctKeyMaterial(pair.signingKey, encryptionKey);
  return { signingKey: pair.signingKey, encryptionKey };
}
