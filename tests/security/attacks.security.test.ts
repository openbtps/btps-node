/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// An attacker on the network, or with an account of their own, tries to get
// an artifact accepted that its sender never sent: replayed, altered,
// redirected, or claiming someone else's address. Each is refused.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { BtpsAuthentication } from '../../src/core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../src/core/authentication/storage/InMemoryTokenStore.js';
import { BtpsAgent } from '../../src/client/btpsAgent.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  BTP_ERROR_SIG_MISMATCH,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_VALIDATION,
} from '../../src/core/error/index.js';
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

/** A provider's own refusal: the protocol leaves what to answer to it. */
const ALREADY_RECEIVED = {
  code: 'PROVIDER_ALREADY_RECEIVED',
  message: 'This artifact was already received',
  status: 409,
};

describe('attacks on artifacts in transit and on addresses', () => {
  let vendorHost: Provider;
  let clientHost: Provider;
  let attackerHost: Provider;
  let vendor: User;
  let client: User;
  let otherClient: User;
  let attacker: User;

  const invoice = (from: User, to: string, id = 'INV-001') =>
    artifactFrom(from, to, 'BTPS_DOC', invoiceDocument({ id }));

  beforeAll(async () => {
    vendorHost = await startProvider('vendor.test');
    clientHost = await startProvider('client.test');
    attackerHost = await startProvider('attacker.test');
    vendor = await addUser(vendorHost, 'billing');
    client = await addUser(clientHost, 'pay');
    otherClient = await addUser(clientHost, 'accounts');
    attacker = await addUser(attackerHost, 'mallory');
    await recordTrust(clientHost.trustStore, vendor.identity, client.identity, 'accepted');
    await recordTrust(clientHost.trustStore, vendor.identity, otherClient.identity, 'accepted');
  });

  afterAll(() => {
    vendorHost.stop();
    clientHost.stop();
    attackerHost.stop();
  });

  // BTPS refuses an artifact outside its time window; within it, a provider
  // that keeps what it received refuses a replay from its own middleware.
  describe('replay', () => {
    it("is refused by the provider's middleware, from what its store has seen", async () => {
      clientHost.use([
        {
          phase: 'after',
          step: 'signatureVerification',
          handler: async (req, res, next, context) => {
            const { data } = req;
            if (data?.type === 'transporter' && context) {
              const { id, from, to } = data.artifact;
              const seen = await context.dependencies.trustStore.isKnownArtifact({
                artifactId: id,
                from,
                to,
              });
              if (seen) return res.sendError(ALREADY_RECEIVED);
            }
            await next();
          },
        },
      ]);
      const artifact = await invoice(vendor, client.identity, 'INV-REPLAY');

      const first = await deliver(artifact);
      const second = await deliver(artifact);
      clientHost.use([]);

      expect(first.response?.status).toMatchObject({ ok: true, code: 200 });
      expect(second.response?.status).toMatchObject({
        ok: false,
        code: 409,
        error: ALREADY_RECEIVED.code,
      });
      expect(clientHost.inbox.filter((a) => a.id === artifact.id)).toHaveLength(1);
    });
  });

  describe('tampering', () => {
    it('refuses an artifact redirected to another receiver on the same server', async () => {
      const artifact = await invoice(vendor, client.identity, 'INV-REDIRECT');

      const { response } = await deliver({ ...artifact, to: otherClient.identity });

      expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
    });

    it('refuses an encrypted document with one character changed', async () => {
      const artifact = await invoice(vendor, client.identity, 'INV-FLIP');
      const ciphertext = artifact.document as string;
      const flipped = (ciphertext[10] === 'A' ? 'B' : 'A') + ciphertext.slice(11);

      const { response } = await deliver({
        ...artifact,
        document: ciphertext.slice(0, 10) + flipped,
      });

      expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
    });

    it('refuses an artifact whose encryption details were swapped for another', async () => {
      const artifact = await invoice(vendor, client.identity, 'INV-SWAP');
      const other = await invoice(vendor, client.identity, 'INV-SWAP-2');

      const { response } = await deliver({ ...artifact, encryption: other.encryption });

      expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
    });

    it('refuses an artifact with its signature removed', async () => {
      const artifact = await invoice(vendor, client.identity, 'INV-NOSIG');
      const { signature: _signature, ...unsigned } = artifact;

      const answer = await sendRaw(clientHost, JSON.stringify(unsigned));

      expect(answer.status).toMatchObject({
        ok: false,
        code: 400,
        error: BTP_ERROR_VALIDATION.code,
      });
    });
  });

  describe('spoofing', () => {
    it("refuses an artifact claiming the vendor's address but signed with the attacker's key", async () => {
      const posing = { ...attacker, identity: vendor.identity };
      const artifact = await invoice(posing, client.identity, 'INV-SPOOF');

      const { response } = await deliver(artifact);

      // The signing key is not the one the vendor publishes
      expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_MISMATCH.code });
      expect(clientHost.inbox.some((a) => a.id === artifact.id)).toBe(false);
    });

    it("refuses one device's registration used for another user on the same provider", async () => {
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
      clientHost.server.onIncomingArtifact('Agent', (_artifact, resCtx) =>
        resCtx.sendRes({
          ...clientHost.server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }),
          type: 'btps_response',
        } as Parameters<typeof resCtx.sendRes>[0]),
      );
      const stolen = new BtpsAgent({
        agent: {
          id: agentId,
          identityKey: deviceKeys.privateKey,
          identityCert: deviceKeys.publicKey,
        },
        btpIdentity: otherClient.identity,
        btpMtsOptions: senderTls,
        maxRetries: 0,
      });

      const { response } = await stolen.command('inbox.fetch', otherClient.identity, { limit: 1 });
      stolen.destroy();

      expect(response?.status).toMatchObject({ code: 401, error: BTP_ERROR_SIG_VERIFICATION.code });
    });
  });

  describe('addresses', () => {
    const lineFrom = async (fields: Partial<BTPTransporterArtifact>) =>
      JSON.stringify({ ...(await invoice(vendor, client.identity, 'INV-ADDR')), ...fields });

    it('refuses an address with a second separator', async () => {
      const answer = await sendRaw(
        clientHost,
        await lineFrom({ from: 'billing$vendor.test$attacker.test' }),
      );

      expect(answer.status).toMatchObject({
        ok: false,
        code: 400,
        error: BTP_ERROR_VALIDATION.code,
      });
    });

    it('refuses an address with a ":", which could make two pairs share a trust id', async () => {
      const answer = await sendRaw(clientHost, await lineFrom({ to: 'pay:x$client.test' }));

      expect(answer.status).toMatchObject({
        ok: false,
        code: 400,
        error: BTP_ERROR_VALIDATION.code,
      });
    });

    it('refuses a look-alike address, such as one with a Cyrillic letter', async () => {
      const answer = await sendRaw(
        clientHost,
        await lineFrom({ from: 'bіlling$vendor.test' }), // Cyrillic і
      );

      expect(answer.status).toMatchObject({
        ok: false,
        code: 400,
        error: BTP_ERROR_VALIDATION.code,
      });
    });

    it('treats an address in capitals as the same address, never a second identity', async () => {
      const artifact = await invoice(
        { ...vendor, identity: vendor.identity.toUpperCase() },
        client.identity,
        'INV-CASE',
      );

      const { response } = await deliver(artifact);

      // Same trust (ids are compared lower-case) and the same published key
      expect(response?.status).toMatchObject({ ok: true, code: 200 });
    });
  });
});
