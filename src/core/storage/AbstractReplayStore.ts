/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { createHash } from 'crypto';
import { BTPReplayEntry, StorageStoreOptions } from './types.js';

/**
 * The key a replay store holds `(from, id)` under: SHA-256 over the pair,
 * with `from` lower-cased as trust ids are, and `id` exactly as sent. It is
 * per sender identity (or agent id), so two senders may use the same id.
 */
export function computeReplayKey(from: string, id: string): string {
  return createHash('sha256')
    .update(JSON.stringify([from.toLowerCase(), id]))
    .digest('hex');
}

/**
 * Where a server remembers the `(from, id)` of every artifact it accepted,
 * until the artifact's `issuedAt` has left the window (BTPS 1.1 replay
 * protection). After that the window refuses the artifact on its own, so the
 * entry may go.
 *
 * The SDK ships `InMemoryReplayStore`. It does not survive a restart and is
 * not shared between server instances: a platform that runs more than one
 * instance, or must refuse a replay across a restart, implements this class
 * over shared storage (Postgres, Redis, ...).
 *
 * An implementation provides three operations on a key from
 * `computeReplayKey`. `add` must be atomic: of two concurrent adds of one
 * key, exactly one returns true (an `INSERT ... ON CONFLICT DO NOTHING`, or
 * Redis `SET key 1 NX PX ttl`). An entry whose `expiresAt` has passed counts
 * as absent.
 */
export abstract class AbstractReplayStore {
  protected connection: unknown;
  protected entityName?: string;

  constructor({ connection, entityName }: StorageStoreOptions) {
    this.connection = connection;
    this.entityName = entityName;
  }

  /** True when an unexpired entry holds `key`. */
  protected abstract hasKey(key: string): Promise<boolean>;
  /** Adds the entry unless an unexpired one holds its key. True when added. */
  protected abstract add(entry: BTPReplayEntry): Promise<boolean>;
  /** Removes the entry for `key`, if any. */
  protected abstract deleteKey(key: string): Promise<void>;

  /** Whether `(from, id)` was accepted before and is still remembered. */
  async seen(from: string, id: string): Promise<boolean> {
    return this.hasKey(computeReplayKey(from, id));
  }

  /**
   * Remembers `(from, id)` until `expiresAt`. False when it is already
   * remembered: the artifact is a duplicate.
   */
  async remember(from: string, id: string, expiresAt: Date): Promise<boolean> {
    return this.add({
      key: computeReplayKey(from, id),
      from: from.toLowerCase(),
      id,
      expiresAt: expiresAt.toISOString(),
    });
  }

  /**
   * Forgets `(from, id)`. The server calls it only when the artifact it had
   * just remembered could not be handed to the application, so the sender
   * may resend it.
   */
  async forget(from: string, id: string): Promise<void> {
    return this.deleteKey(computeReplayKey(from, id));
  }
}
