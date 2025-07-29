/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTPStorageRecord, StorageStoreOptions } from './types.js';

export abstract class AbstractStorageStore<T extends BTPStorageRecord> {
  protected connection: unknown;
  protected entityName?: string;

  constructor({ connection, entityName }: StorageStoreOptions) {
    this.connection = connection;
    this.entityName = entityName;
  }

  abstract getById(computedId: string): Promise<T | undefined>;
  abstract create(record: Omit<T, 'id'>, computedId?: string): Promise<T>;
  abstract update(computedId: string, patch: Partial<T>): Promise<T>;
  abstract delete(computedId: string): Promise<void>;
}
