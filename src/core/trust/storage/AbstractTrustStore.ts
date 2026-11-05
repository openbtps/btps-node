/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AbstractStorageStore } from '@core/storage/AbstractStorageStore.js';
import { BTPEventFacts, BTPTrustRecord } from '../types.js';

export abstract class AbstractTrustStore<T extends BTPTrustRecord> extends AbstractStorageStore<T> {
  abstract getAll(receiverId?: string): Promise<T[]>;

  /**
   * Whether an artifact with this id passed between these two identities, in
   * either direction, as the platform recorded it. Every `BTPS_EVENT` names
   * the artifact that delivered its invoice (`relatesTo`) and is refused
   * unless this answers true, so a sender cannot send events about invoices
   * that were never exchanged.
   */
  abstract isKnownArtifact(query: {
    artifactId: string;
    from: string;
    to: string;
  }): Promise<boolean>;

  /**
   * Optional, since 1.2: what the platform holds of the lifecycle event with
   * this id between these two identities, in either direction, or undefined
   * when it holds none, with the invoice that event is about. With it, a
   * server checks that a `withdrawn` takes back the payer's own open proposal
   * about the same invoice, and that a proposal's `follows` names a
   * `withdrawn` about it; without it, those are the platform's to check.
   */
  getEvent?(query: { id: string; from: string; to: string }): Promise<BTPEventFacts | undefined>;
}
