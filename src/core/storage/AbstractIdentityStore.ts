/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AbstractStorageStore } from '@core/storage/AbstractStorageStore.js';
import { BTPIdentityRecord, IdentityPubKeyRecord } from '@core/storage/types.js';

export abstract class AbstractIdentityStore<
  T extends BTPIdentityRecord,
> extends AbstractStorageStore<T> {
  /**
   * The key record of `identity` (e.g. `alice$saas.com`) at `selector`, or at
   * its current selector when none is given. Takes the identity itself, not
   * its computed id: a store that keys records by `computeId` hashes it here.
   */
  abstract getPublicKeyRecord(
    identity: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined>;
}
