/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 item A (EBA-440): the lifecycle event, carried as BTPS_EVENT.
 * Release plan page 10518529, sections 2.3 (the event) and 2.7 (ids and the
 * reply chain). The golden vectors in test/vectors/events/ are the fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { BtpEventDocSchema } from './eventSchema.js';
import { BtpDocV2Schema } from './documentSchema.js';
import {
  parseBtpEventDoc,
  validateBtpEventEnvelope,
  validateBtpEventReply,
  processBtpDocSchema,
  processBtpDocSchemaForAgent,
} from '../helpers.js';
import { BtpTransporterArtifactSchema } from '../artifacts/transporterSchema.js';
import { BtpAgentCreateSchema } from '../schema.js';
import {
  BTP_EVENT_TYPES,
  BTP_EVENT_TYPES_REPLYING,
  BTP_EVENT_TYPES_STARTING_A_CHAIN,
} from '../../constants/documents.js';
import {
  AGENT_ACTIONS,
  AGENT_ACTIONS_REQUIRING_DOCUMENT,
  TRANSPORTER_ACTIONS,
} from '../../constants/index.js';
import type { BTPEventDoc } from '../../types.js';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const EVENTS = new URL('../../../../../test/vectors/events/', import.meta.url);
const DOCUMENTS = new URL('../../../../../test/vectors/documents/', import.meta.url);
const load = (name: string, dir = EVENTS): Doc =>
  JSON.parse(readFileSync(new URL(name, dir), 'utf8'));

const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';
const OTHER = 'carol$other.example';
const SOME_ID = 'aec6b697-52b5-409e-a576-12773f7a40b9';

const accepts = (doc: Doc) => {
  const result = BtpEventDocSchema.safeParse(doc);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return true;
};
const refuses = (doc: Doc) => BtpEventDocSchema.safeParse(doc).success === false;

/** An unencrypted BTPS_EVENT around `document`, as the server's envelope schema sees it. */
const envelope = (document: unknown, overrides: Doc = {}) => ({
  version: '1.1.0',
  issuedAt: '2026-10-20T09:00:01.000Z',
  id: (document as Doc)?.id ?? 'not-an-event',
  type: 'BTPS_EVENT',
  from: PAYER,
  to: BILLER,
  signature: { algorithmHash: 'sha256', value: 'v', fingerprint: 'f' },
  encryption: null,
  signatureSelector: 'btps1',
  document,
  ...overrides,
});

describe('item A: the lifecycle event (BtpEventDocSchema)', () => {
  it('has a vector for every event type, and every vector validates', () => {
    const names = readdirSync(EVENTS).filter((n) => n.endsWith('.json'));
    const types = new Set(names.map((n) => load(n).eventType));
    expect([...types].sort()).toEqual([...BTP_EVENT_TYPES].sort());
    for (const name of names) expect(accepts(load(name))).toBe(true);
  });

  it('names exactly the event types of section 2.3, and none it replaced', () => {
    expect(BTP_EVENT_TYPES).toEqual([
      'paid',
      'partially_paid',
      'disputed',
      'refund_requested',
      'refund',
      'response',
    ]);
    for (const replaced of ['refunded', 'dispute_resolved', 'status_change']) {
      expect(refuses({ ...load('paid.by-payer.json'), eventType: replaced })).toBe(true);
    }
  });

  describe('inReplyTo per the section 2.7 table', () => {
    const vectorFor = (eventType: string) =>
      readdirSync(EVENTS)
        .map((n) => load(n))
        .find((e) => e.eventType === eventType)!;

    it.each([...BTP_EVENT_TYPES_STARTING_A_CHAIN])(
      '%s starts a chain: inReplyTo is refused',
      (t) => {
        const event = vectorFor(t);
        expect(event.inReplyTo).toBeUndefined();
        expect(accepts(event)).toBe(true);
        const result = BtpEventDocSchema.safeParse({ ...event, inReplyTo: SOME_ID });
        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error?.issues)).toContain('they start a chain');
      },
    );

    it.each([...BTP_EVENT_TYPES_REPLYING])('%s is a reply: inReplyTo is required', (t) => {
      const { inReplyTo, ...event } = vectorFor(t);
      expect(inReplyTo).toBeDefined();
      expect(refuses(event)).toBe(true);
      expect(refuses({ ...event, inReplyTo: 'evt-1' })).toBe(true);
    });

    it('the two lists cover every event type once', () => {
      expect([...BTP_EVENT_TYPES_STARTING_A_CHAIN, ...BTP_EVENT_TYPES_REPLYING].sort()).toEqual(
        [...BTP_EVENT_TYPES].sort(),
      );
    });
  });

  describe('per-type fields', () => {
    it('amount is required for partially_paid and refund, more than zero, in integer minor units', () => {
      for (const name of ['partially-paid.json', 'refund.json']) {
        const { amount, ...event } = load(name);
        expect(amount).toBeDefined();
        expect(refuses(event)).toBe(true);
        expect(refuses({ ...event, amount: { amount: 0, currency: 'AUD' } })).toBe(true);
        expect(refuses({ ...event, amount: { amount: -1, currency: 'AUD' } })).toBe(true);
        expect(refuses({ ...event, amount: { amount: 10.5, currency: 'AUD' } })).toBe(true);
        expect(refuses({ ...event, amount: { amount: 100, currency: 'XXX' } })).toBe(true);
      }
    });

    it('amount is refused where the table does not name it', () => {
      const amount = { amount: 100, currency: 'AUD' };
      for (const name of ['paid.by-payer.json', 'disputed.json', 'refund-requested.json']) {
        expect(refuses({ ...load(name), amount })).toBe(true);
      }
      expect(refuses({ ...load('response.accepts-paid.json'), amount })).toBe(true);
    });

    it('reason is required for disputed: an open, namespaced code', () => {
      const { reason, ...event } = load('disputed.json');
      expect(reason).toBe('amount_wrong');
      expect(refuses(event)).toBe(true);
      for (const code of ['rejected', 'amount_wrong', 'not_as_agreed', 'au:late_delivery']) {
        expect(accepts({ ...event, reason: code })).toBe(true);
      }
      expect(refuses({ ...event, reason: 'the amount is wrong' })).toBe(true);
      expect(refuses({ ...load('paid.by-payer.json'), reason: 'rejected' })).toBe(true);
    });

    it('decision is required for response, and only allowed there', () => {
      const { decision, ...response } = load('response.accepts-paid.json');
      expect(decision).toBe('accepted');
      expect(refuses(response)).toBe(true);
      expect(accepts({ ...response, decision: 'rejected' })).toBe(true);
      expect(refuses({ ...response, decision: 'maybe' })).toBe(true);
      expect(refuses({ ...load('paid.by-payer.json'), decision: 'accepted' })).toBe(true);
      expect(refuses({ ...load('refund.json'), decision: 'accepted' })).toBe(true);
    });

    it('remainingDueDate is allowed only on an accepted response', () => {
      expect(accepts(load('response.accepts-partial.json'))).toBe(true);
      const dueDate = { remainingDueDate: '2026-11-30T00:00:00.000Z' };
      expect(refuses({ ...load('response.rejects-dispute.json'), ...dueDate })).toBe(true);
      expect(refuses({ ...load('partially-paid.json'), ...dueDate })).toBe(true);
      expect(
        refuses({ ...load('response.accepts-partial.json'), remainingDueDate: '30/11/2026' }),
      ).toBe(true);
    });

    it('note is optional short text on every type', () => {
      expect(accepts({ ...load('refund.json'), note: 'Refunded to the card ending 4242' })).toBe(
        true,
      );
      expect(refuses({ ...load('refund.json'), note: 7 })).toBe(true);
    });
  });

  describe('the common fields', () => {
    const paid = () => load('paid.by-payer.json');

    it('id and inReplyTo are random UUIDs, never a computed or free-form id', () => {
      expect(refuses({ ...paid(), id: 'evt_2001' })).toBe(true);
      expect(refuses({ ...paid(), id: `sha256:${'a'.repeat(64)}` })).toBe(true);
    });

    it('is strict: an unnamed field, a status and a v1 or foreign shape are refused', () => {
      expect(refuses({ ...paid(), paidVia: 'bank' })).toBe(true);
      expect(refuses({ ...paid(), status: 'paid' })).toBe(true);
      expect(refuses({ ...paid(), schemaVersion: 1 })).toBe(true);
      expect(refuses({ ...paid(), type: 'invoice' })).toBe(true);
      expect(refuses({ ...paid(), occurredAt: 'yesterday' })).toBe(true);
    });

    it('names its document by { from, id, sha256 }, strictly', () => {
      const { document } = paid();
      expect(refuses({ ...paid(), document: { from: document.from, id: document.id } })).toBe(true);
      expect(refuses({ ...paid(), document: { ...document, from: 'not-an-identity' } })).toBe(true);
      expect(refuses({ ...paid(), document: { ...document, extra: 1 } })).toBe(true);
    });

    it('writes the document sha256 as every v2 sha256: lowercase hex, 64 characters', () => {
      const { document } = paid();
      const hex = 'a'.repeat(64);
      expect(refuses({ ...paid(), document: { ...document, sha256: hex } })).toBe(false);
      for (const sha256 of [hex.toUpperCase(), Buffer.from(hex, 'hex').toString('base64')]) {
        expect(refuses({ ...paid(), document: { ...document, sha256 } }), sha256).toBe(true);
      }
    });
  });

  it('parseBtpEventDoc returns a frozen copy, and BTP_ERROR_DOC_SCHEMA with issues on refusal', () => {
    const input = load('refund.json');
    const { data, error } = parseBtpEventDoc(input);
    expect(error).toBeUndefined();
    expect(data).toEqual(input);
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);

    const refused = parseBtpEventDoc({ ...input, inReplyTo: undefined });
    expect(refused.error?.code).toBe('BTP_ERROR_DOC_SCHEMA');
    expect(refused.error?.meta).toMatchObject({ issues: [{ path: 'inReplyTo' }] });
  });
});

describe('item A: the envelope rules (validateBtpEventEnvelope)', () => {
  const event = () => load('paid.by-payer.json') as BTPEventDoc;

  it('the payer writes back about the biller’s document; the biller answers about its own', () => {
    expect(validateBtpEventEnvelope(event(), { id: event().id, from: PAYER, to: BILLER })).toBe(
      undefined,
    );
    const answer = load('response.accepts-paid.json') as BTPEventDoc;
    expect(validateBtpEventEnvelope(answer, { id: answer.id, from: BILLER, to: PAYER })).toBe(
      undefined,
    );
  });

  it('refuses an event whose id differs from the artifact id', () => {
    expect(
      validateBtpEventEnvelope(event(), { id: SOME_ID, from: PAYER, to: BILLER }),
    ).toMatchObject({ path: ['id'] });
  });

  it('refuses an event about a document from someone else', () => {
    const e = { ...event(), document: { ...event().document, from: OTHER } } as BTPEventDoc;
    expect(validateBtpEventEnvelope(e, { id: e.id, from: PAYER, to: BILLER })).toMatchObject({
      path: ['document', 'from'],
    });
    // A third party sending about a document between two others.
    expect(
      validateBtpEventEnvelope(event(), { id: event().id, from: OTHER, to: PAYER }),
    ).toMatchObject({ path: ['document', 'from'] });
  });
});

describe('item A: the reply chain (validateBtpEventReply, the platform’s check)', () => {
  const sent = (name: string, from: string, to: string, set: Doc = {}) => ({
    event: { ...load(name), ...set } as BTPEventDoc,
    from,
    to,
  });
  const paid = sent('paid.by-payer.json', PAYER, BILLER);

  it('accepts each reply of the section 2.7 table', () => {
    const pairs = [
      [paid, sent('response.accepts-paid.json', BILLER, PAYER)],
      [
        sent('partially-paid.json', PAYER, BILLER),
        sent('response.accepts-partial.json', BILLER, PAYER),
      ],
      [sent('disputed.json', PAYER, BILLER), sent('response.rejects-dispute.json', BILLER, PAYER)],
      [sent('refund-requested.json', PAYER, BILLER), sent('refund.json', BILLER, PAYER)],
      [
        sent('refund.json', BILLER, PAYER),
        sent('response.acknowledges-refund.json', PAYER, BILLER),
      ],
    ] as const;
    for (const [answered, reply] of pairs)
      expect(validateBtpEventReply(reply, answered)).toBe(undefined);
  });

  it('refuses a reply naming another event, about another document, or from the wrong party', () => {
    const reply = sent('response.accepts-paid.json', BILLER, PAYER);
    expect(validateBtpEventReply(reply, sent('disputed.json', PAYER, BILLER))).toBeDefined();
    expect(
      validateBtpEventReply(
        sent('response.accepts-paid.json', BILLER, PAYER, {
          document: { ...paid.event.document, id: 'inv_2002' },
        }),
        paid,
      ),
    ).toMatchObject({ path: ['document'] });
    expect(
      validateBtpEventReply(sent('response.accepts-paid.json', PAYER, BILLER), paid),
    ).toBeDefined();
    expect(
      validateBtpEventReply(sent('response.accepts-paid.json', BILLER, OTHER), paid),
    ).toBeDefined();
  });

  it('refuses what the table does not allow to be answered', () => {
    const billerPaid = sent('paid.by-biller.json', BILLER, PAYER);
    expect(
      validateBtpEventReply(
        sent('response.accepts-paid.json', PAYER, BILLER, { inReplyTo: billerPaid.event.id }),
        billerPaid,
      ),
    ).toMatchObject({ message: expect.stringContaining('final') });
    expect(
      validateBtpEventReply(sent('refund.json', BILLER, PAYER, { inReplyTo: paid.event.id }), paid),
    ).toBeDefined();
    const response = sent('response.accepts-paid.json', BILLER, PAYER);
    expect(
      validateBtpEventReply(
        sent('response.acknowledges-refund.json', PAYER, BILLER, { inReplyTo: response.event.id }),
        response,
      ),
    ).toBeDefined();
    expect(validateBtpEventReply(paid, response)).toMatchObject({ path: ['inReplyTo'] });
  });
});

describe('item A: BTPS_EVENT on the wire (transporter schema)', () => {
  it('is a transporter type, validated by the event schema', () => {
    expect(TRANSPORTER_ACTIONS).toContain('BTPS_EVENT');
    expect(processBtpDocSchema('BTPS_EVENT')).toBe(BtpEventDocSchema);
    const event = load('paid.by-payer.json');
    expect(BtpTransporterArtifactSchema.safeParse(envelope(event)).success).toBe(true);
  });

  it('refuses an event whose id differs from the artifact id', () => {
    const event = load('paid.by-payer.json');
    const result = BtpTransporterArtifactSchema.safeParse(envelope(event, { id: SOME_ID }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['document', 'id']);
  });

  it('refuses an event about a document from someone else, and a third party’s event', () => {
    const event = load('paid.by-payer.json');
    const foreign = { ...event, document: { ...event.document, from: OTHER } };
    expect(BtpTransporterArtifactSchema.safeParse(envelope(foreign)).success).toBe(false);
    const third = BtpTransporterArtifactSchema.safeParse(
      envelope(event, { from: OTHER, to: PAYER }),
    );
    expect(third.success).toBe(false);
    expect(third.error?.issues[0]?.path).toEqual(['document', 'document', 'from']);
  });

  it('refuses inReplyTo where the table forbids it, and its absence where it is required', () => {
    const paid = load('paid.by-payer.json');
    expect(
      BtpTransporterArtifactSchema.safeParse(envelope({ ...paid, inReplyTo: SOME_ID })).success,
    ).toBe(false);
    const { inReplyTo: _unused, ...response } = load('response.accepts-paid.json');
    expect(
      BtpTransporterArtifactSchema.safeParse(envelope(response, { from: BILLER, to: PAYER }))
        .success,
    ).toBe(false);
  });

  it('a BTPS_DOC carrying an event is refused, and a BTPS_EVENT carrying a document', () => {
    const event = load('paid.by-payer.json');
    expect(BtpDocV2Schema.safeParse(event).success).toBe(false);
    expect(
      BtpTransporterArtifactSchema.safeParse(envelope(event, { type: 'BTPS_DOC' })).success,
    ).toBe(false);
    const invoice = load('invoice.v2.json', DOCUMENTS);
    expect(
      BtpTransporterArtifactSchema.safeParse(
        envelope(invoice, { type: 'BTPS_EVENT', from: BILLER, to: PAYER }),
      ).success,
    ).toBe(false);
  });

  it('an encrypted event is an opaque string, as for BTPS_DOC', () => {
    const encrypted = envelope('ciphertext', {
      id: SOME_ID,
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'k',
        iv: 'i',
        type: 'standardEncrypt',
        authTag: 't',
      },
      encryptionSelector: 'btps1',
    });
    expect(BtpTransporterArtifactSchema.safeParse(encrypted).success).toBe(true);
    expect(
      BtpTransporterArtifactSchema.safeParse({ ...encrypted, document: load('paid.by-payer.json') })
        .success,
    ).toBe(false);
  });
});

describe('item A: the agent action event.send', () => {
  it('is an agent action that requires a document, validated as an event', () => {
    expect(AGENT_ACTIONS).toContain('event.send');
    expect(AGENT_ACTIONS_REQUIRING_DOCUMENT).toContain('event.send');
    expect(processBtpDocSchemaForAgent('event.send')).toBe(BtpEventDocSchema);
  });

  it('a draft can hold an event', () => {
    expect(
      BtpAgentCreateSchema.safeParse({ type: 'BTPS_EVENT', document: load('refund.json') }).success,
    ).toBe(true);
  });
});
