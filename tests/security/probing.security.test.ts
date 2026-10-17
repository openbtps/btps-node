/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A stranger probes a provider to learn what only the receiver knows: who it
// trusts, revoked or blocked, which devices are registered. Every refusal they
// can see reads the same, and carries no internal detail. A declined sender
// cannot simply ask again before the receiver allows it.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsAgent } from '../../src/client/btpsAgent.js';
import { computeTrustId } from '../../src/core/trust/index.js';
import type { BTPTrustRecord } from '../../src/core/trust/types.js';
import type { BTPStatus } from '../../src/core/server/types.js';
import { BTP_ERROR_TRUST_NOT_ALLOWED } from '../../src/core/error/index.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  newKeys,
  recordTrust,
  sendRaw,
  senderTls,
  startProvider,
  type Provider,
  type User,
} from '../e2e/harness.js';

vi.mock('dns/promises', async () => (await import('../e2e/zone.js')).dnsModule);

const trustRequest = () => ({
  id: randomUUID(),
  name: 'Sender Pty Ltd',
  email: 'billing@sender.test',
  reason: 'To send invoices',
  phone: '+61 2 0000 0000',
});

describe('probing a provider, and asking again', () => {
  let senderHost: Provider;
  let receiverHost: Provider;
  let receiver: User;
  const senders: Record<string, User> = {};

  const refusalFor = async (sender: User): Promise<BTPStatus | undefined> => {
    const artifact = await artifactFrom(sender, receiver.identity, 'BTPS_DOC', invoiceDocument());
    return (await deliver(artifact)).response?.status;
  };

  beforeAll(async () => {
    senderHost = await startProvider('sender.test');
    receiverHost = await startProvider('receiver.test');
    receiver = await addUser(receiverHost, 'pay');
    const states: (BTPTrustRecord['status'] | 'none')[] = [
      'none',
      'pending',
      'rejected',
      'revoked',
      'blocked',
    ];
    for (const state of states) {
      senders[state] = await addUser(senderHost, `from-${state}`);
      if (state !== 'none') {
        await recordTrust(
          receiverHost.trustStore,
          senders[state].identity,
          receiver.identity,
          state,
        );
      }
    }
  });

  afterAll(() => {
    senderHost.stop();
    receiverHost.stop();
  });

  it('answers a stranger, a pending, a rejected, a revoked and a blocked sender identically', async () => {
    const answers = await Promise.all(Object.values(senders).map(refusalFor));

    expect(answers[0]).toMatchObject({
      ok: false,
      code: 403,
      error: BTP_ERROR_TRUST_NOT_ALLOWED.code,
    });
    for (const answer of answers) expect(answer).toEqual(answers[0]);
  });

  it('carries no internal detail in a refusal', async () => {
    const artifact = await artifactFrom(
      senders.revoked,
      receiver.identity,
      'BTPS_DOC',
      invoiceDocument(),
    );

    const answer = await sendRaw(receiverHost, JSON.stringify(artifact));
    const text = JSON.stringify(answer);

    expect(Object.keys(answer.status).sort()).toEqual(['code', 'error', 'message', 'ok']);
    expect(text).not.toMatch(/revoked|cause|meta|stack|trustStore|\.ts:/i);
  });

  it("answers an unknown device and a registered device's id with the wrong key identically", async () => {
    const auth = new BtpsAuthentication({
      trustStore: receiverHost.trustStore,
      tokenStore: new InMemoryTokenStore(),
    });
    const { agentId } = await auth.createAgent(
      { userIdentity: receiver.identity, publicKey: newKeys().publicKey, decidedBy: 'pay' },
      receiver.identity,
    );
    receiverHost.server.onIncomingArtifact('Agent', (_artifact, resCtx) =>
      resCtx.sendRes({
        ...receiverHost.server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
        type: 'btps_response',
      } as Parameters<typeof resCtx.sendRes>[0]),
    );
    const probe = async (id: string) => {
      const keys = newKeys();
      const device = new BtpsAgent({
        agent: { id, identityKey: keys.privateKey, identityCert: keys.publicKey },
        btpIdentity: receiver.identity,
        btpMtsOptions: senderTls,
        maxRetries: 0,
      });
      const { response } = await device.command('inbox.fetch', receiver.identity, { limit: 1 });
      device.destroy();
      return response?.status;
    };

    const unknown = await probe('btps_ag_never-registered');
    const wrongKey = await probe(agentId);

    expect(unknown).toMatchObject({ ok: false, code: 401 });
    expect(wrongKey).toEqual(unknown);
  });

  it('refuses a new trust request from a declined sender until its retry date', async () => {
    const declined = await addUser(senderHost, 'declined');
    const later = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await recordTrust(receiverHost.trustStore, declined.identity, receiver.identity, 'rejected', {
      retryAfterDate: later,
    });

    const request = await artifactFrom(declined, receiver.identity, 'TRUST_REQ', trustRequest(), {
      encrypt: false,
    });
    const { response } = await deliver(request);

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
  });

  // BTPS leaves repeated requests to the provider; one that refuses them uses
  // the same answer as every other trust refusal, so a stranger cannot learn
  // that a request is pending.
  it("refuses a repeated request while one is pending, from the provider's middleware, as 'not allowed'", async () => {
    const eager = await addUser(senderHost, 'eager');
    receiverHost.use([
      {
        phase: 'before',
        step: 'trustVerification',
        handler: async (req, res, next, context) => {
          const { data } = req;
          if (data?.type === 'transporter' && data.artifact.type === 'TRUST_REQ' && context) {
            const { from, to } = data.artifact;
            const record = await context.dependencies.trustStore.getById(computeTrustId(from, to));
            if (record?.status === 'pending') return res.sendError(BTP_ERROR_TRUST_NOT_ALLOWED);
          }
          await next();
        },
      },
    ]);
    const ask = async () =>
      (
        await deliver(
          await artifactFrom(eager, receiver.identity, 'TRUST_REQ', trustRequest(), {
            encrypt: false,
          }),
        )
      ).response?.status;

    const first = await ask();
    const again = await ask();
    const stranger = await refusalFor(senders.none);
    receiverHost.use([]);

    expect(first).toMatchObject({ ok: true, code: 200 });
    expect(again).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
    expect(again).toEqual(stranger);
  });

  it('accepts a new trust request from a declined sender once its retry date has passed', async () => {
    const declined = await addUser(senderHost, 'retried');
    const earlier = new Date(Date.now() - 60 * 1000).toISOString();
    await recordTrust(receiverHost.trustStore, declined.identity, receiver.identity, 'rejected', {
      retryAfterDate: earlier,
    });

    const request = await artifactFrom(declined, receiver.identity, 'TRUST_REQ', trustRequest(), {
      encrypt: false,
    });
    const { response } = await deliver(request);

    expect(response?.status).toMatchObject({ ok: true, code: 200 });
  });
});
