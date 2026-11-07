/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: the withdrawn event, and a proposal sent again after one. The
 * platform's middleware (`eventChainCheck`), with its own lookup of the events
 * it holds (`getEvent`), refuses a withdrawn that does not take back its
 * sender's own open proposal, and a `follows` that names no withdrawn, and
 * tells the sender which. The server itself checks no chain. A 1.1.0 artifact
 * carries neither.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../btpsServer.js';
import { eventChainCheck } from '../libs/eventChainCheck.js';
import { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { BTPEventFacts, BTPTrustRecord } from '@core/trust/types.js';
import { BtpTransporterArtifactSchema } from '@core/server/schemas/artifacts/transporterSchema.js';
import { BTP_ERROR_EVENT_CHAIN } from '@core/error/index.js';
import type {
  BTPRequestCtx,
  BTPResponseCtx,
  MiddlewareDefinition,
  ProcessedArtifact,
} from '../types.js';
import type { BTPLifecycleEvent, BTPTransporterArtifact } from '../index.js';

const payer = 'pay$client.example';
const biller = 'billing$vendor.example';
const proposalId = '3c8e7a2b-5d4f-4e1a-8b6c-9d0e1f2a3b4c';
const eventId = '0b7f1f1e-6c1a-4a8e-9a57-6f0c1b9e2d3a';
const issuedAt = new Date().toISOString();

/** The invoice every event here is about. */
const invoice = { from: biller, id: 'INV-1' };

/** The platform's lookup: `held`, about the same invoice unless `held` names another. */
const holding = (
  held: Omit<BTPEventFacts, 'document'> & Partial<Pick<BTPEventFacts, 'document'>>,
) => vi.fn(async () => ({ document: invoice, ...held }));

/** A store that knows the invoice was exchanged. */
class KnownStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor() {
    super({ connection: null });
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

/** Runs the check on a trusted event: what it refused with, or undefined when it passed it on. */
const check = async (
  artifact: BTPTransporterArtifact,
  getEvent?: ReturnType<typeof holding>,
): Promise<{ code?: string | number; message: string } | undefined> => {
  const req = {
    isTrusted: true,
    data: { type: 'transporter', artifact },
  } as unknown as BTPRequestCtx<'after', 'trustVerification'>;
  const res = { sendError: vi.fn() } as unknown as BTPResponseCtx<'after', 'trustVerification'>;
  const next = vi.fn();
  await eventChainCheck(getEvent && { getEvent }).handler(req, res, next);
  const refused = (res.sendError as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  expect(next).toHaveBeenCalledTimes(refused ? 0 : 1);
  return refused;
};

describe('an event that names an earlier one, checked by its platform in flight', () => {
  it("is taken when a withdrawn takes back its sender's own open proposal", async () => {
    const getEvent = holding({ eventType: 'disputed', from: payer, state: 'open' });

    expect(await check(eventArtifact(withdrawn), getEvent)).toBeUndefined();
    expect(getEvent).toHaveBeenCalledWith({ id: proposalId, from: payer, to: biller });
  });

  it('is refused when the proposal it withdraws is already answered', async () => {
    const getEvent = holding({ eventType: 'disputed', from: payer, state: 'answered' });
    const error = await check(eventArtifact(withdrawn), getEvent);

    expect(error?.code).toBe(BTP_ERROR_EVENT_CHAIN.code);
    expect(error?.message).toContain('already answered or withdrawn');
  });

  it("is refused when it withdraws the other party's proposal", async () => {
    const getEvent = holding({ eventType: 'disputed', from: biller, state: 'open' });

    expect((await check(eventArtifact(withdrawn), getEvent))?.message).toContain('only its sender');
  });

  it('is refused when a biller withdraws its own recorded paid, which is final', async () => {
    const getEvent = holding({ eventType: 'paid', from: biller, state: 'open' });
    const error = await check(eventArtifact(withdrawn, { from: biller, to: payer }), getEvent);

    expect(error?.code).toBe(BTP_ERROR_EVENT_CHAIN.code);
    expect(error?.message).toContain('only the payer');
  });

  it('is refused when it withdraws a proposal about another invoice', async () => {
    const getEvent = holding({
      eventType: 'disputed',
      from: payer,
      state: 'open',
      document: { from: biller, id: 'INV-2' },
    });

    expect((await check(eventArtifact(withdrawn), getEvent))?.message).toContain('same invoice');
  });

  it('is refused when a proposal follows anything but a withdrawn', async () => {
    const getEvent = holding({ eventType: 'disputed', from: payer, state: 'open' });
    const { inReplyTo: _inReplyTo, ...shared } = withdrawn;
    const disputedAgain: BTPLifecycleEvent = {
      ...shared,
      eventType: 'disputed',
      reason: 'amount_wrong',
      follows: proposalId,
    };

    expect((await check(eventArtifact(disputedAgain), getEvent))?.code).toBe(
      BTP_ERROR_EVENT_CHAIN.code,
    );
  });

  it('checks only who sent it when the platform gives no lookup', async () => {
    expect(await check(eventArtifact(withdrawn))).toBeUndefined();
    expect((await check(eventArtifact(withdrawn, { from: biller, to: payer })))?.code).toBe(
      BTP_ERROR_EVENT_CHAIN.code,
    );
  });

  it('passes an encrypted event on, for its platform to check once opened', async () => {
    const getEvent = holding({ eventType: 'response', from: biller, state: 'answered' });
    const encrypted = eventArtifact('ciphertext', {
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'AA==',
        iv: 'AA==',
        authTag: 'AA==',
        type: 'standardEncrypt',
      },
    });

    expect(await check(encrypted, getEvent)).toBeUndefined();
    expect(getEvent).not.toHaveBeenCalled();
  });
});

describe('a server', () => {
  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockReturnValue(new EventEmitter() as unknown as tls.Server);
  });

  afterEach(() => vi.restoreAllMocks());

  /** Runs a biller's withdrawn through a server's pipeline: the error it sent the sender. */
  const sentFor = async (middleware: MiddlewareDefinition[]) => {
    const btps = new BtpsServer({
      serverIdentity: { identity: 'host$vendor.example', publicKey: 'pub', privateKey: 'priv' },
      trustStore: new KnownStore(),
      tlsOptions: { key: 'test-key', cert: 'test-cert' },
    });
    btps['middlewareManager']['middleware'] = middleware;
    btps['verifySignature'] = vi.fn(async () => ({ isValid: true }));
    btps['verifyTrust'] = vi.fn(async () => ({ isTrusted: true }));
    const sendBtpsError = vi.spyOn(
      btps as unknown as { sendBtpsError: (socket: TLSSocket, error: unknown) => void },
      'sendBtpsError',
    );
    const data: ProcessedArtifact = {
      type: 'transporter',
      artifact: eventArtifact(withdrawn, { from: biller, to: payer }),
    };
    const socket = {} as TLSSocket;
    // As the server's own response context: a middleware's error is sent as the server's are.
    const res = {
      socket,
      reqId: eventId,
      responseSent: false,
      sendError(error: Parameters<BTPResponseCtx['sendError']>[0]) {
        res.responseSent = true;
        btps['sendBtpsError'](socket, error, eventId);
      },
    };

    await btps['executeRequestPipeline'](
      {
        data,
        socket,
        getIdentity: () => ({ to: payer, from: biller }),
      } as unknown as BTPRequestCtx<'before', 'signatureVerification'>,
      res as unknown as BTPResponseCtx<'before', 'signatureVerification'>,
    );
    return sendBtpsError.mock.calls[0]?.[1];
  };

  it('checks no chain itself', async () => {
    expect(await sentFor([])).not.toMatchObject({ code: BTP_ERROR_EVENT_CHAIN.code });
  });

  it('tells the sender exactly which chain rule it broke, with the check added', async () => {
    expect(await sentFor([eventChainCheck()])).toMatchObject({
      code: BTP_ERROR_EVENT_CHAIN.code,
      message: expect.stringContaining('only the payer'),
    });
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
