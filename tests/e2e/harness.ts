/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The world the journeys run in: BTPS providers as real BtpsServers over real
// TLS, their DNS records in the zone (./zone.ts), and their users. A provider
// does what a platform does around the SDK and no more: it keeps what arrives,
// records trust as requests and answers come and go, and remembers the
// artifacts it exchanged.

import { execFileSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import tls, { type TLSSocket } from 'tls';
import { BtpsServer } from '../../src/server/btpsServer.js';
import { BtpsClient } from '../../src/client/btpsClient.js';
import JsonTrustStore from '../../src/core/trust/storage/JsonTrustStore.js';
import { AbstractTrustStore } from '../../src/core/trust/storage/AbstractTrustStore.js';
import { JsonIdentityStore } from '../../src/core/storage/JsonIdentityStore.js';
import { computeTrustId } from '../../src/core/trust/index.js';
import { computeId, pemToBase64, parseIdentity } from '../../src/core/utils/index.js';
import {
  getBTPKeyPair,
  getFingerprintFromPem,
  signEncrypt,
  decryptVerify,
} from '../../src/core/crypto/index.js';
import { BTP_PROTOCOL_VERSION } from '../../src/core/server/constants/index.js';
import type { BTPTrustRecord } from '../../src/core/trust/types.js';
import type {
  BTPArtifactType,
  BTPServerResponse,
  BTPTransporterArtifact,
} from '../../src/core/server/types.js';
import type { BTPClientResponse } from '../../src/client/types/index.js';
import type { MiddlewareDefinition } from '../../src/server/types.js';
import { zone } from './zone.js';

export type Keys = { publicKey: string; privateKey: string };

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'btps-e2e-'));

/** One self-signed certificate for localhost, shared by every provider. */
const tlsFiles = (() => {
  const key = path.join(workDir, 'tls-key.pem');
  const cert = path.join(workDir, 'tls-cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  return { key: fs.readFileSync(key, 'utf8'), cert: fs.readFileSync(cert, 'utf8') };
})();

/** TLS options a sender uses: it trusts the providers' certificate. */
export const senderTls = { ca: tlsFiles.cert, servername: 'localhost' };

export const newKeys = (): Keys => getBTPKeyPair();

/** Publishes an identity's key the way BTPS reads it: `<selector>._btps.identity.<account>.<domain>`. */
export const publishKey = (identity: string, selector: string, publicKey: string) => {
  const { accountName, domainName } = parseIdentity(identity)!;
  zone.set(
    `${selector}._btps.identity.${accountName}.${domainName}`,
    `v=${BTP_PROTOCOL_VERSION}; k=rsa; p=${pemToBase64(publicKey)}`,
  );
};

export const unpublishKey = (identity: string, selector: string) => {
  const { accountName, domainName } = parseIdentity(identity)!;
  zone.delete(`${selector}._btps.identity.${accountName}.${domainName}`);
};

/** Publishes a domain's host record: `_btps.host.<domain>`. */
export const publishHost = (
  domain: string,
  record: { port: number; selector: string; operator?: string },
) => {
  const op = record.operator ? `; op=${record.operator}` : '';
  zone.set(
    `_btps.host.${domain}`,
    `v=${BTP_PROTOCOL_VERSION}; u=localhost:${record.port}; s=${record.selector}${op}`,
  );
};

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** A trust store that also knows which artifacts its platform exchanged, as a platform does. */
class PlatformTrustStore extends JsonTrustStore {
  readonly exchanged = new Set<string>();

  remember(artifact: { id: string; from: string; to: string }) {
    this.exchanged.add(`${artifact.id}|${artifact.from}|${artifact.to}`);
  }

  override async isKnownArtifact(query?: { artifactId: string; from: string; to: string }) {
    if (!query) return false;
    const { artifactId, from, to } = query;
    return (
      this.exchanged.has(`${artifactId}|${from}|${to}`) ||
      this.exchanged.has(`${artifactId}|${to}|${from}`)
    );
  }
}

export type Provider = Awaited<ReturnType<typeof startProvider>>;

/**
 * A BTPS provider on its own domain: a BtpsServer over TLS run by its operator
 * (`admin$<domain>`), with its host and operator key published.
 */
export async function startProvider(domain: string, options: { selector?: string } = {}) {
  const selector = options.selector ?? 'btps1';
  const operator = `admin$${domain}`;
  const operatorKeys = newKeys();
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(workDir, `${domain}-`));
  const trustStore = new PlatformTrustStore({ connection: path.join(dir, 'trust.json') });
  const identityStore = new JsonIdentityStore({ connection: path.join(dir, 'identities.json') });
  const inbox: BTPTransporterArtifact[] = [];

  const server = new BtpsServer({
    serverIdentity: { identity: operator, ...operatorKeys },
    trustStore,
    identityStore,
    port,
    tlsOptions: { key: tlsFiles.key, cert: tlsFiles.cert },
    connectionTimeoutMs: 5000,
  });

  // What the platform does with what arrives: keep it, and record trust.
  server.onIncomingArtifact('Transporter', async (artifact) => {
    inbox.push(artifact);
    trustStore.remember(artifact);
    if (artifact.type === 'TRUST_REQ') {
      await recordTrust(trustStore, artifact.from, artifact.to, 'pending');
    }
    if (artifact.type === 'TRUST_RES') {
      const { decision } = artifact.document as { decision: BTPTrustRecord['status'] };
      // The requester's own record of its request, now answered.
      await trustStore.update(computeTrustId(artifact.to, artifact.from), { status: decision });
    }
  });

  await server.start();
  const listener = server['server'] as tls.Server;
  if (!listener.listening) await new Promise((resolve) => listener.once('listening', resolve));

  publishHost(domain, { port, selector, operator });
  publishKey(operator, selector, operatorKeys.publicKey);

  return {
    domain,
    operator,
    operatorKeys,
    selector,
    port,
    server,
    trustStore,
    identityStore,
    inbox,
    /** Middleware the provider runs, as its middleware file would give it. */
    use(middleware: MiddlewareDefinition[]) {
      server['middlewareManager']['middleware'] = middleware;
    },
    stop() {
      server.stop();
    },
  };
}

/** A trust record as a platform stores it, with the sender's published key. */
export async function recordTrust(
  store: AbstractTrustStore<BTPTrustRecord>,
  senderId: string,
  receiverId: string,
  status: BTPTrustRecord['status'],
  extra: Partial<BTPTrustRecord> = {},
) {
  const id = computeTrustId(senderId, receiverId);
  const now = new Date().toISOString();
  const record: Omit<BTPTrustRecord, 'id'> = {
    senderId,
    receiverId,
    status,
    createdAt: now,
    decidedBy: receiverId,
    decidedAt: now,
    publicKeyBase64: '',
    publicKeyFingerprint: '',
    keyHistory: [],
    privacyType: 'encrypted',
    ...extra,
  };
  if (await store.getById(id)) return store.update(id, record);
  return store.create(record, id);
}

export type User = {
  identity: string;
  keys: Keys;
  selector: string;
  provider: Provider;
};

/**
 * A user of a provider. `published: 'dns'` publishes the user's own key in
 * DNS; `'host'` keeps it only in the provider's identity store, found through
 * the host.
 */
export async function addUser(
  provider: Provider,
  account: string,
  published: 'dns' | 'host' = 'dns',
): Promise<User> {
  const identity = `${account}$${provider.domain}`;
  const keys = newKeys();
  if (published === 'dns') {
    publishKey(identity, provider.selector, keys.publicKey);
  } else {
    await provider.identityStore.create(
      {
        identity,
        currentSelector: provider.selector,
        publicKeys: [
          {
            selector: provider.selector,
            publicKey: keys.publicKey,
            keyType: 'rsa',
            version: BTP_PROTOCOL_VERSION,
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
      },
      computeId(identity),
    );
  }
  return { identity, keys, selector: provider.selector, provider };
}

/** An artifact `from` signs, encrypted to `to` unless `encrypt` is false. */
export async function artifactFrom(
  from: User,
  to: string,
  type: BTPArtifactType,
  document: unknown,
  options: { encrypt?: boolean; extra?: Record<string, unknown> } = {},
) {
  const { accountName, domainName } = parseIdentity(from.identity)!;
  const { payload, error } = await signEncrypt(
    to,
    { accountName, domainName, pemFiles: from.keys },
    {
      version: BTP_PROTOCOL_VERSION,
      type,
      from: from.identity,
      to,
      selector: from.selector,
      document,
      ...options.extra,
    },
    {
      signature: { algorithmHash: 'sha256' },
      ...(options.encrypt === false
        ? {}
        : { encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' } }),
    },
  );
  if (error) throw error;
  return payload as unknown as BTPTransporterArtifact;
}

/** Sends an artifact to its receiver's host the way any sender does: DNS, then TLS. */
export async function deliver(artifact: BTPTransporterArtifact): Promise<BTPClientResponse> {
  const client = new BtpsClient({ to: artifact.to, btpMtsOptions: senderTls, maxRetries: 0 });
  try {
    return await client.send(artifact);
  } finally {
    client.destroy();
  }
}

/** Opens what arrived for `receiver`, as its platform does when the user views it. */
export async function open<T>(receiver: User, artifact: BTPTransporterArtifact) {
  const sender = await import('../../src/core/utils/index.js').then((u) =>
    u.resolvePublicKey(artifact.from, artifact.selector),
  );
  if (!sender) throw new Error(`no key for ${artifact.from}`);
  return decryptVerify<T>(
    sender,
    artifact as unknown as Parameters<typeof decryptVerify<T>>[1],
    receiver.keys.privateKey,
  );
}

/** Writes one raw line to a provider over TLS and reads the first answer: for what a client would never send. */
export function sendRaw(provider: Provider, line: string): Promise<BTPServerResponse> {
  return new Promise((resolve, reject) => {
    const socket: TLSSocket = tls.connect({ ...senderTls, host: 'localhost', port: provider.port });
    let received = '';
    socket.on('data', (data) => {
      received += data;
      const end = received.indexOf('\n');
      if (end !== -1) {
        socket.end();
        resolve(JSON.parse(received.slice(0, end)));
      }
    });
    socket.on('error', reject);
    socket.on('secureConnect', () => socket.write(line.endsWith('\n') ? line : `${line}\n`));
  });
}

/** The fingerprint a trust record keeps of a sender's key. */
export const fingerprintOf = (publicKey: string) => getFingerprintFromPem(publicKey, 'sha256');

export const invoiceDocument = (overrides: Record<string, unknown> = {}) => ({
  type: 'invoice',
  title: 'Website build',
  id: 'INV-001',
  issuedAt: '2026-10-01T00:00:00.000Z',
  totalAmount: { amount: 150000, currency: 'AUD' },
  lineItems: {
    columns: ['Item', 'Amount'],
    rows: [{ Item: 'Website build', Amount: 150000 }],
  },
  ...overrides,
});
