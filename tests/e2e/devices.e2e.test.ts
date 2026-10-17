/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: a user registers a phone with a one-time code from their provider,
// the phone reads the inbox, then moves to a new key. A code works once; a
// device the provider never registered is refused.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsAgent } from '../../src/client/btpsAgent.js';
import type { BTPAuthReqDoc } from '../../src/core/server/types.js';
import { BTP_ERROR_AGENT_ID, BTP_ERROR_SIG_VERIFICATION } from '../../src/core/error/index.js';
import {
  addUser,
  newKeys,
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
  let user: User;
  let auth: BtpsAuthentication;
  const deviceKeys = newKeys();
  let agentId = '';
  let refreshToken = '';

  beforeAll(async () => {
    host = await startProvider('saas.test');
    user = await addUser(host, 'alice');
    auth = new BtpsAuthentication({
      trustStore: host.trustStore,
      tokenStore: new InMemoryTokenStore(),
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
    });
  });

  afterAll(() => host.stop());

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
