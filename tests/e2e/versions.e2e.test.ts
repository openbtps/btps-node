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
import { createHash, randomUUID } from 'crypto';
import { BtpsClient } from '../../src/client/btpsClient.js';
import { signEncrypt } from '../../src/core/crypto/index.js';
import { canonicalizeValue } from '../../src/core/crypto/jcs.js';
import { artifactVersion } from '../../src/core/server/constants/index.js';
import { DETAIL_PERMISSIONS } from '../../src/core/server/constants/permissions.js';
import { composeTrustRequestFor } from '../../src/core/trust/shaping.js';
import { computeId, parseIdentity } from '../../src/core/utils/index.js';
import {
  BTPErrorException,
  BTP_ERROR_RATE_LIMITER,
  BTP_ERROR_VERSION_UNSUPPORTED,
} from '../../src/core/error/index.js';
import type { AbstractTrustStore } from '../../src/core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '../../src/core/trust/types.js';
import type { BTPArtifactType, BTPTransporterArtifact } from '../../src/core/server/types.js';
import type { MiddlewareDefinition } from '../../src/server/types.js';
import {
  addUser,
  freePort,
  invoiceDocument,
  letterDocument,
  newKeys,
  payslipDocument,
  publishHost,
  publishKey,
  receiptDocument,
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

// Every document type, every permission and each 1.2 addition, across
// versions. A 1.1 peer knows no permissions, so a trust with it is a 1.1
// trust: every type 1.1 knows goes, and what only 1.2 says is refused with
// the version the 1.1 server speaks, or shaped as 1.1 allows.
describe('journey: every document type and permission between 1.1 and 1.2', () => {
  let old: Awaited<ReturnType<typeof startProvider11>>;
  let current: Provider;
  let alice: Sender; // on the 1.2 provider
  let bob: Sender; // on the 1.1 provider

  const agreement = (
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../test/vectors/agreements.vectors.json'),
        'utf8',
      ),
    ) as { documents: { name: string; expect: string; document: object }[] }
  ).documents.find((c) => c.name === 'agreement' && c.expect === 'accept')!.document;

  // What 1.1 knows, each as 1.1 can say it.
  const KNOWN_TO_11: [string, object][] = [
    ['invoice', invoiceDocument()],
    ['receipt', receiptDocument()],
    ['payslip', payslipDocument()],
    ['letter', letterDocument()],
  ];

  /** What a 1.2 sender sends of any type: stamped by artifactVersion, encrypted to the receiver. */
  const sentAny = async (
    from: Sender,
    to: string,
    type: BTPArtifactType,
    document: object,
    extra: object = {},
  ) => {
    const { accountName, domainName } = parseIdentity(from.identity)!;
    const unsigned = { type, from: from.identity, to, selector: from.selector, document, ...extra };
    const { payload, error } = await signEncrypt(
      to,
      { accountName, domainName, pemFiles: from.keys },
      { version: artifactVersion(unsigned), ...unsigned },
      {
        signature: { algorithmHash: 'sha256' },
        encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
      },
      { btpMtsOptions: senderTls },
    );
    if (error) throw error;
    return payload as unknown as BTPTransporterArtifact;
  };

  /** What a 1.1 sender sends, with the published 1.1.3 SDK, end to end. */
  const sent11 = async (from: Sender, to: string, type: string, document: object, extra = {}) => {
    const { accountName, domainName } = parseIdentity(from.identity)!;
    const { payload, error } = await signEncrypt11(
      to,
      { accountName, domainName, pemFiles: from.keys },
      {
        version: '1.1.0',
        type,
        from: from.identity,
        to,
        selector: from.selector,
        document,
        ...extra,
      },
      {
        signature: { algorithmHash: 'sha256' },
        encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
      },
      { btpMtsOptions: senderTls },
    );
    if (error) throw error;
    const client = new BtpsClient11({ to, btpMtsOptions: senderTls, maxRetries: 0 });
    try {
      return {
        payload: payload as unknown as BTPTransporterArtifact,
        ...(await client.send(payload as never)),
      };
    } finally {
      client.destroy();
    }
  };

  const sender = (identity: string): Sender => {
    const keys = newKeys();
    publishKey(identity, 'btps1', keys.publicKey);
    return { identity, keys, selector: 'btps1' };
  };

  beforeAll(async () => {
    old = await startProvider11('old11.test');
    current = await startProvider('new12.test');
    alice = await addUser(current, 'alice');
    bob = sender('bob$old11.test');
    // A trust with a 1.1 peer is a 1.1 trust: it names no permissions.
    await recordTrust(old.trustStore, alice.identity, bob.identity, 'accepted');
    await recordTrust(current.trustStore, bob.identity, alice.identity, 'accepted');
  });

  afterAll(() => {
    old.stop();
    current.stop();
  });

  describe('from a 1.2 sender to a 1.1 server', () => {
    for (const [type, document] of KNOWN_TO_11) {
      it(`delivers ${type === 'invoice' ? 'an' : 'a'} ${type}, stamped 1.1.0`, async () => {
        const artifact = await sentAny(alice, bob.identity, 'BTPS_DOC', document);
        const { response, error } = await deliver12(artifact);

        expect(artifact.version).toBe('1.1.0');
        expect(error).toBeUndefined();
        expect(response?.status.ok).toBe(true);
        expect(old.inbox).toContainEqual(expect.objectContaining({ id: artifact.id }));
      });
    }

    const onlyIn12: [string, BTPArtifactType, object, object?][] = [
      ['an agreement', 'BTPS_DOC', agreement],
      [
        'an invoice naming its documentType',
        'BTPS_DOC',
        invoiceDocument(),
        { documentType: 'invoice' },
      ],
      ['an invoice with a discount', 'BTPS_DOC', invoiceDocument({ discount: { amount: 500 } })],
      [
        'an invoice whose note says its format',
        'BTPS_DOC',
        invoiceDocument({ description: { format: 'markdown', content: '**Thanks**' } }),
      ],
      ...DETAIL_PERMISSIONS.map((name): [string, BTPArtifactType, object, object] => [
        `a request for ${name}`,
        'DETAILS_REQ',
        {},
        { details: [name] },
      ]),
    ];
    for (const [label, type, document, extra] of onlyIn12) {
      it(`is refused ${label}, stamped 1.2.0, and told the 1.1 server's version`, async () => {
        const artifact = await sentAny(alice, bob.identity, type, document, extra);
        const { error, response } = await deliver12(artifact);

        expect(artifact.version).toBe('1.2.0');
        if (type === 'DETAILS_REQ') {
          // 1.1 has no details refresh: its server refuses the artifact type itself, before its version.
          expect(response?.status).toMatchObject({
            ok: false,
            code: 400,
            error: 'BTP_ERROR_VALIDATION',
          });
        } else {
          expect(error?.code).toBe(BTP_ERROR_VERSION_UNSUPPORTED.code);
          expect(error?.meta).toMatchObject({ receiverVersion: '1.1.0' });
        }
        expect(old.inbox).not.toContainEqual(expect.objectContaining({ id: artifact.id }));
      });
    }

    it('shapes a trust request with permissions as 1.1 allows, and the 1.1 server takes it', async () => {
      const carol = sender('carol$old11.test');
      const unsigned = {
        version: '1.2.0',
        type: 'TRUST_REQ' as const,
        from: alice.identity,
        to: carol.identity,
        selector: alice.selector,
        permissions: [
          { name: 'send:invoice', required: true },
          { name: 'detail:email', required: false },
        ],
        entityType: 'person',
        given: ['detail:email'],
        document: {
          id: 'req-shaped',
          name: 'Alice',
          email: 'alice@new12.test',
          reason: 'Invoices',
          phone: '+61 400 000 002',
        },
      };
      const composed = await composeTrustRequestFor(carol.identity, unsigned, {
        btpMtsOptions: senderTls,
      });
      if (composed.error) throw composed.error;
      const { accountName, domainName } = parseIdentity(alice.identity)!;
      const { payload, error: signError } = await signEncrypt(
        carol.identity,
        { accountName, domainName, pemFiles: alice.keys },
        composed.payload,
        {
          signature: { algorithmHash: 'sha256' },
          encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
        },
        { btpMtsOptions: senderTls },
      );
      const { response } = await deliver12(payload as unknown as BTPTransporterArtifact);

      expect(signError).toBeUndefined();
      expect(composed.shaped).toEqual({
        sentAs: '1.1.0',
        leftOut: ['permissions', 'given', 'entityType'],
      });
      expect(response?.status.ok).toBe(true);
      expect(old.inbox).toContainEqual(
        expect.objectContaining({ type: 'TRUST_REQ', from: alice.identity, version: '1.1.0' }),
      );
    });
  });

  describe('from a 1.1 sender to a 1.2 server', () => {
    for (const [type, document] of KNOWN_TO_11) {
      it(`takes ${type === 'invoice' ? 'an' : 'a'} ${type} sent with the published 1.1.3 SDK`, async () => {
        const { payload, response, error } = await sent11(
          bob,
          alice.identity,
          'BTPS_DOC',
          document,
        );

        expect(error).toBeUndefined();
        expect(response?.status.ok).toBe(true);
        expect(current.inbox).toContainEqual(expect.objectContaining({ id: payload.id }));
      });
    }

    it('takes a 1.1 event about an invoice the two exchanged', async () => {
      const invoice = await sentAny(alice, bob.identity, 'BTPS_DOC', invoiceDocument());
      expect((await deliver12(invoice)).response?.status.ok).toBe(true);
      // The 1.2 platform records what it sent, as it records what arrives.
      current.trustStore.remember(invoice);
      const paidId = randomUUID();
      const { response, error } = await sent11(
        bob,
        alice.identity,
        'BTPS_EVENT',
        {
          type: 'lifecycle_event',
          id: paidId,
          occurredAt: new Date().toISOString(),
          document: {
            from: alice.identity,
            id: invoice.id,
            sha256: createHash('sha256').update(canonicalizeValue(invoice)).digest('hex'),
          },
          eventType: 'paid',
        },
        { id: paidId, relatesTo: invoice.id },
      );

      expect(error).toBeUndefined();
      expect(response?.status.ok).toBe(true);
      expect(current.inbox).toContainEqual(expect.objectContaining({ id: paidId }));
    });

    it('takes a 1.1 trust request from a sender it has no trust with', async () => {
      const dan = sender('dan$old11.test');
      const { payload, response, error } = await sent11(dan, alice.identity, 'TRUST_REQ', {
        id: 'req-11',
        name: 'Dan',
        email: 'dan@old11.test',
        reason: 'Invoices',
        phone: '+61 400 000 003',
      });

      expect(error).toBeUndefined();
      expect(response?.status.ok).toBe(true);
      expect(current.inbox).toContainEqual(expect.objectContaining({ id: payload.id }));
    });

    it('hands a 1.1 client a 429 with retryAfter it can read', async () => {
      const eve = sender('eve$old11.test');
      await recordTrust(current.trustStore, eve.identity, alice.identity, 'accepted');
      const limitEve: MiddlewareDefinition<'after', 'trustVerification'> = {
        phase: 'after',
        step: 'trustVerification',
        handler: async (req, res, next) => {
          const { data } = req;
          if (data.type === 'transporter' && data.artifact.from === eve.identity) {
            return res.sendError(
              new BTPErrorException(BTP_ERROR_RATE_LIMITER, { meta: { retryAfter: 30 } }),
            );
          }
          return next();
        },
      };
      current.use([limitEve as MiddlewareDefinition]);
      try {
        const { response, error } = await sent11(
          eve,
          alice.identity,
          'BTPS_DOC',
          invoiceDocument(),
        );

        expect(response?.status).toMatchObject({
          ok: false,
          code: 429,
          error: BTP_ERROR_RATE_LIMITER.code,
        });
        expect(error?.message ?? '').not.toMatch(/validation|parse|invalid/i);
      } finally {
        current.use([]);
      }
    });
  });
});
