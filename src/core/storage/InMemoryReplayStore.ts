/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { BTP_ERROR_RATE_LIMITER, BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';
import { REPLAY_STORE_DEFAULT_MAX_ENTRIES } from '@core/server/constants/replay.js';
import { AbstractReplayStore } from './AbstractReplayStore.js';
import { BTPReplayEntry } from './types.js';

export interface InMemoryReplayStoreOptions {
  /** Most entries held at once. Default REPLAY_STORE_DEFAULT_MAX_ENTRIES. */
  maxEntries?: number;
  /** The clock, in milliseconds since the epoch. For tests. */
  now?: () => number;
}

const SWEEP_INTERVAL_MS = 30_000;

/**
 * The replay store a server uses when it is given none.
 *
 * - **Not durable:** a restart forgets every entry, so an artifact accepted
 *   just before a restart can be accepted again while its `issuedAt` is in
 *   the window.
 * - **Not shared:** each server instance has its own, so behind a load
 *   balancer one instance does not see what another accepted.
 * - **Bounded:** an entry goes once its `expiresAt` passes, and at most
 *   `maxEntries` are held. When it is full of unexpired entries it refuses
 *   new ones (BTP_ERROR_RATE_LIMITER) rather than forget a pair early, which
 *   would let that artifact be replayed.
 *
 * A platform with more than one instance, or that must hold across restarts,
 * implements AbstractReplayStore over shared storage.
 */
export class InMemoryReplayStore extends AbstractReplayStore {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private lastSweep: number;

  constructor(options: InMemoryReplayStoreOptions = {}) {
    super({ connection: null, entityName: 'replay' });
    const maxEntries = options.maxEntries ?? REPLAY_STORE_DEFAULT_MAX_ENTRIES;
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: 'maxEntries must be a positive whole number',
        meta: { maxEntries },
      });
    }
    this.maxEntries = maxEntries;
    this.now = options.now ?? Date.now;
    this.lastSweep = this.now();
  }

  /** How many entries are held, expired ones not yet swept included. */
  get size(): number {
    return this.entries.size;
  }

  protected async hasKey(key: string): Promise<boolean> {
    return this.isLive(key, this.now());
  }

  protected async add(entry: BTPReplayEntry): Promise<boolean> {
    const now = this.now();
    if (this.isLive(entry.key, now)) return false;
    if (now - this.lastSweep >= SWEEP_INTERVAL_MS || this.entries.size >= this.maxEntries) {
      this.sweep(now);
    }
    if (this.entries.size >= this.maxEntries) {
      throw new BTPErrorException(BTP_ERROR_RATE_LIMITER, {
        cause: 'replay store is full of unexpired entries',
        meta: { maxEntries: this.maxEntries },
      });
    }
    this.entries.set(entry.key, Date.parse(entry.expiresAt));
    return true;
  }

  protected async deleteKey(key: string): Promise<void> {
    this.entries.delete(key);
  }

  private isLive(key: string, now: number): boolean {
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt < now) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  private sweep(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt < now) this.entries.delete(key);
    }
    this.lastSweep = now;
  }
}
