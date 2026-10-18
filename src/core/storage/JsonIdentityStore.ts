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
   * Creates a new identity record. Fails if one already exists.
   * @param computedId - The record id the server computes (`computeId(identity)`); computed from `record.identity` when not given.
   */
  async create(
    record: Omit<BTPIdentityRecord, 'id'>,
    computedId?: string,
  ): Promise<BTPIdentityRecord> {
    if ('id' in record) {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: 'Record passed to create() must not include an id',
      });
    }

    const id = computedId ?? computeId(record.identity);
    if (await this.getById(id)) {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: `Record already exists for ${record.identity}`,
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
   * @param computedId - The record id the server computes (`computeId(identity)`), used as given.
   * @param selector - The selector to get the public key for.
   * @returns The public key for the given identity and selector.
   */
  async getPublicKeyRecord(
    computedId: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined> {
    const record = await super.getById(computedId);
    if (!record) return undefined;
    const pointer = selector ?? record.currentSelector;
    return record.publicKeys.find((key) => key.selector === pointer);
  }
}
