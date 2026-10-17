/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: a user works through their trust requests from their phone.
// trust.fetch lists the requests, trust.update revokes a trust, trust.delete
// removes one. Each is answered by the user's own provider and sends nothing
// to the other side, which finds out only when its next invoice is refused -
// as "not allowed", never why.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsAgent } from '../../src/client/btpsAgent.js';
import { computeTrustId } from '../../src/core/trust/index.js';
import type { BTPTrustRecord, BTPTrustReqDoc } from '../../src/core/trust/types.js';
import type {
  BTPAgentArtifact,
  BTPAgentMutation,
  BTPQueryResult,
} from '../../src/core/server/types.js';
import { BTP_ERROR_TRUST_NOT_ALLOWED } from '../../src/core/error/index.js';
import {
  addUser,
  artifactFrom,
  deliver,
  invoiceDocument,
  newKeys,
  recordTrust,
  senderTls,
  startProvider,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

describe('journey: a user works through their trust requests from their phone', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let vendor: User;
  let supplier: User;
  let newcomer: User;
  let client: User;
  let phone: BtpsAgent;
  const received: (BTPAgentArtifact & { respondNow: boolean })[] = [];

  const sendInvoice = async (from: User, id: string) =>
    deliver(await artifactFrom(from, client.identity, 'BTPS_DOC', invoiceDocument({ id })));

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    vendor = await addUser(vendorHost, 'billing');
    supplier = await addUser(vendorHost, 'accounts');
    newcomer = await addUser(vendorHost, 'sales');
    client = await addUser(clientHost, 'pay');
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    await recordTrust(clientHost.trustStore, supplier.identity, client.identity, 'accepted');

    const auth = new BtpsAuthentication({
      trustStore: clientHost.trustStore,
      tokenStore: new InMemoryTokenStore(),
    });
    const deviceKeys = newKeys();
    const { agentId } = await auth.createAgent(
      {
        userIdentity: client.identity,
        publicKey: deviceKeys.publicKey,
        decidedBy: client.identity,
      },
      client.identity,
    );
    phone = new BtpsAgent({
      agent: {
        id: agentId,
        identityKey: deviceKeys.privateKey,
        identityCert: deviceKeys.publicKey,
      },
      btpIdentity: client.identity,
      btpMtsOptions: senderTls,
      maxRetries: 0,
    });

    // The client's provider answers from what it holds: a list as a query
    // result, a change with a status alone.
    clientHost.server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
      received.push(artifact);
      const answer = (document?: BTPQueryResult) =>
        resCtx.sendRes({
          ...clientHost.server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
          type: 'btps_response',
          ...(document && { document }),
        } as Parameters<typeof resCtx.sendRes>[0]);

      if (artifact.action === 'trust.fetch') {
        // Each request as it arrived, signed, with the trust's state beside it
        const requests = clientHost.inbox.filter((a) => a.type === 'TRUST_REQ');
        const results = await Promise.all(
          requests.map(async (request) => {
            const trustId = computeTrustId(request.from, request.to);
            const record = await clientHost.trustStore.getById(trustId);
            return { artifact: request, meta: { trustId, status: record?.status } };
          }),
        );
        return answer({ results });
      }
      if (artifact.action === 'trust.update') {
        const { id, document } = artifact.document as BTPAgentMutation;
        const { decision } = document as { decision: BTPTrustRecord['status'] };
        await clientHost.trustStore.update(id, { status: decision });
        return answer();
      }
      if (artifact.action === 'trust.delete') {
        const { ids } = artifact.document as { ids: string[] };
        for (const id of ids) await clientHost.trustStore.delete(id);
        return answer();
      }
    });
  });

  afterAll(() => {
    phone.destroy();
    vendorHost.stop();
    clientHost.stop();
  });

  it('lists a trust request that arrived, signed, with its state', async () => {
    const request: BTPTrustReqDoc = {
      id: randomUUID(),
      name: 'Newcomer Pty Ltd',
      email: 'sales@vendor.test',
      reason: 'To send quotes',
      phone: '+61 2 0000 0000',
    };
    const delivered = await deliver(
      await artifactFrom(newcomer, client.identity, 'TRUST_REQ', request, { encrypt: false }),
    );
    expect(delivered.response?.status).toMatchObject({ code: 200 });

    const { response, error } = await phone.command('trust.fetch', client.identity, { limit: 50 });

    expect(error).toBeUndefined();
    const { results } = response?.document as BTPQueryResult;
    expect(results).toHaveLength(1);
    expect(results[0].artifact).toMatchObject({
      type: 'TRUST_REQ',
      from: newcomer.identity,
      document: { name: 'Newcomer Pty Ltd', reason: 'To send quotes' },
    });
    expect(results[0].meta).toMatchObject({
      trustId: computeTrustId(newcomer.identity, client.identity),
      status: 'pending',
    });
  });

  it("revokes a trust at the user's own provider, sending nothing to the other side", async () => {
    expect((await sendInvoice(vendor, 'INV-100')).response?.status).toMatchObject({ code: 200 });
    const vendorInboxBefore = vendorHost.inbox.length;
    const recordId = computeTrustId(vendor.identity, client.identity);

    const { response, error } = await phone.command('trust.update', client.identity, {
      id: recordId,
      document: {
        id: randomUUID(),
        decision: 'revoked',
        decidedAt: new Date().toISOString(),
        decidedBy: client.identity,
      },
    });

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    // The provider got the edit itself, to answer at once, not a trust response to deliver
    const update = received.find((a) => a.action === 'trust.update')!;
    expect(update.respondNow).toBe(true);
    expect(update.document).toMatchObject({ id: recordId, document: { decision: 'revoked' } });
    expect((await clientHost.trustStore.getById(recordId))?.status).toBe('revoked');
    expect(vendorHost.inbox.length).toBe(vendorInboxBefore);
  });

  it("refuses the revoked sender's next invoice, without saying it was revoked", async () => {
    const { response } = await sendInvoice(vendor, 'INV-101');

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_TRUST_NOT_ALLOWED.code });
  });

  it('removes a trust, after which its invoices are refused the same way', async () => {
    const recordId = computeTrustId(supplier.identity, client.identity);

    const { response, error } = await phone.command('trust.delete', client.identity, {
      ids: [recordId],
    });

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    expect(await clientHost.trustStore.getById(recordId)).toBeUndefined();
    const refused = await sendInvoice(supplier, 'INV-200');
    expect(refused.response?.status).toMatchObject({
      code: 403,
      error: BTP_ERROR_TRUST_NOT_ALLOWED.code,
    });
  });
});
