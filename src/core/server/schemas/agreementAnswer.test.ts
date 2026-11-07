/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: an agreement's answer, as a device sends it. The answer is an
 * agreement_event on event.send, and its agreement facts go on the envelope,
 * on event.send only. Either stamps the artifact 1.2.0.
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
const facts = { id: 'AGR-1', contentSha256: SHA };
const call = (actionType: string, document: object, options: object) =>
  BtpsAgentCommandCallSchema.safeParse({
    actionType,
    to: 'loans$bank.example',
    document,
    options,
  }).success;

describe("an agreement's answer, sent by a device", () => {
  it('goes on event.send with its agreement facts', () => {
    expect(call('event.send', answer, { relatesTo: 'agreement-copy', agreement: facts })).toBe(
      true,
    );
  });

  it('refuses agreement facts on any other action', () => {
    expect(call('artifact.send', answer, { agreement: facts })).toBe(false);
  });

  it('refuses agreement facts that are not hashes', () => {
    const short = { ...facts, contentSha256: 'abc' };
    expect(call('event.send', answer, { relatesTo: 'agreement-copy', agreement: short })).toBe(
      false,
    );
  });

  it('stamps its artifact 1.2.0, by the answer or by its facts', () => {
    expect(artifactVersion({ type: 'BTPS_EVENT', document: answer })).toBe('1.2.0');
    expect(artifactVersion({ type: 'BTPS_EVENT', document: 'ciphertext', agreement: facts })).toBe(
      '1.2.0',
    );
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
    agreement: facts,
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
