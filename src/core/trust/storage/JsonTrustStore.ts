/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPTrustRecord } from '../types.js';
import { AbstractTrustStore, computeTrustId } from '../index.js';
import { BTPErrorException } from '@core/error/index.js';
import { StorageStoreOptions } from '@core/storage/types.js';
import { JsonStorageStore } from '@core/storage/JsonStorageStore.js';

/**
 * JSON-based TrustStore for self-hosted environments.
 * Uses a Map internally for fast lookup and persists trust records to a single JSON file.
 * Supports multi-tenant BTPS inboxes by indexing records by to Identity + from Identity.
 */
class JsonTrustStore
  extends JsonStorageStore<BTPTrustRecord>
  implements AbstractTrustStore<BTPTrustRecord>
{
  constructor(options: StorageStoreOptions) {
    super(options);
  }

  /**
   * Creates a new trust record. Fails if one already exists for to/from.
   */
  async create(record: Omit<BTPTrustRecord, 'id'>, computedId?: string): Promise<BTPTrustRecord> {
    if ('id' in record) {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: 'Record passed to create() must not include an id',
      });
    }

    const id = computedId ?? computeTrustId(record.senderId, record.receiverId);
    if (await this.getById(id)) {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: `Record already exists for ${record.senderId} → ${record.receiverId}`,
      });
    }

    const newRecord = { id, ...record };

    this.recordMap.set(id, newRecord);
    this.dirty = true;
    this.writeDebounced();
    return newRecord;
  }

  /**
   * Returns all trust records, optionally filtered by to.
   */
  async getAll(receiverId?: string): Promise<BTPTrustRecord[]> {
    if (this.recordMap.size === 0) await this.init();
    await this.reloadIfChanged();
    const all = [...this.recordMap.values()] as BTPTrustRecord[];
    return receiverId ? all.filter((r) => r.receiverId === receiverId) : all;
  }
}

export default JsonTrustStore;
