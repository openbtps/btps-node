/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AbstractStorageStore } from '@core/storage/AbstractStorageStore.js';
import { BTPIdentityRecord, IdentityPubKeyRecord } from '@core/storage/types.js';
import type { BTPKeyChainRecord } from '@core/trust/types.js';

export abstract class AbstractIdentityStore<
  T extends BTPIdentityRecord,
> extends AbstractStorageStore<T> {
  /**
   * Since 1.2, optional: the identity's key chain, oldest first, which the
   * server sends to a 1.2.0 lookup that asks for it. The provider writes it
   * (signKeyRotation, signKeyExpiry); the server only reads it. None, or an
   * empty chain, is an identity that never rotated.
   * @param computedId - As for getPublicKeyRecord.
   */
  getKeyChain?(computedId: string): Promise<BTPKeyChainRecord[] | undefined>;

  /**
   * The public key record of an identity at a selector (its current one when not given).
   * @param computedId - The record id the server computes with `computeId(identity)`.
   *   Use it as the record id as given; never hash it again. The server computes it
   *   so every store keys records the same fixed-length way, however long the identity.
   */
  abstract getPublicKeyRecord(
    computedId: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined>;
}
