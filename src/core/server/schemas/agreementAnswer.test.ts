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
import { generateKeyPairSync } from 'crypto';
import { cosign } from '../../trust/cosignatures.js';
import { BtpsAgentCommandCallSchema } from '../../../client/libs/schema.js';
import { artifactVersion } from '../constants/index.js';
import { decryptedDocumentProblem } from './helpers.js';
import { BtpTransporterArtifactSchema } from './artifacts/transporterSchema.js';

const SHA = 'a'.repeat(64);
const agreement = { originator: 'loans$bank.example', id: 'AGR-1', contentSha256: SHA };
// Since rc.4: its statement is not in it, but outside, as the artifact's cosignature.
const answer = {
  type: 'agreement_event',
  id: '5d6e7f80-9102-4a3b-8c4d-5e6f708192a3',
  occurredAt: '2026-11-02T00:00:00.000Z',
  eventType: 'accepted',
  agreement,
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

  it('carries cosignatures as any sender may, its own or those an originator forwards, on event.send only', async () => {
    const keys = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const cosignatureOf = (signer: string) =>
      cosign({
        statement: {
          agreement,
          terms: [SHA],
          signer,
          artifactId: answer.id,
          decision: 'accepted',
          signedAt: '2026-11-02T00:00:00.000Z',
        },
        recipients: [agreement.originator, signer].map((identity) => ({
          identity,
          publicKey: keys.publicKey,
        })),
        by: { pemFiles: keys },
      });
    const own = await cosignatureOf('alice$client.example');
    const forwarded = [own, await cosignatureOf('sam$client.example')];
    const command = (actionType: string, cosignatures: unknown[]) =>
      BtpsAgentCommandCallSchema.safeParse({
        actionType,
        to: 'loans$bank.example',
        document: answer,
        options: { relatesTo: 'agreement-copy', cosignatures },
      }).success;

    expect(command('event.send', [own])).toBe(true);
    expect(command('event.send', forwarded)).toBe(true);
    expect(command('artifact.send', [own])).toBe(false);
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
