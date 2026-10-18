/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: a user registers a phone with a one-time code from their provider,
// the phone reads the inbox, sends an invoice and a trust request that its
// provider delegates and delivers, then moves to a new key. A code works once;
// a device the provider never registered is refused, and so is a phone
// sending as someone other than its user.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsAgent } from '../../src/client/btpsAgent.js';
import { BtpsDelegator } from '../../src/core/delegation/BtpsDelegator.js';
import { AGENT_TRANSPORTER_ACTIONS } from '../../src/core/server/constants/index.js';
import type { BTPAuthReqDoc, BTPTransporterArtifact } from '../../src/core/server/types.js';
import type { BTPDocument, BTPInvoiceDoc } from '../../src/server/types.js';
import { BTP_ERROR_AGENT_ID, BTP_ERROR_SIG_VERIFICATION } from '../../src/core/error/index.js';
import {
  addUser,
  deliver,
  invoiceDocument,
  letterDocument,
  newKeys,
  payslipDocument,
  receiptDocument,
  recordTrust,
  senderTls,
  startProvider,
  type Keys,
  type Provider,
  type User,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const agentOptions = { btpMtsOptions: senderTls, maxRetries: 0 };

const phone = (id: string, keys: Keys, identity: string) =>
  new BtpsAgent({
    agent: { id, identityKey: keys.privateKey, identityCert: keys.publicKey },
    btpIdentity: identity,
    ...agentOptions,
  });

describe('journey: a user registers a phone', () => {
  let host: Provider;
  let elsewhere: Provider;
  let user: User;
  let receiver: User;
  let auth: BtpsAuthentication;
  const deviceKeys = newKeys();
  let agentId = '';
  let refreshToken = '';

  beforeAll(async () => {
    host = await startProvider('saas.test');
    user = await addUser(host, 'alice');
    elsewhere = await startProvider('elsewhere.test');
    receiver = await addUser(elsewhere, 'bob');
    // Bob accepted Alice's trust earlier, so her invoices are delivered.
    await recordTrust(elsewhere.trustStore, user.identity, receiver.identity, 'accepted', {
      privacyType: 'mixed',
    });
    auth = new BtpsAuthentication({
      trustStore: host.trustStore,
      tokenStore: new InMemoryTokenStore(),
    });
    // The provider sends for its users' devices as its domain's operator.
    const delegator = new BtpsDelegator({
      identity: host.operator,
      privateKey: host.operatorKeys.privateKey,
    });
    // The provider's device sign-in, as a platform writes it around the SDK.
    host.server.onIncomingArtifact('Agent', async (artifact, resCtx) => {
      const answer = (document: unknown) =>
        resCtx.sendRes({
          ...host.server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
          type: 'btps_response',
          document,
        } as Parameters<typeof resCtx.sendRes>[0]);
      const refuse = () => resCtx.sendError({ code: 401, message: 'Authentication failed' });

      const doc = artifact.document as BTPAuthReqDoc;
      if (artifact.action === 'auth.request') {
        const valid = await auth.validateAuthToken(doc.identity, doc.authToken);
        if (!valid.isValid) return refuse();
        return answer(
          await auth.createAgent(
            { userIdentity: doc.identity, publicKey: doc.publicKey, decidedBy: 'alice' },
            doc.identity,
          ),
        );
      }
      if (artifact.action === 'auth.refresh') {
        const { data } = await auth.validateAndReissueRefreshToken(
          artifact.agentId,
          doc.authToken,
          {
            decidedBy: 'alice',
            publicKey: doc.publicKey,
            decryptBy: doc.identity,
          },
        );
        return data ? answer(data) : refuse();
      }
      if (artifact.action === 'inbox.fetch') return answer({ results: [] });
      if (artifact.action in AGENT_TRANSPORTER_ACTIONS) {
        // The phone signed the artifact; the provider delegates it and delivers it.
        const delegated = await delegator.delegateArtifact(
          artifact.agentId,
          deviceKeys.publicKey,
          artifact.document as BTPTransporterArtifact,
        );
        const { response } = await deliver(delegated);
        if (response?.status.ok) return answer(undefined);
        return resCtx.sendError({ code: 502, message: 'The receiver refused it' });
      }
    });
  });

  afterAll(() => {
    host.stop();
    elsewhere.stop();
  });

  it('registers the phone with a one-time code', async () => {
    const code = BtpsAuthentication.generateAuthToken(user.identity);
    await auth.storeAuthToken(code, user.identity, user.identity);

    const { success, response, error } = await BtpsAuthentication.authenticate(
      user.identity,
      code,
      deviceKeys,
      { deviceName: "Alice's phone" },
      agentOptions,
    );

    expect(error).toBeUndefined();
    expect(success).toBe(true);
    agentId = response!.document!.agentId;
    refreshToken = response!.document!.refreshToken;
    expect(agentId).toMatch(/^btps_ag_/);
  });

  it('refuses the same code a second time', async () => {
    const code = BtpsAuthentication.generateAuthToken(user.identity);
    await auth.storeAuthToken(code, user.identity, user.identity);
    await BtpsAuthentication.authenticate(user.identity, code, newKeys(), {}, agentOptions);

    const again = await BtpsAuthentication.authenticate(
      user.identity,
      code,
      newKeys(),
      {},
      agentOptions,
    );

    expect(again.success).toBe(false);
  });

  it("reads the user's inbox, signed with its registered key", async () => {
    const { response, error } = await phone(agentId, deviceKeys, user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
  });

  it('sends an invoice, a receipt, a payslip and a letter to someone at another provider, who receives each intact from the user', async () => {
    const documents = [
      invoiceDocument({ id: 'INV-PHONE' }),
      receiptDocument({ id: 'REC-PHONE' }),
      payslipDocument({ id: 'PAY-PHONE' }),
      letterDocument({ id: 'LET-PHONE' }),
    ];

    for (const document of documents) {
      const { response, error } = await phone(agentId, deviceKeys, user.identity).command(
        'artifact.send',
        receiver.identity,
        document as BTPDocument,
      );

      expect(error).toBeUndefined();
      expect(response?.status).toMatchObject({ ok: true, code: 200 });
      const arrived = elsewhere.inbox.find(
        (a) => (a.document as { id?: string }).id === document.id,
      );
      expect(arrived).toMatchObject({
        from: user.identity,
        to: receiver.identity,
        type: 'BTPS_DOC',
      });
      expect(arrived?.document).toEqual(document);
    }
  });

  it('refuses a document of no known shape before it leaves the phone', async () => {
    const htmlLetter = letterDocument({
      id: 'LET-HTML',
      body: { format: 'html', content: '<b>hi</b>' },
    });

    const { response, error } = await phone(agentId, deviceKeys, user.identity).command(
      'artifact.send',
      receiver.identity,
      htmlLetter as BTPDocument,
    );

    expect(response).toBeUndefined();
    expect(error?.code).toBe('BTP_ERROR_VALIDATION');
    expect(elsewhere.inbox.some((a) => (a.document as { id?: string }).id === 'LET-HTML')).toBe(
      false,
    );
  });

  it('sends a trust request to someone it has no trust with yet', async () => {
    const { response, error } = await phone(agentId, deviceKeys, user.identity).command(
      'trust.request',
      'carol$elsewhere.test',
      {
        id: 'req-phone',
        name: 'Alice',
        email: 'alice@saas.test',
        reason: 'To send you invoices',
        phone: '+61 400 000 000',
      },
    );

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    expect(elsewhere.inbox.some((a) => a.type === 'TRUST_REQ' && a.from === user.identity)).toBe(
      true,
    );
  });

  it("refuses the user's phone sending as someone else", async () => {
    const { response } = await phone(agentId, deviceKeys, 'mallory$saas.test').command(
      'artifact.send',
      receiver.identity,
      invoiceDocument({ id: 'INV-MALLORY' }) as BTPInvoiceDoc,
    );

    expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
    expect(elsewhere.inbox.some((a) => (a.document as { id?: string }).id === 'INV-MALLORY')).toBe(
      false,
    );
  });

  it('refuses a device the provider never registered', async () => {
    const { response } = await phone('btps_ag_never-registered', newKeys(), user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );

    expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
  });

  it('refuses the registered device id signed with another key', async () => {
    const { response } = await phone(agentId, newKeys(), user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );

    expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
  });

  it('refuses an identity posing as a device', async () => {
    const { response } = await phone('mallory$other.test', newKeys(), user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );

    expect(response?.status).toMatchObject({ code: 403, error: BTP_ERROR_AGENT_ID.code });
  });

  it('moves the phone to a new key with a proof, after which only the new key works', async () => {
    const nextKeys = newKeys();

    const rotated = await BtpsAuthentication.rotateKey(
      agentId,
      user.identity,
      refreshToken,
      deviceKeys,
      nextKeys,
      {},
      agentOptions,
    );

    expect(rotated.error).toBeUndefined();
    expect(rotated.success).toBe(true);
    const withNew = await phone(agentId, nextKeys, user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );
    const withOld = await phone(agentId, deviceKeys, user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );
    expect(withNew.response?.status).toMatchObject({ ok: true, code: 200 });
    expect(withOld.response?.status).toMatchObject({ code: 401 });
  });
});
