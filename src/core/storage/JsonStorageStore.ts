/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'fs/promises';
import { existsSync } from 'fs';
import { lock } from 'proper-lockfile';
import debounce from 'lodash/debounce.js';
import isEmpty from 'lodash/isEmpty.js';

import { AbstractStorageStore } from './AbstractStorageStore.js';
import { BTPStorageRecord, StorageStoreOptions } from './types.js';
import { BTPErrorException } from '@core/error/index.js';
import { computeId } from '@core/utils/index.js';

/**
 * JSON-based StorageStore for self-hosted environments.
 * Uses a Map internally for fast lookup and persists storage records to a single JSON file.
 * Supports multi-tenant BTPS inboxes by indexing records by to Identity + from Identity.
 */
export class JsonStorageStore<T extends BTPStorageRecord> extends AbstractStorageStore<T> {
  protected recordMap: Map<string, BTPStorageRecord> = new Map();
  protected dirty = false;
  protected filePath: string;
  protected hasEntity: boolean = false;
  protected writeDebounced: () => void;
  protected lastChangedMtime: number = 0;

  constructor(options: StorageStoreOptions) {
    super(options);

    if (typeof options.connection !== 'string') {
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: 'JSON StorageStore expects a file path as connection',
      });
    }

    this.filePath = options.connection;
    this.hasEntity = !isEmpty(this.entityName);

    this.writeDebounced = debounce(() => this.writeToFile(), 1000);

    // Flush pending writes on process shutdown
    process.on('SIGINT', async () => {
      await this.writeToFile();
      process.exit();
    });
    process.on('SIGTERM', async () => {
      await this.writeToFile();
      process.exit();
    });
  }

  /**
   * checks and reloads if the file has changed externally or manually
   */
  protected async reloadIfChanged(): Promise<void> {
    const stat = await fs.stat(this.filePath);
    const mtime = stat.mtimeMs;

    if (mtime !== this.lastChangedMtime) {
      await this.flushAndReload();
      this.lastChangedMtime = mtime;
    }
  }

  /**
   * Initializes in-memory store from disk. If file is missing, creates a new one.
   */
  protected async init(): Promise<void> {
    if (!existsSync(this.filePath)) {
      const empty = this.hasEntity ? { [this.entityName as string]: [] } : [];
      await fs.writeFile(this.filePath, JSON.stringify(empty, null, 2), 'utf8');
    }

    const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    const records: T[] = this.hasEntity ? raw?.[this.entityName as string] || [] : raw;

    this.recordMap.clear();
    for (const r of records) {
      const key = r.id;
      this.recordMap.set(key, r);
    }
  }

  /**
   * Atomically writes the in-memory storage records to disk using a lock.
   */
  protected async writeToFile() {
    if (!this.dirty) return;
    this.dirty = false;

    let release: (() => Promise<void>) | undefined;
    const tmpPath = this.filePath + '.tmp';

    try {
      release = await lock(this.filePath, {
        retries: { retries: 5, factor: 1.5, minTimeout: 100, maxTimeout: 1000 },
        stale: 5000,
      });

      const records = [...this.recordMap.values()];
      const contents = this.hasEntity ? { [this.entityName as string]: records } : records;

      await fs.writeFile(tmpPath, JSON.stringify(contents, null, 2), 'utf8');
      await fs.rename(tmpPath, this.filePath); // Atomic replace
      /* update the file changed time so updated from the class will match on read avoiding double flush */
      this.lastChangedMtime = (await fs.stat(this.filePath)).mtimeMs;
    } finally {
      if (release) await release();
    }
  }

  /**
   * Retrieves a record by its ID.
   */
  async getById(computedId: string): Promise<T | undefined> {
    if (this.recordMap.size === 0) await this.init();
    await this.reloadIfChanged();
    return this.recordMap.get(computedId) as T | undefined;
  }

  /**
   * Creates a new storage record. Fails if one already exists for identity.
   */
  async create(record: Omit<T, 'id'>, identity: string): Promise<T> {
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
    return newRecord as T;
  }

  /**
   * Updates an existing storage record by merging with the patch.
   */
  async update(computedId: string, patch: Partial<T>): Promise<T> {
    const record = await this.getById(computedId);
    if (!record)
      throw new BTPErrorException({
        code: 'INVALID_CONFIG',
        message: `No record found for ${computedId}`,
      });

    const updated = { ...record, ...patch };
    this.recordMap.set(computedId, updated);
    this.dirty = true;
    this.writeDebounced();
    return updated as T;
  }

  /**
   * Deletes a storage record for a given identity.
   */
  async delete(computedId: string): Promise<void> {
    if (this.recordMap.size === 0) await this.init();
    if (this.recordMap.delete(computedId)) {
      this.dirty = true;
      this.writeDebounced();
    }
  }

  /**
   * Forces immediate disk flush of storage records.
   */
  async flushNow(): Promise<void> {
    await this.writeToFile();
  }

  /**
   * Flushes and reloads storage records from disk.
   */
  async flushAndReload(): Promise<void> {
    await this.writeToFile();
    this.recordMap.clear();
    await this.init();
  }
}
