/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: an agreement's answer, as a device sends it: an agreement_event on
 * event.send, which stamps the artifact 1.2.0. Its envelope says nothing about
 * the agreement; the server checks only that the event is self-consistent.
 */

import { describe, expect, it } from 'vitest';
import { BtpsAgentCommandCallSchema } from '../../../client/libs/schema.js';
import { artifactVersion } from '../constants/index.js';
import { decryptedDocumentProblem } from './helpers.js';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';

const SHA = 'a'.repeat(64);
const agreement = { originator: 'loans$bank.example', id: 'AGR-1', contentSha256: SHA };
const answer = {
  type: 'agreement_event',
  id: '5d6e7f80-9102-4a3b-8c4d-5e6f708192a3',
  occurredAt: '2026-11-02T00:00:00.000Z',
  eventType: 'accepted',
  agreement,
  statement: {
    statement: {
      agreement,
      terms: [],
      signer: 'alice$client.example',
      decision: 'accepted',
      signedAt: '2026-11-02T00:00:00.000Z',
    },
    selector: 'btps1',
    signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  },
};

describe("an agreement's answer, sent by a device", () => {
  it('goes on event.send, naming the copy it answers', () => {
    const sent = BtpsAgentCommandCallSchema.safeParse({
      actionType: 'event.send',
      to: 'loans$bank.example',
      document: answer,
      options: { relatesTo: 'agreement-copy' },
    });
    expect(sent.success).toBe(true);
  });

  it('stamps its artifact 1.2.0 by its document', () => {
    expect(artifactVersion({ type: 'BTPS_EVENT', document: answer })).toBe('1.2.0');
  });
});

describe("an agreement's event and the artifact carrying it", () => {
  const envelope = {
    version: '1.2.0',
    issuedAt: '2026-11-02T00:00:00.000Z',
    id: answer.id,
    type: 'BTPS_EVENT',
    from: 'alice$client.example',
    to: 'loans$bank.example',
    selector: 'btps1',
    relatesTo: 'agreement-copy',
    signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
    encryption: null,
  };

  it('travels under its own id, between its originator and a signer', () => {
    expect(decryptedDocumentProblem(answer, envelope)).toBeUndefined();
    expect(BtpTransporterArtifactSchema.safeParse({ ...envelope, document: answer }).success).toBe(
      true,
    );
  });

  it('is refused, opened or readable, under another id or between two others', () => {
    const elsewhere = { ...envelope, to: 'loans$other.example' };
    expect(decryptedDocumentProblem(answer, { ...envelope, id: 'other' })).toMatch(/id/);
    expect(decryptedDocumentProblem(answer, elsewhere)).toMatch(/originator/);
    expect(BtpTransporterArtifactSchema.safeParse({ ...elsewhere, document: answer }).success).toBe(
      false,
    );
  });
});
