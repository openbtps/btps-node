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
//
// An agent action outside IMMEDIATE_ACTIONS is answered 200 once its provider
// takes it, before delivery, so assert its arrival with vi.waitFor.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsAgent } from '../../src/client/btpsAgent.js';
import { BtpsDelegator } from '../../src/core/delegation/BtpsDelegator.js';
import { PemDecrypter } from '../../src/core/crypto/pem-decrypter.js';
import { syncOfArtifact } from '../../src/core/crypto/index.js';
import { computeAgentTrustId } from '../../src/core/trust/trustUtils.js';
import { wrapForAgent } from '../../src/server/libs/wrapForAgent.js';
import { AGENT_TRANSPORTER_ACTIONS } from '../../src/core/server/constants/index.js';
import type { BTPAuthReqDoc, BTPTransporterArtifact } from '../../src/core/server/types.js';
import type { BTPDocument, BTPInvoiceDoc } from '../../src/server/types.js';
import {
  BTP_ERROR_AGENT_ID,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_SYNC_NOT_ALLOWED,
} from '../../src/core/error/index.js';
import {
  addUser,
  artifactFrom,
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
  // What the provider sent for the user, and the syncs its devices kept.
  const sent: BTPTransporterArtifact[] = [];
  const synced: BTPTransporterArtifact[] = [];

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
      // Short, so the journey can retry inside it and again after it.
      refreshGraceMs: 1000,
    });
    const identityDecrypter = new PemDecrypter({ privateKey: user.keys.privateKey });
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
      if (artifact.action === 'inbox.fetch') {
        // The user's inbox, each encrypted entry's key wrapped to the device that asked.
        const device = await host.trustStore.getById(
          computeAgentTrustId(artifact.agentId, user.identity),
        );
        const results = await Promise.all(
          host.inbox
            .filter((received) => received.to === user.identity)
            .map(async (received) =>
              received.encryption && device
                ? {
                    artifact: received,
                    agentKey: await wrapForAgent(received, identityDecrypter, device),
                  }
                : { artifact: received },
            ),
        );
        return answer({ results });
      }
      if (artifact.action === 'sentbox.fetch') {
        // Each send with the provider's own record of how it went.
        const at = new Date().toISOString();
        return answer({
          results: sent.map((delegated) => ({
            artifact: delegated,
            meta: { delivery: { status: 'delivered', at } },
          })),
        });
      }
      if (artifact.action in AGENT_TRANSPORTER_ACTIONS) {
        const carried = artifact.document as BTPTransporterArtifact;
        // A sync is the user's own copy of a send: kept, never delivered.
        if (carried.syncOf) {
          synced.push(carried);
          return answer(undefined);
        }
        // The phone signed the artifact; the provider delegates it and delivers it.
        const delegated = await delegator.delegateArtifact(
          artifact.agentId,
          deviceKeys.publicKey,
          carried,
        );
        const { response } = await deliver(delegated);
        if (response?.status.ok) {
          sent.push(delegated);
          return answer(undefined);
        }
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
      const arrived = await vi.waitFor(
        () => {
          const found = elsewhere.inbox.find(
            (a) => (a.document as { id?: string }).id === document.id,
          );
          expect(found).toBeDefined();
          return found;
        },
        { timeout: 10000 },
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
    await vi.waitFor(
      () =>
        expect(
          elsewhere.inbox.some((a) => a.type === 'TRUST_REQ' && a.from === user.identity),
        ).toBe(true),
      { timeout: 10000 },
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

  it('opens what arrived for the user with its own key, wrapped for it by the provider', async () => {
    await recordTrust(host.trustStore, receiver.identity, user.identity, 'accepted');
    const document = invoiceDocument({ id: 'INV-TO-PHONE' });
    const arrived = await artifactFrom(receiver, user.identity, 'BTPS_DOC', document);
    expect((await deliver(arrived)).response?.status.ok).toBe(true);

    const { response } = await phone(agentId, deviceKeys, user.identity).command(
      'inbox.fetch',
      user.identity,
      { limit: 10 },
    );
    const entry = (
      response?.document as { results: { artifact: BTPTransporterArtifact; agentKey?: unknown }[] }
    ).results.find((result) => result.artifact.id === arrived.id)!;
    const opened = await phone(agentId, deviceKeys, user.identity).openResult(entry as never);
    const withAnotherKey = await phone(agentId, newKeys(), user.identity).openResult(
      entry as never,
    );

    expect(entry.agentKey).toBeDefined();
    expect(opened.error).toBeUndefined();
    expect(opened.payload?.document).toEqual(document);
    expect(withAnotherKey.payload).toBeUndefined();
    expect(withAnotherKey.error).toBeDefined();
  });

  it("keeps a send's sync from the phone, and refuses one sent to the provider directly", async () => {
    const original = sent.at(-1)!;
    const syncOf = syncOfArtifact(original);
    const copy = invoiceDocument({ id: 'INV-SYNCED' });

    const viaPhone = await phone(agentId, deviceKeys, user.identity).command(
      'artifact.send',
      user.identity,
      copy as BTPDocument,
      { signature: { algorithmHash: 'sha256' }, syncOf },
    );
    const direct = await artifactFrom(user, user.identity, 'BTPS_DOC', copy, { extra: { syncOf } });
    const { response: refused } = await deliver(direct);

    expect(viaPhone.error).toBeUndefined();
    expect(viaPhone.response?.status).toMatchObject({ ok: true, code: 200 });
    await vi.waitFor(() => expect(synced.map((s) => s.syncOf)).toContainEqual(syncOf));
    expect(refused?.status).toMatchObject({ ok: false, error: BTP_ERROR_SYNC_NOT_ALLOWED.code });
  });

  it("reads its sentbox with the provider's own record of each delivery", async () => {
    const { response, error } = await phone(agentId, deviceKeys, user.identity).command(
      'sentbox.fetch',
      user.identity,
      { limit: 10 },
    );

    const results = (response?.document as { results: { meta?: { delivery?: unknown } }[] })
      .results;
    expect(error).toBeUndefined();
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.meta?.delivery).toMatchObject({ status: 'delivered' });
    }
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

  it('answers a refresh retried inside the grace window the same, and takes the old token after it as theft', async () => {
    // A second phone, so the first keeps its own sign-in.
    const secondKeys = newKeys();
    const code = BtpsAuthentication.generateAuthToken(user.identity);
    await auth.storeAuthToken(code, user.identity, user.identity);
    const registered = await BtpsAuthentication.authenticate(
      user.identity,
      code,
      secondKeys,
      { deviceName: "Alice's tablet" },
      agentOptions,
    );
    const secondId = registered.response!.document!.agentId;
    const token = registered.response!.document!.refreshToken;
    const reused = vi.fn();
    auth.on('refreshTokenReused', reused);
    const refresh = () =>
      BtpsAuthentication.refreshSession(
        secondId,
        user.identity,
        token,
        secondKeys,
        {},
        agentOptions,
      );

    const first = await refresh();
    // The answer was lost: the tablet asks again with the token it still has.
    const retried = await refresh();

    expect(first.success).toBe(true);
    expect(retried.success).toBe(true);
    expect(retried.response?.document?.refreshToken).toBe(first.response?.document?.refreshToken);
    expect(reused).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 1100));
    const late = await refresh();

    expect(late.success).toBe(false);
    expect(reused).toHaveBeenCalledWith(expect.objectContaining({ agentId: secondId }));
  });
});
