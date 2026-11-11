/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: an agreement, end to end. A bank sends a loan agreement to two
// signers, in turn. Its own platform checks each answer's turn in flight
// (agreementOrderCheck): an answer out of turn is refused, each in turn is
// taken, and the bank tells both it is complete. Either party then builds the
// evidence bundle, which checks offline, from the command line too, and with
// a trusted timestamp on a statement.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  agreementRef,
  signAgreement,
  signStatement,
  statementRecordSha256,
} from '../../src/core/trust/agreements.js';
import {
  buildEvidenceBundle,
  verifyEvidenceBundle,
  type BTPEvidenceBundle,
} from '../../src/core/trust/evidence.js';
import { timestampRequest, timestampTokenOf } from '../../src/core/trust/timestamps.js';
import { agreementOrderCheck } from '../../src/server/libs/agreementOrderCheck.js';
import { BTP_ERROR_AGREEMENT_ORDER } from '../../src/core/error/index.js';
import type { BTPAgreementAnswers, BTPStatementRecord } from '../../src/core/trust/types.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import type { MiddlewareDefinition } from '../../src/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  open,
  recordTrust,
  startProvider,
  type Provider,
  type User,
} from './harness.js';
import { startTimestampAuthority } from './timestampAuthority.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const vectorAgreement = (
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../test/vectors/agreements.vectors.json'), 'utf8'),
  ) as { documents: { name: string; expect: string; document: Record<string, unknown> }[] }
).documents.find((c) => c.name === 'agreement' && c.expect === 'accept')!.document;

describe('journey: an agreement, signed in turn, and its evidence', () => {
  let bankHost: Provider;
  let clientHost: Provider;
  let bank: User;
  let alice: User;
  let sam: User;
  let agreement: Awaited<ReturnType<typeof signAgreement>>;
  const copies = new Map<string, BTPTransporterArtifact>(); // copy id → the copy sent
  const answered: BTPAgreementAnswers['answered'] = [];
  const records: BTPStatementRecord[] = [];

  beforeAll(async () => {
    bankHost = await startProvider('bank.test');
    clientHost = await startProvider('client.test');
    bank = await addUser(bankHost, 'loans');
    alice = await addUser(clientHost, 'alice');
    sam = await addUser(clientHost, 'sam');
    for (const signer of [alice, sam]) {
      // Each signer granted the bank send:agreement; the bank holds its own record too.
      await recordTrust(clientHost.trustStore, bank.identity, signer.identity, 'accepted', {
        permissions: {
          requested: [{ name: 'send:agreement', required: true }],
          granted: ['send:agreement'],
          detailsHeld: [],
          detailsShared: [],
        },
      });
      await recordTrust(bankHost.trustStore, bank.identity, signer.identity, 'accepted');
    }
    const { originatorSignature: _unsigned, ...content } = vectorAgreement;
    agreement = await signAgreement(
      {
        ...content,
        acceptance: {
          ...(content.acceptance as object),
          signers: [{ address: alice.identity }, { address: sam.identity }],
          signingOrder: 'sequential',
          by: new Date(Date.now() + 86_400_000).toISOString(),
        },
      } as Parameters<typeof signAgreement>[0],
      { originator: bank.identity, selector: bank.selector, pemFiles: bank.keys },
    );
    // The bank's platform answers its own middleware from what it sent and took.
    bankHost.use([
      agreementOrderCheck({
        answers: async ({ relatesTo, originator }) =>
          copies.has(relatesTo) && originator === bank.identity
            ? {
                signers: [alice.identity, sam.identity],
                signingOrder: 'sequential',
                answered,
              }
            : undefined,
      }) as MiddlewareDefinition,
    ]);
  });

  afterAll(() => {
    bankHost.stop();
    clientHost.stop();
  });

  const answer = async (signer: User, previous?: string) => {
    const copy = [...copies.values()].find((sent) => sent.to === signer.identity)!;
    const record = await signStatement(
      {
        agreement: agreementRef(agreement, bank.identity),
        terms: (agreement.acceptance as { terms: string[] }).terms,
        signer: signer.identity,
        decision: 'accepted',
        signedAt: new Date().toISOString(),
        ...(previous && { previous }),
        // Each signer's own signature, inside what it signs: typed, or drawn.
        visualSignature:
          signer === alice
            ? { type: 'typed', text: 'Alice Ng' }
            : { type: 'drawn', strokes: [[40, 200, 120, 80, 260, 210, 400, 90]] },
      },
      { selector: signer.selector, pemFiles: signer.keys },
    );
    const id = randomUUID();
    const event = await artifactFrom(
      signer,
      bank.identity,
      'BTPS_EVENT',
      {
        type: 'agreement_event',
        id,
        occurredAt: new Date().toISOString(),
        eventType: 'accepted',
        agreement: agreementRef(agreement, bank.identity),
        statement: record,
      },
      { extra: { id, relatesTo: copy.id } },
    );
    return { record, response: (await deliver(event)).response };
  };

  it('sends each signer its copy, under the send:agreement it granted', async () => {
    for (const signer of [alice, sam]) {
      const copy = await artifactFrom(bank, signer.identity, 'BTPS_DOC', agreement, {
        extra: { documentType: 'agreement' },
      });
      expect((await deliver(copy)).response?.status).toMatchObject({ ok: true, code: 200 });
      copies.set(copy.id, copy);
      // The bank's platform records what it sent, so an answer naming it relates.
      bankHost.trustStore.remember(copy);

      const arrived = clientHost.inbox.find((a) => a.id === copy.id)!;
      const { payload, error } = await open<BTPTransporterArtifact>(signer, arrived);
      expect(error).toBeUndefined();
      expect(payload?.document).toEqual(agreement);
    }
  });

  it('refuses an answer out of turn, in flight, without opening it', async () => {
    const { response } = await answer(sam);

    expect(response?.status).toMatchObject({
      ok: false,
      code: 400,
      error: BTP_ERROR_AGREEMENT_ORDER.code,
    });
  });

  it('takes each answer in its turn, the second naming the first', async () => {
    const first = await answer(alice);
    expect(first.response?.status).toMatchObject({ ok: true, code: 200 });
    records.push(first.record);
    answered.push({
      signer: alice.identity,
      decision: 'accepted',
      sha256: statementRecordSha256(first.record),
    });

    const second = await answer(sam, statementRecordSha256(first.record));
    expect(second.response?.status).toMatchObject({ ok: true, code: 200 });
    records.push(second.record);
    answered.push({
      signer: sam.identity,
      decision: 'accepted',
      sha256: statementRecordSha256(second.record),
    });

    // A signer who has answered is refused a second answer.
    expect((await answer(alice)).response?.status).toMatchObject({
      ok: false,
      error: BTP_ERROR_AGREEMENT_ORDER.code,
    });
  });

  it('tells each signer the agreement is complete, with every statement', async () => {
    for (const signer of [alice, sam]) {
      const id = randomUUID();
      const complete = await artifactFrom(
        bank,
        signer.identity,
        'BTPS_EVENT',
        {
          type: 'agreement_event',
          id,
          occurredAt: new Date().toISOString(),
          eventType: 'agreement_complete',
          agreement: agreementRef(agreement, bank.identity),
          statements: records,
        },
        {
          extra: {
            id,
            relatesTo: [...copies.keys()].find((k) => copies.get(k)?.to === signer.identity),
          },
        },
      );
      clientHost.trustStore.remember(copies.get(complete.relatesTo!)!);
      expect((await deliver(complete)).response?.status).toMatchObject({ ok: true, code: 200 });
    }
  });

  describe('its evidence', () => {
    const keyOf = (identity: string) =>
      [bank, alice, sam].find((user) => user.identity === identity)?.keys.publicKey;
    let bundle: BTPEvidenceBundle;

    beforeAll(() => {
      bundle = buildEvidenceBundle(
        { originator: bank.identity, agreement, statements: records },
        keyOf,
      );
    });

    it('checks offline: the content, the originator, each statement in turn, complete', async () => {
      const facts = await verifyEvidenceBundle(JSON.parse(JSON.stringify(bundle)));

      expect(facts).toMatchObject({
        originatorSignatureValid: true,
        termsAttached: true,
        complete: true,
      });
      for (const statement of facts.statements) {
        expect(statement).toMatchObject({
          signatureValid: true,
          keyKind: 'identity',
          agreementMatches: true,
          termsMatch: true,
          withinDeadline: true,
          inOrder: true,
        });
      }
    });

    it('checks from the command line, exiting 0 when complete, 1 when changed, 2 when it is no bundle', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-evidence-'));
      const write = (name: string, value: unknown) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, JSON.stringify(value));
        return file;
      };
      const changed = { ...bundle, agreement: { ...bundle.agreement, title: 'Another loan' } };
      // The bin as shipped: it imports @btps/sdk/trust, the built package (test:e2e builds it).
      const cli = path.resolve(__dirname, '../../bin/verify-evidence-bundle.mjs');
      const run = (file: string) => {
        const { status, stdout, stderr } = spawnSync(process.execPath, [cli, file], {
          encoding: 'utf8',
        });
        return { status, output: `${stdout}${stderr}` };
      };

      for (const [file, value, status] of [
        ['complete.json', bundle, 0],
        ['changed.json', changed, 1],
        ['nothing.json', { format: 'something-else' }, 2],
      ] as const) {
        const result = run(write(file, value));
        expect(result.status, result.output).toBe(status);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('reports a trusted timestamp on a statement, and leaves complete as it was', async () => {
      const authority = await startTimestampAuthority('Test TSA');
      const [first] = records;
      const request = await timestampRequest(first!);
      expect(request.length).toBeGreaterThan(0);
      const token = await timestampTokenOf(await authority.respond(statementRecordSha256(first!)));
      const stamped = {
        ...bundle,
        timestamps: [{ statementSha256: statementRecordSha256(first!), token }],
      };

      const facts = await verifyEvidenceBundle(stamped, {
        trustedTimestampRoots: [authority.rootPem],
      });

      expect(facts.complete).toBe(true);
      expect(facts.statements[0]?.timestamp).toMatchObject({
        imprintMatches: true,
        signatureValid: true,
        timestampingKeyUsage: true,
        trusted: true,
      });
      expect(facts.statements[1]?.timestamp).toBeUndefined();
    });
  });
});
