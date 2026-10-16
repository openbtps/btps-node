/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 addendum item 10 (EBA-122), the defects that live on the server
 * path, over real TLS sockets on 127.0.0.1 with real keys and a real
 * BtpsServer. Nothing is mocked: the agents connect by host, so no DNS is
 * asked. A device is registered as item E has it (#21): a one-time token,
 * then auth.request.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { BtpsServer } from '../btpsServer.js';
import { BtpsAgent } from '../../client/btpsAgent.js';
import { BtpsAuthentication } from '../../core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../core/authentication/storage/InMemoryTokenStore.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPAgentArtifact, BTPTransporterArtifact } from '../../core/server/types.js';
import type { BtpsServerOptions } from '../types.js';

const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';

const vector = (file: string) =>
  JSON.parse(readFileSync(new URL(`../../../test/vectors/${file}`, import.meta.url), 'utf8'));
const invoice = vector('documents/invoice.v2.json');
/** Recorded by the biller about its own invoice: final, needs no answer. */
const paidByBiller = vector('events/paid.by-biller.json');

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

class MapTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  readonly records = new Map<string, BTPTrustRecord>();
  constructor() {
    super({ connection: null, entityName: 'map' });
  }
  async getById(id: string) {
    return this.records.get(id);
  }
  async getBySender() {
    return undefined;
  }
  async create(record: Omit<BTPTrustRecord, 'id'>, id?: string): Promise<BTPTrustRecord> {
    const full = { ...record, id: id! };
    this.records.set(full.id, full);
    return full;
  }
  async update(id: string, patch: Partial<BTPTrustRecord>): Promise<BTPTrustRecord> {
    const next = { ...this.records.get(id)!, ...patch };
    this.records.set(id, next);
    return next;
  }
  async delete(): Promise<void> {}
  async getAll(): Promise<BTPTrustRecord[]> {
    return [...this.records.values()];
  }
}

let workDir: string;
let tlsCert: string;
let tlsKey: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'btps-sdk-defects-'));
  // A throwaway self-signed certificate for 127.0.0.1; clients trust it as their CA.
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      join(workDir, 'key.pem'),
      '-out',
      join(workDir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  tlsCert = readFileSync(join(workDir, 'cert.pem'), 'utf8');
  tlsKey = readFileSync(join(workDir, 'key.pem'), 'utf8');
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

type Started = {
  server: BtpsServer;
  port: number;
  trustStore: MapTrustStore;
  tokenStore: InMemoryTokenStore;
  /** Every agent artifact the application's handler was given. */
  handled: (BTPAgentArtifact & { respondNow: boolean })[];
};

/** A real BtpsServer for the biller's and the payer's domain, listening on 127.0.0.1. */
const startServer = async (options: Partial<BtpsServerOptions> = {}): Promise<Started> => {
  const port = await freePort();
  const trustStore = new MapTrustStore();
  const tokenStore = new InMemoryTokenStore();
  const server = new BtpsServer({
    serverIdentity: { identity: 'server$acme.example', ...genKeys() },
    trustStore,
    tokenStore,
    tlsOptions: { cert: tlsCert, key: tlsKey },
    port,
    connectionTimeoutMs: 5000,
    // No middleware file: keeps the default rate limiter and console noise out.
    middlewarePath: join(workDir, 'no-such-middleware.mjs'),
    ...options,
  });
  const handled: Started['handled'] = [];
  server.onIncomingArtifact('Agent', (artifact) => {
    handled.push(artifact);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await server.start();
  await new Promise((r) => setTimeout(r, 50)); // listen() is not awaited by start()
  return { server, port, trustStore, tokenStore, handled };
};

const connection = (port: number) => ({
  host: '127.0.0.1',
  port,
  btpMtsOptions: { ca: tlsCert },
  connectionTimeoutMs: 5000,
  maxRetries: 0,
});

/** Registers a device for `identity` as item E has it, and returns its agent. */
const registerDevice = async (started: Started, identity: string) => {
  const device = genKeys();
  const auth = new BtpsAuthentication({
    trustStore: started.trustStore,
    tokenStore: started.tokenStore,
  });
  const token = BtpsAuthentication.generateAuthToken(identity);
  await auth.storeAuthToken(token, identity, identity);
  const registered = await BtpsAuthentication.authenticate(
    identity,
    token,
    device,
    { deviceName: 'test' },
    connection(started.port),
  );
  expect(registered.error).toBeUndefined();
  const agentId = registered.response!.document.agentId;
  expect(agentId).toMatch(/^btps_ag_/);
  return new BtpsAgent({
    agent: { id: agentId, identityKey: device.privateKey, identityCert: device.publicKey },
    btpIdentity: identity,
    ...connection(started.port),
  });
};

describe('item 10: a device agent sends through its own server', () => {
  let started: Started | undefined;
  let agents: BtpsAgent[] = [];

  afterEach(() => {
    agents.forEach((a) => a.destroy());
    agents = [];
    started?.server.stop();
    started = undefined;
    vi.restoreAllMocks();
  });

  // Reproduced 2026-10-04: the server validated the agent artifact's
  // document, which is the transporter artifact the device built, against
  // the invoice schema, and refused every one ("Document is required for
  // this action type or document format is invalid").
  it('artifact.send: the server accepts an invoice from a registered device', async () => {
    started = await startServer();
    const agent = await registerDevice(started, BILLER);
    agents.push(agent);

    const { response, error } = await agent.command('artifact.send', PAYER, invoice);

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    expect(started.handled).toHaveLength(1);
    const [artifact] = started.handled;
    expect(artifact).toMatchObject({ action: 'artifact.send', to: BILLER });
    const carried = artifact!.document as BTPTransporterArtifact;
    expect(carried).toMatchObject({ type: 'BTPS_DOC', from: BILLER, to: PAYER });
    expect(carried.document).toEqual(invoice);
  });

  it('event.send: the server accepts a lifecycle event from a registered device', async () => {
    started = await startServer();
    const agent = await registerDevice(started, BILLER);
    agents.push(agent);

    const { response, error } = await agent.command('event.send', PAYER, paidByBiller);

    expect(error).toBeUndefined();
    expect(response?.status).toMatchObject({ ok: true, code: 200 });
    const carried = started.handled[0]!.document as BTPTransporterArtifact;
    expect(carried).toMatchObject({
      type: 'BTPS_EVENT',
      id: paidByBiller.id,
      from: BILLER,
      to: PAYER,
    });
  });
});
