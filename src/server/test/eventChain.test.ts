/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: the withdrawn event, and a proposal sent again after one. A
 * server whose store can say what it holds (`getEvent`) refuses a withdrawn
 * that does not take back its sender's own open proposal, and a `follows`
 * that names no withdrawn, and tells the sender which. A 1.1.0 artifact
 * carries neither.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../btpsServer.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { BTPEventFacts, BTPTrustRecord } from '@core/trust/types.js';
import { BtpTransporterArtifactSchema } from '@core/server/schemas/artifacts/transporterSchema.js';
import { BTP_ERROR_EVENT_CHAIN } from '@core/error/index.js';
import type { BTPRequestCtx, BTPResponseCtx, ProcessedArtifact } from '../types.js';
import type { BTPLifecycleEvent, BTPTransporterArtifact } from '../index.js';

const payer = 'pay$client.example';
const biller = 'billing$vendor.example';
const proposalId = '3c8e7a2b-5d4f-4e1a-8b6c-9d0e1f2a3b4c';
const eventId = '0b7f1f1e-6c1a-4a8e-9a57-6f0c1b9e2d3a';
const issuedAt = new Date().toISOString();

/** The invoice every event here is about. */
const invoice = { from: biller, id: 'INV-1' };

/**
 * A store that knows the invoice was exchanged, and answers getEvent from
 * `held` when given one, about the same invoice unless `held` names another.
 */
class EventStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor(held?: Omit<BTPEventFacts, 'document'> & Partial<Pick<BTPEventFacts, 'document'>>) {
    super({ connection: null });
    if (held) this.getEvent = vi.fn(async () => ({ document: invoice, ...held }));
  }
  async getById() {
    return undefined;
  }
  async create(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async update(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async delete() {}
  async getAll() {
    return [];
  }
  async isKnownArtifact() {
    return true;
  }
}

const withdrawn: BTPLifecycleEvent = {
  type: 'lifecycle_event',
  id: eventId,
  occurredAt: issuedAt,
  document: { from: biller, id: 'INV-1', sha256: 'a'.repeat(64) },
  eventType: 'withdrawn',
  inReplyTo: proposalId,
};

const eventArtifact = (
  document: BTPLifecycleEvent | string,
  more: Partial<BTPTransporterArtifact> = {},
): BTPTransporterArtifact => ({
  version: '1.2.0',
  id: eventId,
  issuedAt,
  type: 'BTPS_EVENT',
  from: payer,
  to: biller,
  selector: 'btps1',
  relatesTo: 'artifact-1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: null,
  document,
  ...more,
});

describe('an event that names an earlier one', () => {
  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockReturnValue(new EventEmitter() as unknown as tls.Server);
  });

  afterEach(() => vi.restoreAllMocks());

  const server = (store: EventStore) =>
    new BtpsServer({
      serverIdentity: { identity: 'host$vendor.example', publicKey: 'pub', privateKey: 'priv' },
      trustStore: store,
      tlsOptions: { key: 'test-key', cert: 'test-cert' },
    });
  const relation = (store: EventStore, artifact: BTPTransporterArtifact) =>
    server(store)['verifyEventRelation']({ type: 'transporter', artifact });

  it("is taken when a withdrawn takes back its sender's own open proposal", async () => {
    const store = new EventStore({ eventType: 'disputed', from: payer, state: 'open' });
    const { isTrusted } = await relation(store, eventArtifact(withdrawn));

    expect(isTrusted).toBe(true);
    expect(store.getEvent).toHaveBeenCalledWith({ id: proposalId, from: payer, to: biller });
  });

  it('is refused when the proposal it withdraws is already answered', async () => {
    const store = new EventStore({ eventType: 'disputed', from: payer, state: 'answered' });
    const { isTrusted, error } = await relation(store, eventArtifact(withdrawn));

    expect(isTrusted).toBe(false);
    expect(error?.code).toBe(BTP_ERROR_EVENT_CHAIN.code);
    expect(error?.message).toContain('already answered or withdrawn');
  });

  it("is refused when it withdraws the other party's proposal", async () => {
    const store = new EventStore({ eventType: 'disputed', from: biller, state: 'open' });
    const { error } = await relation(store, eventArtifact(withdrawn));

    expect(error?.message).toContain('only its sender');
  });

  it('is refused when a biller withdraws its own recorded paid, which is final', async () => {
    const store = new EventStore({ eventType: 'paid', from: biller, state: 'open' });
    const fromBiller = eventArtifact(withdrawn, { from: biller, to: payer });
    const { error } = await relation(store, fromBiller);

    expect(error?.code).toBe(BTP_ERROR_EVENT_CHAIN.code);
    expect(error?.message).toContain('only the payer');
  });

  it('is refused when it withdraws a proposal about another invoice', async () => {
    const store = new EventStore({
      eventType: 'disputed',
      from: payer,
      state: 'open',
      document: { from: biller, id: 'INV-2' },
    });
    const { error } = await relation(store, eventArtifact(withdrawn));

    expect(error?.message).toContain('same invoice');
  });

  it('is refused when a proposal follows anything but a withdrawn', async () => {
    const store = new EventStore({ eventType: 'disputed', from: payer, state: 'open' });
    const { inReplyTo: _inReplyTo, ...shared } = withdrawn;
    const disputedAgain: BTPLifecycleEvent = {
      ...shared,
      eventType: 'disputed',
      reason: 'amount_wrong',
      follows: proposalId,
    };
    const { error } = await relation(store, eventArtifact(disputedAgain));

    expect(error?.code).toBe(BTP_ERROR_EVENT_CHAIN.code);
  });

  it('is left to the platform when the store cannot say what it holds', async () => {
    const { isTrusted } = await relation(new EventStore(), eventArtifact(withdrawn));

    expect(isTrusted).toBe(true);
  });

  it("is refused from the invoice's issuer even when the store cannot say what it holds", async () => {
    const fromBiller = eventArtifact(withdrawn, { from: biller, to: payer });
    const { error } = await relation(new EventStore(), fromBiller);

    expect(error?.code).toBe(BTP_ERROR_EVENT_CHAIN.code);
  });

  it('is left to the platform when it is encrypted', async () => {
    const store = new EventStore({ eventType: 'response', from: biller, state: 'answered' });
    const encrypted = eventArtifact('ciphertext', {
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'AA==',
        iv: 'AA==',
        authTag: 'AA==',
        type: 'standardEncrypt',
      },
    });
    const { isTrusted } = await relation(store, encrypted);

    expect(isTrusted).toBe(true);
    expect(store.getEvent).not.toHaveBeenCalled();
  });

  it('tells the sender exactly which chain rule it broke', async () => {
    const store = new EventStore({ eventType: 'disputed', from: payer, state: 'answered' });
    const btps = server(store);
    btps['verifySignature'] = vi.fn(async () => ({ isValid: true }));
    btps['verifyTrust'] = vi.fn(async () => ({ isTrusted: true }));
    const sendBtpsError = vi.spyOn(
      btps as unknown as { sendBtpsError: () => void },
      'sendBtpsError',
    );
    const data: ProcessedArtifact = { type: 'transporter', artifact: eventArtifact(withdrawn) };
    const socket = {} as TLSSocket;

    await btps['executeRequestPipeline'](
      {
        data,
        socket,
        getIdentity: () => ({ to: biller, from: payer }),
      } as unknown as BTPRequestCtx<'before', 'signatureVerification'>,
      { socket, reqId: eventId, responseSent: false } as unknown as BTPResponseCtx<
        'before',
        'signatureVerification'
      >,
    );

    expect(sendBtpsError).toHaveBeenCalledWith(
      socket,
      expect.objectContaining({ code: BTP_ERROR_EVENT_CHAIN.code }),
      eventId,
    );
  });
});

describe('a 1.1.0 artifact', () => {
  it('carries no withdrawn event', () => {
    expect(BtpTransporterArtifactSchema.safeParse(eventArtifact(withdrawn)).success).toBe(true);
    expect(
      BtpTransporterArtifactSchema.safeParse(eventArtifact(withdrawn, { version: '1.1.0' }))
        .success,
    ).toBe(false);
  });
});
