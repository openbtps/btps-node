/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: what 1.2 adds between two providers, over real servers. A payer
// takes back a proposal, checked in flight by the biller's own middleware; a
// document with a BoundView, a signatory, a formatted note and a discount
// arrives intact, its BoundView checked where it is opened; a
// provider puts a cache in front of every key lookup; details are asked for
// within the provider's limit and answered with only what was asked; and a
// trust request carries a verification its receiver can check.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createHash, randomUUID } from 'crypto';
import { canonicalizeValue } from '../../src/core/crypto/jcs.js';
import {
  createDefaultKeyResolver,
  type BtpsKeyResolver,
} from '../../src/core/crypto/keyResolver.js';
import { signVerification, verificationFacts } from '../../src/core/trust/verification.js';
import { eventChainCheck } from '../../src/server/libs/eventChainCheck.js';
import { detailsRequestLimit } from '../../src/server/libs/detailsRequestLimit.js';
import { detailsResponseCheck } from '../../src/server/libs/detailsResponseCheck.js';
import { computeTrustId } from '../../src/core/trust/index.js';
import {
  BTP_ERROR_DETAILS_RATE_LIMITED,
  BTP_ERROR_EVENT_CHAIN,
  BTP_ERROR_PERMISSION,
} from '../../src/core/error/index.js';
import type { BTPDetailPermission, BTPTransporterArtifact } from '../../src/core/server/types.js';
import type { BTPEventFacts } from '../../src/core/trust/types.js';
import type { MiddlewareDefinition } from '../../src/server/types.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  letterDocument,
  open,
  recordTrust,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const reference = (invoice: BTPTransporterArtifact, issuer: string) => ({
  from: issuer,
  id: invoice.id,
  sha256: createHash('sha256').update(canonicalizeValue(invoice)).digest('hex'),
});

describe('journey: what 1.2 adds between two providers', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let client: User;
  const verifyLookups: string[] = [];

  beforeAll(async () => {
    // The vendor's provider caches the keys it checks signatures with.
    const lookup = createDefaultKeyResolver();
    const cached = new Map<string, Promise<string | undefined>>();
    const keyResolver: BtpsKeyResolver = {
      resolvePublicKey(identity, selector, use) {
        const key = `${identity}|${selector}|${use}`;
        if (!cached.has(key)) {
          if (use === 'verify') verifyLookups.push(identity);
          cached.set(key, lookup.resolvePublicKey(identity, selector, use));
        }
        return cached.get(key)!;
      },
    };
    vendorHost = await startProvider('vendor.test', { server: { keyResolver } });
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    // A 1.1 trust both ways, taking unencrypted events too, so the chain can be read in flight.
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted', {
      privacyType: 'mixed',
    });
    await recordTrust(vendorHost.trustStore, vendor.identity, client.identity, 'accepted', {
      privacyType: 'mixed',
    });
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
  });

  describe("an event's chain, checked by the receiving platform in flight", () => {
    /** What the vendor's platform holds of an event, read from what arrived. */
    const getEvent = async ({ id }: { id: string }): Promise<BTPEventFacts | undefined> => {
      const arrived = vendorHost.inbox.find((a) => a.id === id);
      const event = arrived?.document as
        | { eventType: string; document: { from: string; id: string } }
        | undefined;
      if (!arrived || !event) return undefined;
      const answered = vendorHost.inbox.some(
        (a) => (a.document as { inReplyTo?: string } | undefined)?.inReplyTo === id,
      );
      return {
        eventType: event.eventType,
        from: arrived.from,
        document: { from: event.document.from, id: event.document.id },
        state: answered ? 'answered' : 'open',
      };
    };

    const event = (from: User, to: string, invoice: BTPTransporterArtifact, body: object) => {
      const id = randomUUID();
      return artifactFrom(
        from,
        to,
        'BTPS_EVENT',
        {
          type: 'lifecycle_event',
          id,
          occurredAt: new Date().toISOString(),
          document: reference(invoice, vendor.identity),
          ...body,
        },
        { encrypt: false, extra: { id, relatesTo: invoice.id } },
      );
    };

    it("takes a payer's withdrawal of its own open proposal, and refuses one from the biller", async () => {
      vendorHost.use([eventChainCheck({ getEvent }) as MiddlewareDefinition]);
      clientHost.use([eventChainCheck() as MiddlewareDefinition]);
      try {
        const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());
        expect((await deliver(invoice)).response?.status.ok).toBe(true);
        // Each platform records the invoice it sent or received.
        vendorHost.trustStore.remember(invoice);

        const disputed = await event(client, vendor.identity, invoice, {
          eventType: 'disputed',
          reason: 'amount_wrong',
        });
        expect((await deliver(disputed)).response?.status.ok).toBe(true);

        const withdrawn = await event(client, vendor.identity, invoice, {
          eventType: 'withdrawn',
          inReplyTo: disputed.id,
        });
        expect((await deliver(withdrawn)).response?.status).toMatchObject({ ok: true, code: 200 });

        const unknown = await event(client, vendor.identity, invoice, {
          eventType: 'withdrawn',
          inReplyTo: randomUUID(),
        });
        expect((await deliver(unknown)).response?.status).toMatchObject({
          ok: false,
          error: BTP_ERROR_EVENT_CHAIN.code,
        });

        const fromBiller = await event(vendor, client.identity, invoice, {
          eventType: 'withdrawn',
          inReplyTo: disputed.id,
        });
        expect((await deliver(fromBiller)).response?.status).toMatchObject({
          ok: false,
          error: BTP_ERROR_EVENT_CHAIN.code,
          message: expect.stringContaining('only the payer'),
        });
      } finally {
        vendorHost.use([]);
        clientHost.use([]);
      }
    });
  });

  it('carries a BoundView, a signatory, a formatted note and a discount, intact', async () => {
    // Every printable ASCII character, 500 units wide: 6 pixels at size 12.
    const font = {
      unitsPerEm: 1000,
      ascent: 800,
      descent: 200,
      glyphs: Object.fromEntries(
        Array.from({ length: 95 }, (_, i) => [String.fromCharCode(32 + i), { advance: 500 }]),
      ),
    };
    let row = 0;
    const fact = (field: string, format?: object) => ({
      type: 'text',
      bind: { field, ...(format && { format }) },
      x: 20,
      y: 30 + 24 * row++,
      width: 400,
      align: 'start',
      font: 'body',
      size: 12,
      colour: '#0f1b2d',
    });
    const money = { money: { group: ',', decimal: '.', prefix: 'A$' } };
    const boundView = {
      format: 1,
      page: { width: 600, height: 400 },
      fonts: { body: font },
      elements: [
        fact('id'),
        fact('issuedAt', { date: 'd MMM yyyy' }),
        fact('totalAmount', money),
        fact('discount.amount', money),
        fact('description'),
        fact('lineItems.rows.0.Item'),
        fact('lineItems.rows.0.Amount', money),
      ],
    };
    const invoice = invoiceDocument({
      description: { format: 'markdown', content: '**Thanks** for your business' },
      discount: { amount: 500 },
      lineItems: {
        columns: ['Item', 'Amount'],
        roles: { Item: 'description', Amount: 'lineTotal' },
        rows: [{ Item: 'Website build', Amount: 150000 }],
      },
      boundView,
    });
    // The same BoundView with a white panel drawn over every fact: accepted, never shown.
    const covered = {
      ...invoice,
      boundView: {
        ...boundView,
        elements: [
          ...boundView.elements,
          { type: 'rect', x: 0, y: 0, width: 600, height: 400, fill: '#ffffff' },
        ],
      },
    };
    const letter = letterDocument({
      signatory: { name: 'Jo Bloggs', visualSignature: { type: 'typed', text: 'Jo Bloggs' } },
    });
    const expected = [
      [invoice, { show: true }],
      [covered, { show: false }],
      [letter, undefined],
    ] as const;
    for (const [document, shown] of expected) {
      const sent = await artifactFrom(vendor, client.identity, 'BTPS_DOC', document);
      expect(sent.version).toBe('1.2.0');
      expect((await deliver(sent)).response?.status.ok).toBe(true);

      const arrived = clientHost.inbox.find((a) => a.id === sent.id)!;
      const { payload, error, boundView: result } = await open<BTPTransporterArtifact>(
        client,
        arrived,
      );
      expect(error).toBeUndefined();
      expect(payload?.document).toEqual(document);
      expect(result === undefined ? undefined : { show: result.show }).toEqual(shown);
    }
  });

  it("looks a sender's key up once, then answers from its cache", async () => {
    for (let i = 0; i < 3; i++) {
      const invoice = await artifactFrom(vendor, client.identity, 'BTPS_DOC', invoiceDocument());
      vendorHost.trustStore.remember(invoice);
      const paid = await artifactFrom(
        client,
        vendor.identity,
        'BTPS_EVENT',
        {
          type: 'lifecycle_event',
          id: randomUUID(),
          occurredAt: new Date().toISOString(),
          document: reference(invoice, vendor.identity),
          eventType: 'paid',
        },
        { extra: { relatesTo: invoice.id } },
      );
      expect((await deliver(paid)).response?.status.ok).toBe(true);
    }

    // Every event the client sent on this journey was checked with one lookup of its key.
    expect(verifyLookups.filter((identity) => identity === client.identity)).toHaveLength(1);
  });

  describe('details, within the provider limit and as asked', () => {
    // The vendor holds the client's email and address; the client shares them.
    const shared = ['detail:email', 'detail:address'] as const;
    const permissions = (
      held: readonly BTPDetailPermission[],
      sharedNames: readonly BTPDetailPermission[],
    ) => ({
      requested: [],
      granted: [],
      detailsHeld: [...held],
      detailsShared: [...sharedNames],
    });

    it('asks within the limit, then is told when to ask again', async () => {
      const asker = await addUser(vendorHost, 'asker');
      const answerer = await addUser(clientHost, 'answerer');
      await recordTrust(clientHost.trustStore, asker.identity, answerer.identity, 'accepted', {
        permissions: permissions([], shared),
      });
      let asked = 0;
      clientHost.use([
        detailsRequestLimit(() =>
          ++asked <= 1 ? true : { retryAfter: 60 },
        ) as MiddlewareDefinition,
      ]);
      try {
        const ask = () =>
          artifactFrom(
            asker,
            answerer.identity,
            'DETAILS_REQ',
            {},
            { extra: { details: ['detail:email'] } },
          );

        expect((await deliver(await ask())).response?.status).toMatchObject({
          ok: true,
          code: 200,
        });
        expect((await deliver(await ask())).response?.status).toEqual(
          expect.objectContaining({
            ok: false,
            code: 429,
            error: BTP_ERROR_DETAILS_RATE_LIMITED.code,
            retryAfter: 60,
          }),
        );
      } finally {
        clientHost.use([]);
      }
    });

    it('takes an answer naming only what was asked, and refuses one naming more', async () => {
      const asker = await addUser(vendorHost, 'asker2');
      const answerer = await addUser(clientHost, 'answerer2');
      await recordTrust(vendorHost.trustStore, asker.identity, answerer.identity, 'accepted', {
        permissions: permissions(shared, []),
      });
      await recordTrust(clientHost.trustStore, asker.identity, answerer.identity, 'accepted', {
        permissions: permissions([], shared),
      });
      vendorHost.use([
        detailsResponseCheck({
          getArtifact: (query) => vendorHost.trustStore.getArtifact(query),
        }) as MiddlewareDefinition,
      ]);
      try {
        const request = await artifactFrom(
          asker,
          answerer.identity,
          'DETAILS_REQ',
          {},
          {
            extra: { details: ['detail:email'] },
          },
        );
        expect((await deliver(request)).response?.status.ok).toBe(true);
        // The asker's platform records the request it sent.
        vendorHost.trustStore.remember(request);
        const answer = (values: Record<string, string>) =>
          artifactFrom(answerer, asker.identity, 'DETAILS_RES', values, {
            extra: { details: Object.keys(values), relatesTo: request.id },
          });

        expect(
          (await deliver(await answer({ 'detail:email': 'bob@client.example' }))).response?.status,
        ).toMatchObject({ ok: true, code: 200 });
        expect(
          (
            await deliver(
              await answer({
                'detail:email': 'bob@client.example',
                'detail:address': '2 Rimu Road, Auckland',
              }),
            )
          ).response?.status,
        ).toMatchObject({
          ok: false,
          error: BTP_ERROR_PERMISSION.code,
          message: expect.stringContaining('detail:address was not asked for'),
        });
      } finally {
        vendorHost.use([]);
      }
    });
  });

  it("carries a verification its receiver checks: signed by the sender's own operator, in date", async () => {
    const asker = await addUser(clientHost, 'verified');
    const verifiedAt = new Date().toISOString();
    const verification = await signVerification(
      {
        subject: asker.identity,
        claims: { entityType: 'person', 'detail:legalName': 'Robert Smith' },
        verifiedAt,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
      {
        verifiedBy: clientHost.operator,
        selector: clientHost.selector,
        pemFiles: clientHost.operatorKeys,
      },
    );
    const request = await artifactFrom(
      asker,
      vendor.identity,
      'TRUST_REQ',
      {
        id: 'req-verified',
        name: 'Robert Smith',
        email: 'bob@client.example',
        reason: 'Invoices',
        phone: '+61 400 000 004',
        verification,
      },
      {
        extra: {
          permissions: [{ name: 'send:invoice', required: true }],
          entityType: 'person',
          given: [],
        },
      },
    );
    expect((await deliver(request)).response?.status.ok).toBe(true);

    const arrived = vendorHost.inbox.find((a) => a.id === request.id)!;
    const { payload, error } = await open<BTPTransporterArtifact>(vendor, arrived);
    expect(error).toBeUndefined();
    expect(await verificationFacts({ from: arrived.from, document: payload?.document })).toEqual({
      signatureValid: true,
      expired: false,
      verifierServesSender: true,
      verifierIsOperator: true,
    });
    expect(
      await vendorHost.trustStore.getById(computeTrustId(asker.identity, vendor.identity)),
    ).toMatchObject({ status: 'pending' });
  });
});
