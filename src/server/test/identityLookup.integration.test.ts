/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Identity lookup, end to end over real TLS sockets on 127.0.0.1.
 *
 * The existing server and client suites mock `tls`, so nothing has exercised
 * the lookup path as a sender uses it: ask a SaaS host for the public key of
 * one of its users (docs/protocol/identityRecord.md). These tests do. Only
 * DNS is faked. Each test states the behaviour the protocol documents; the
 * ones that fail today name the defect they expose.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import net from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import tls from 'tls';
import { resolveTxt } from 'dns/promises';

import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import { getBTPKeyPair, signBtpPayload } from '@core/crypto/index.js';
import { JsonIdentityStore } from '@core/storage/JsonIdentityStore.js';
import type { BTPIdentityRecord, IdentityPubKeyRecord } from '@core/storage/types.js';
import type { AbstractIdentityStore } from '@core/storage/AbstractIdentityStore.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import type { BTPServerResponse } from '@core/server/types.js';
import { BtpServerResponseSchema } from '@core/server/schemas/responseSchema.js';
import { pemToBase64 } from '@core/utils/index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const mockResolveTxt = vi.mocked(resolveTxt);

const HOST_IDENTITY = 'admin$saas.test';
const USER_IDENTITY = 'alice$saas.test';
const REQUESTER = 'billing$vendor.test';
const SELECTOR = 'btps1';

const hostKeys = getBTPKeyPair();
const aliceKeys = getBTPKeyPair();

const alicePubKeyRecord: IdentityPubKeyRecord = {
  selector: SELECTOR,
  publicKey: aliceKeys.publicKey,
  keyType: 'rsa',
  version: '1.0.0',
  createdAt: '2026-10-11T00:00:00.000Z',
};

let workDir: string;
let tlsCert: string;
let tlsKey: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'btps-identity-lookup-'));
  // A throwaway self-signed certificate for 127.0.0.1; clients below do not
  // verify it. Node cannot mint X.509 itself, so openssl does.
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

const emptyTrustStore = {
  getById: async () => undefined,
  getAll: async () => [],
} as unknown as AbstractTrustStore<BTPTrustRecord>;

const lookupRequest = () => ({
  version: '1.0.0',
  id: 'lookup-1',
  issuedAt: new Date().toISOString(),
  identity: USER_IDENTITY,
  from: REQUESTER,
  hostSelector: SELECTOR,
});

/** Sends one line to a BTPS host and resolves with the first reply line, or
 * with `null` if the host closes the connection without replying. */
const sendLine = (port: number, payload: unknown): Promise<Record<string, unknown> | null> =>
  new Promise((resolve, reject) => {
    let buffered = '';
    const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => {
      socket.write(JSON.stringify(payload) + '\n');
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 4000);
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      const newline = buffered.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      socket.destroy();
      resolve(JSON.parse(buffered.slice(0, newline)));
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(null);
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

describe('identity lookup served by BtpsServer', () => {
  let server: BtpsServer | undefined;

  const startServer = async (identityStore: AbstractIdentityStore<BTPIdentityRecord>) => {
    const port = await freePort();
    server = new BtpsServer({
      serverIdentity: {
        identity: HOST_IDENTITY,
        publicKey: hostKeys.publicKey,
        privateKey: hostKeys.privateKey,
      },
      trustStore: emptyTrustStore,
      identityStore,
      tlsOptions: { cert: tlsCert, key: tlsKey },
      port,
      connectionTimeoutMs: 3000,
      // No middleware file: keeps the default rate limiter and console noise out.
      middlewarePath: join(workDir, 'no-such-middleware.mjs'),
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await server.start();
    await new Promise((r) => setTimeout(r, 50)); // listen() is not awaited by start()
    return port;
  };

  afterEach(() => {
    server?.stop();
    server = undefined;
    vi.restoreAllMocks();
  });

  // Defect: handleIdentityLookup passes computeId(identity) to
  // getPublicKeyRecord, and JsonIdentityStore.getPublicKeyRecord hashes its
  // argument again, so a stored identity is never found.
  it('finds an identity that is in the identity store', async () => {
    const store = new JsonIdentityStore({ connection: join(workDir, 'identities.json') });
    await store.create(
      {
        identity: USER_IDENTITY,
        currentSelector: SELECTOR,
        publicKeys: [alicePubKeyRecord],
        createdAt: alicePubKeyRecord.createdAt,
      },
      USER_IDENTITY,
    );
    await store.flushNow(); // no debounced write left to fire after the suite's cleanup
    // The store itself is sound: asked by identity, it returns the key.
    expect((await store.getPublicKeyRecord(USER_IDENTITY))?.publicKey).toBe(aliceKeys.publicKey);

    const port = await startServer(store);
    const reply = await sendLine(port, lookupRequest());

    expect(reply, 'the host closed the connection without replying').not.toBeNull();
    expect(
      reply?.status,
      'the host answered "Identity not found" for a stored identity',
    ).toMatchObject({ ok: true });
  });

  // Defect: the reply's `document` is a key record, which
  // BtpServerResponseSchema does not allow, so sendBtpsResponse fails its own
  // validation and destroys the socket instead of answering.
  it('answers a lookup with the signed key record', async () => {
    // A store that returns the record whatever id it is asked with, so this
    // test does not depend on the defect above.
    const store = {
      getPublicKeyRecord: async () => alicePubKeyRecord,
    } as unknown as AbstractIdentityStore<BTPIdentityRecord>;

    const port = await startServer(store);
    const reply = await sendLine(port, lookupRequest());

    expect(reply, 'the host closed the connection without replying').not.toBeNull();
    expect(reply).toMatchObject({
      type: 'btps_response',
      reqId: 'lookup-1',
      signedBy: HOST_IDENTITY,
      selector: SELECTOR,
      document: { selector: SELECTOR, publicKey: aliceKeys.publicKey, keyType: 'rsa' },
    });
    expect(reply?.signature).toBeDefined();
  });

  // The same defect, isolated from sockets: the documented identity response
  // (docs/protocol/specifications/responses.md, "Identity Response Document")
  // must be a valid server response.
  it('the response schema accepts an identity lookup response', () => {
    const { createdAt, ...document } = alicePubKeyRecord;
    const unsigned = {
      version: '1.0.0',
      status: { ok: true, code: 200, message: 'success' },
      id: 'response-1',
      issuedAt: new Date().toISOString(),
      type: 'btps_response' as const,
      reqId: 'lookup-1',
      selector: SELECTOR,
      document,
      signedBy: HOST_IDENTITY,
    };
    const result = BtpServerResponseSchema.safeParse({
      ...unsigned,
      signature: signBtpPayload(unsigned, hostKeys),
    });

    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('BtpsClient.resolveIdentity against a host that answers correctly', () => {
  let host: tls.Server | undefined;
  let lookupsReceived = 0;
  const openSockets = new Set<tls.TLSSocket>();

  /** A stand-in host: answers every identity lookup with a correctly signed
   * key record and leaves the connection open, as a well-behaved host may. */
  const startHost = async () => {
    const port = await freePort();
    lookupsReceived = 0;
    host = tls.createServer({ cert: tlsCert, key: tlsKey }, (socket) => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
      socket.on('error', () => {});
      socket.once('data', (chunk) => {
        lookupsReceived += 1;
        const request = JSON.parse(chunk.toString());
        const { createdAt, ...document } = alicePubKeyRecord;
        const unsigned = {
          version: '1.0.0',
          status: { ok: true, code: 200, message: 'success' },
          id: 'response-1',
          issuedAt: new Date().toISOString(),
          type: 'btps_response',
          reqId: request.id,
          selector: request.hostSelector,
          document,
          signedBy: HOST_IDENTITY,
        };
        socket.write(
          JSON.stringify({ ...unsigned, signature: signBtpPayload(unsigned, hostKeys) }) + '\n',
        );
      });
    });
    await new Promise<void>((resolve) => host!.listen(port, '127.0.0.1', resolve));
    return port;
  };

  const hostKeyTxt = [[`v=1.0.0; k=rsa; p=${pemToBase64(hostKeys.publicKey)}`]];
  const isHostKeyName = (name: string) => name === `${SELECTOR}._btps.identity.admin.saas.test`;

  const client = (port: number) =>
    new BtpsClient({
      to: USER_IDENTITY,
      host: '127.0.0.1',
      port,
      hostSelector: SELECTOR,
      btpMtsOptions: { rejectUnauthorized: false },
    });

  afterEach(async () => {
    openSockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => (host ? host.close(() => resolve()) : resolve()));
    host = undefined;
    mockResolveTxt.mockReset();
  });

  // Defect: resolveIdentity registers its listeners inside a try whose
  // `finally` destroys the socket straight away, so the reply never arrives
  // and the caller gets "Connection closed".
  it('returns the key the host serves when DNS has no record for the identity', async () => {
    // A SaaS user has no DNS record of their own; the host's key is in DNS.
    mockResolveTxt.mockImplementation(async (name: string) =>
      isHostKeyName(name) ? hostKeyTxt : [],
    );
    const port = await startHost();

    const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
    expect(response?.publicKey).toBe(aliceKeys.publicKey);
    expect(lookupsReceived).toBe(1);
  });

  // Related: a resolver reports a missing TXT record by rejecting (ENODATA or
  // ENOTFOUND), not by returning an empty list. getDnsIdentityParts rethrows
  // that, so resolveIdentity returns the DNS error and never asks the host.
  it('asks the host when the DNS query for the identity fails with ENODATA', async () => {
    mockResolveTxt.mockImplementation(async (name: string) => {
      if (isHostKeyName(name)) return hostKeyTxt;
      throw Object.assign(new Error(`queryTxt ENODATA ${name}`), { code: 'ENODATA' });
    });
    const port = await startHost();

    const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(lookupsReceived, 'the host was never asked').toBe(1);
    expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
    expect(response?.publicKey).toBe(aliceKeys.publicKey);
  });

  // Defect: before verifying, the client rebuilds the response with
  // `encryption: msg.encryption ?? null`. A host signs its response without an
  // `encryption` member (and the response schema refuses `encryption: null`),
  // so the client verifies bytes the host never signed. This is the same code
  // in resolveIdentity and in verifyServerMessage, so it affects every signed
  // response, not only lookups.
  it('accepts a correctly signed, unencrypted response from the host', async () => {
    mockResolveTxt.mockImplementation(async (name: string) =>
      isHostKeyName(name) ? hostKeyTxt : [],
    );
    class ProbeClient extends BtpsClient {
      check(msg: BTPServerResponse) {
        return this.verifyServerMessage(msg);
      }
    }
    const unsigned = {
      version: '1.0.0',
      status: { ok: true, code: 200, message: 'success' },
      id: 'response-2',
      issuedAt: new Date().toISOString(),
      type: 'btps_response' as const,
      reqId: 'request-2',
      selector: SELECTOR,
      document: 'ok',
      signedBy: HOST_IDENTITY,
    };
    const signed = { ...unsigned, signature: signBtpPayload(unsigned, hostKeys) };
    // The message is one this SDK's own server may send.
    expect(BtpServerResponseSchema.safeParse(signed).success).toBe(true);

    const probe = new ProbeClient({
      to: USER_IDENTITY,
      host: '127.0.0.1',
      port: 1,
      hostSelector: SELECTOR,
    });
    const { isValid, error } = await probe.check(signed);

    expect(error, `verification failed: ${error?.message}`).toBeUndefined();
    expect(isValid).toBe(true);
  });
});
