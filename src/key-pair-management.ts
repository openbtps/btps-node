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

/** Builds a KeyPair from raw material. Each side is constructed through its
 * own class, so a signing-use key in the encryption slot (or vice versa)
 * throws from SigningKey's/EncryptionKey's own keyUse check rather than
 * being accepted here and failing later. */
export function createKeyPair(material: KeyPairMaterial): KeyPair {
  return {
    signingKey: new SigningKey(material.signingKey),
    encryptionKey: new EncryptionKey(material.encryptionKey),
  };
}

/** Replaces `pair`'s signing key with one built from `newSigningKey`,
 * leaving the existing encryption key untouched. */
export function rotateSigningKey(pair: KeyPair, newSigningKey: SigningKeyMaterial): KeyPair {
  return {
    signingKey: new SigningKey(newSigningKey),
    encryptionKey: pair.encryptionKey,
  };
}

/** Replaces `pair`'s encryption key with one built from `newEncryptionKey`,
 * leaving the existing signing key untouched. */
export function rotateEncryptionKey(
  pair: KeyPair,
  newEncryptionKey: EncryptionKeyMaterial,
): KeyPair {
  return {
    signingKey: pair.signingKey,
    encryptionKey: new EncryptionKey(newEncryptionKey),
  };
}
