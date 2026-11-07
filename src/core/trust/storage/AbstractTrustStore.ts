/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AbstractStorageStore } from '@core/storage/AbstractStorageStore.js';
import { BTPAgreementRef, BTPAgreementState, BTPEventFacts, BTPTrustRecord } from '../types.js';
import type { BTPDetailsEnvelope } from '../permissions.js';

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

  /**
   * Optional, since 1.2: the envelope of the artifact with this id that passed
   * between these two identities, in either direction, as the platform
   * recorded it, or undefined when it holds none. With it, a server checks
   * that a `DETAILS_RES` answers a `DETAILS_REQ` its receiver sent to that
   * sender, naming only what it asked for; without it, the server checks only
   * that the request is known (`isKnownArtifact`), and the names are the
   * platform's to check (`detailsProblem`).
   */
  getArtifact?(query: {
    artifactId: string;
    from: string;
    to: string;
  }): Promise<BTPDetailsEnvelope | undefined>;

  /**
   * Optional, since 1.2: what the platform holds of an agreement it
   * originated, or undefined when it holds none: its signers in order, how
   * they answer, and the answers it has taken. The platform records each answer
   * it takes; the server only reads. With it, a server refuses an answer whose
   * envelope does not follow the agreement's signers and order; without it,
   * that is the platform's to check once opened (`agreementStatementProblem`).
   */
  getAgreement?(query: BTPAgreementRef): Promise<BTPAgreementState | undefined>;
}
