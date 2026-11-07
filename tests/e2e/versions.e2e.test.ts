/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Journey: a 1.1 provider and a 1.2 provider talk. The 1.1 side is the
// published @btps/sdk 1.1.3 from npm, unchanged. Whatever can be said in 1.1
// goes as 1.1.0 and is taken both ways; what only 1.2 has is refused by the
// 1.1 server, and the 1.2 sender is told which version that server speaks.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type tls from 'tls';
import { BtpsServer as BtpsServer11 } from 'btps-sdk-1-1-3/server';
import { BtpsClient as BtpsClient11 } from 'btps-sdk-1-1-3/client';
import { JsonTrustStore as JsonTrustStore11 } from 'btps-sdk-1-1-3/trust';
import { JsonIdentityStore as JsonIdentityStore11 } from 'btps-sdk-1-1-3/storage';
import { signEncrypt as signEncrypt11 } from 'btps-sdk-1-1-3/crypto';
import { BtpsClient } from '../../src/client/btpsClient.js';
import { signEncrypt } from '../../src/core/crypto/index.js';
import { artifactVersion } from '../../src/core/server/constants/index.js';
import { computeId, parseIdentity } from '../../src/core/utils/index.js';
import { BTP_ERROR_VERSION_UNSUPPORTED } from '../../src/core/error/index.js';
import type { AbstractTrustStore } from '../../src/core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '../../src/core/trust/types.js';
import type { BTPTransporterArtifact } from '../../src/core/server/types.js';
import {
  addUser,
  freePort,
  newKeys,
  publishHost,
  publishKey,
  recordTrust,
  senderTls,
  serverTls,
  startProvider,
  type Keys,
  type Provider,
} from './harness.js';

vi.mock('dns/promises', async () => (await import('./zone.js')).dnsModule);

const invoice = (more: object = {}) => ({
  type: 'invoice',
  title: 'October',
  id: `INV-${Math.random().toString(36).slice(2)}`,
  issuedAt: new Date().toISOString(),
  totalAmount: { amount: 150000, currency: 'AUD' },
  lineItems: { columns: ['Item', 'Amount'], rows: [{ Item: 'Website build', Amount: 150000 }] },
  ...more,
});

/** A provider running the published 1.1.3 SDK, as startProvider runs this one. */
async function startProvider11(domain: string) {
  const selector = 'btps1';
  const operator = `admin$${domain}`;
  const operatorKeys = newKeys();
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `btps-1-1-${domain}-`));
  const trustStore = new JsonTrustStore11({ connection: path.join(dir, 'trust.json') });
  const identityStore = new JsonIdentityStore11({ connection: path.join(dir, 'identities.json') });
  const inbox: unknown[] = [];
  const server = new BtpsServer11({
    serverIdentity: { identity: operator, ...operatorKeys },
    trustStore,
    identityStore,
    port,
    tlsOptions: serverTls,
    connectionTimeoutMs: 5000,
  });
  server.onIncomingArtifact('Transporter', async (artifact) => {
    inbox.push(artifact);
  });
  await server.start();
  const listener = server['server'] as tls.Server;
  if (!listener.listening) await new Promise((resolve) => listener.once('listening', resolve));
  publishHost(domain, { port, selector, operator });
  publishKey(operator, selector, operatorKeys.publicKey);
  return {
    domain,
    selector,
    trustStore: trustStore as unknown as AbstractTrustStore<BTPTrustRecord>,
    identityStore,
    inbox,
    stop: () => server.stop(),
  };
}

type Sender = { identity: string; keys: Keys; selector: string };

/** What a 1.2 sender sends: stamped by artifactVersion, encrypted to the receiver. */
const sent12 = async (from: Sender, to: string, document: object) => {
  const { accountName, domainName } = parseIdentity(from.identity)!;
  const { payload, error } = await signEncrypt(
    to,
    { accountName, domainName, pemFiles: from.keys },
    {
      version: artifactVersion({ type: 'BTPS_DOC', document }),
      type: 'BTPS_DOC',
      from: from.identity,
      to,
      selector: from.selector,
      document,
    },
    {
      signature: { algorithmHash: 'sha256' },
      encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
    },
    { btpMtsOptions: senderTls },
  );
  if (error) throw error;
  return payload as unknown as BTPTransporterArtifact;
};

const deliver12 = async (artifact: BTPTransporterArtifact) => {
  const client = new BtpsClient({ to: artifact.to, btpMtsOptions: senderTls, maxRetries: 0 });
  try {
    return await client.send(artifact);
  } finally {
    client.destroy();
  }
};

describe('journey: a 1.2 provider and a 1.1 provider talk', () => {
  let old: Awaited<ReturnType<typeof startProvider11>>;
  let current: Provider;
  let alice: Sender; // on the 1.2 provider
  let bob: Sender; // on the 1.1 provider

  beforeAll(async () => {
    old = await startProvider11('old.test');
    // The 1.2 provider signs every answer, as its own devices expect, with its one key pair:
    // its operator's, which signs its identity-lookup answers too.
    current = await startProvider('new.test', { server: { signAnswers: true } });
    alice = await addUser(current, 'alice');
    bob = { identity: 'bob$old.test', keys: newKeys(), selector: 'btps1' };
    publishKey(bob.identity, bob.selector, bob.keys.publicKey);
    // Each receiver trusts the other sender.
    await recordTrust(old.trustStore, alice.identity, bob.identity, 'accepted');
    await recordTrust(current.trustStore, bob.identity, alice.identity, 'accepted');
  });

  afterAll(() => {
    old.stop();
    current.stop();
  });

  describe('a 1.2 sender and a 1.1 server', () => {
    it('learns the 1.1 server speaks 1.1.0, from its answer to a PING', async () => {
      const client = new BtpsClient({ to: bob.identity, btpMtsOptions: senderTls, maxRetries: 0 });
      const { version, error } = await client.getServerVersion();
      client.destroy();

      expect(error).toBeUndefined();
      expect(version).toBe('1.1.0');
    });

    it('sends what 1.1 can say as 1.1.0, and the 1.1 server takes it', async () => {
      const artifact = await sent12(alice, bob.identity, invoice());
      const { response, error } = await deliver12(artifact);

      expect(artifact.version).toBe('1.1.0');
      expect(error).toBeUndefined();
      expect(response?.status.ok).toBe(true);
      expect(old.inbox).toContainEqual(expect.objectContaining({ id: artifact.id }));
    });

    it('is refused what only 1.2 says, and told the version the 1.1 server speaks', async () => {
      const artifact = await sent12(alice, bob.identity, invoice({ discount: { amount: 500 } }));
      const { error } = await deliver12(artifact);

      expect(artifact.version).toBe('1.2.0');
      expect(error?.code).toBe(BTP_ERROR_VERSION_UNSUPPORTED.code);
      expect(error?.meta).toMatchObject({ receiverVersion: '1.1.0' });
      expect(old.inbox).not.toContainEqual(expect.objectContaining({ id: artifact.id }));
    });

    it('finds a key only the 1.1 host keeps, in an answer its operator signed', async () => {
      const carol = newKeys();
      const now = new Date().toISOString();
      await old.identityStore.create(
        {
          identity: 'carol$old.test',
          currentSelector: 'btps1',
          publicKeys: [
            {
              selector: 'btps1',
              publicKey: carol.publicKey,
              keyType: 'rsa',
              version: '1.1.0',
              createdAt: now,
            },
          ],
          createdAt: now,
        },
        computeId('carol$old.test'),
      );
      const client = new BtpsClient({
        to: 'carol$old.test',
        btpMtsOptions: senderTls,
        maxRetries: 0,
      });
      const { response, error } = await client.resolveIdentity('carol$old.test', alice.identity);
      client.destroy();

      expect(error).toBeUndefined();
      expect(response?.publicKey.trim()).toBe(carol.publicKey.trim());
      expect(response?.serverVersion).toBe('1.1.0');
    });
  });

  describe('a 1.1 sender and a 1.2 server', () => {
    it('sends as 1.1 does, and the 1.2 server takes it, its signed answer read by the 1.1 client', async () => {
      const { accountName, domainName } = parseIdentity(bob.identity)!;
      const document = invoice();
      const { payload, error: signError } = await signEncrypt11(
        alice.identity,
        { accountName, domainName, pemFiles: bob.keys },
        {
          version: '1.1.0',
          type: 'BTPS_DOC',
          from: bob.identity,
          to: alice.identity,
          selector: bob.selector,
          document,
        },
        {
          signature: { algorithmHash: 'sha256' },
          encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
        },
        { btpMtsOptions: senderTls },
      );
      const client = new BtpsClient11({
        to: alice.identity,
        btpMtsOptions: senderTls,
        maxRetries: 0,
      });
      const { response, error } = await client.send(payload as never);
      client.destroy();

      expect(signError).toBeUndefined();
      expect(error).toBeUndefined();
      expect(response?.status.ok).toBe(true);
      expect(response?.version).toBe('1.2.0');
      expect(response?.signedBy).toBe(current.operator);
      expect(current.inbox).toContainEqual(
        expect.objectContaining({ id: (payload as { id: string }).id }),
      );
    });

    it('finds a key only the 1.2 host keeps, from the same server that signs its answers', async () => {
      const dave = await addUser(current, 'dave', 'host');
      const client = new BtpsClient11({
        to: dave.identity,
        btpMtsOptions: senderTls,
        maxRetries: 0,
      });
      const { response, error } = await client.resolveIdentity(dave.identity, bob.identity);
      client.destroy();

      expect(error).toBeUndefined();
      expect(response?.publicKey.trim()).toBe(dave.keys.publicKey.trim());
    });

    it('reads a 1.2 answer that ends the connection, closing and all, as any other', async () => {
      const { accountName, domainName } = parseIdentity(bob.identity)!;
      const { payload } = await signEncrypt11(
        alice.identity,
        { accountName, domainName, pemFiles: bob.keys },
        {
          version: '1.1.0',
          type: 'BTPS_DOC',
          from: bob.identity,
          to: alice.identity,
          selector: bob.selector,
          document: invoice(),
        },
        {
          signature: { algorithmHash: 'sha256' },
          encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
        },
        { btpMtsOptions: senderTls },
      );
      current.use([
        {
          phase: 'before',
          step: 'parsing',
          handler: async (_req, res) => res.sendError({ code: 429, message: 'Slow down' }, 'end'),
        },
      ]);
      const client = new BtpsClient11({
        to: alice.identity,
        btpMtsOptions: senderTls,
        maxRetries: 0,
      });
      try {
        const { response, error } = await client.send(payload as never);

        expect(response?.status).toMatchObject({ ok: false, code: 429, closing: true });
        expect(response?.signedBy).toBe(current.operator);
        expect(error?.message ?? '').not.toMatch(/validation|parse|invalid|signature/i);
      } finally {
        client.destroy();
        current.use([]);
      }
    });
  });

  describe('a 1.2 device and its own provider, with one key pair', () => {
    it("pins the operator, and takes both the provider's signed answers and its lookup answers", async () => {
      const erin = await addUser(current, 'erin', 'host');
      const pinned = new BtpsClient({
        to: alice.identity,
        btpMtsOptions: senderTls,
        maxRetries: 0,
        requireSignedBy: { identity: current.operator, selector: current.selector },
      });
      const { version, error: pingError } = await pinned.getServerVersion();
      const { response, error } = await pinned.resolveIdentity(erin.identity, alice.identity);
      pinned.destroy();

      expect(pingError).toBeUndefined();
      expect(version).toBe('1.2.0');
      expect(error).toBeUndefined();
      expect(response?.publicKey.trim()).toBe(erin.keys.publicKey.trim());
    });
  });
});
