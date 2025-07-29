/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPErrorException } from '@core/error/index.js';
import {
  BTPIdentityRecord,
  StorageStoreOptions,
  IdentityPubKeyRecord,
} from '@core/storage/types.js';
import { JsonStorageStore } from '@core/storage/JsonStorageStore.js';
import { computeId } from '@core/utils/index.js';
import { AbstractIdentityStore } from './AbstractIdentityStore.js';

/**
 * JSON-based TrustStore for self-hosted environments.
 * Uses a Map internally for fast lookup and persists trust records to a single JSON file.
 * Supports multi-tenant BTPS inboxes by indexing records by to Identity + from Identity.
 */
export class JsonIdentityStore
  extends JsonStorageStore<BTPIdentityRecord>
  implements AbstractIdentityStore<BTPIdentityRecord>
{
  constructor(options: StorageStoreOptions) {
    super(options);
  }

  /**
   * Creates a new trust record. Fails if one already exists for to/from.
   */
  async create(
    record: Omit<BTPIdentityRecord, 'id'>,
    identity: string,
  ): Promise<BTPIdentityRecord> {
    if ('id' in record) {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: 'Record passed to create() must not include an id',
      });
    }

    const id = computeId(identity);
    if (await this.getById(id)) {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: `Record already exists for ${identity}`,
      });
    }

    const newRecord = { id, ...record };

    this.recordMap.set(id, newRecord);
    this.dirty = true;
    this.writeDebounced();
    return newRecord;
  }

  /**
   * Returns the public key for a given identity and selector.
   * @param identity - The identity to get the public key for.
   * @param selector - The selector to get the public key for.
   * @returns The public key for the given identity and selector.
   */
  async getPublicKeyRecord(
    identity: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined> {
    const record = await super.getById(computeId(identity));
    if (!record) return undefined;
    const pointer = selector ?? record.currentSelector;
    return record.publicKeys.find((key) => key.selector === pointer);
  }
}
