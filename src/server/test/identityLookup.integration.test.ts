/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Identity lookup (fix list 1, EBA-442; fix list 9, EBA-186), over real TLS
 * sockets on 127.0.0.1 with real keys. Only DNS is faked.
 *
 * Key lookup is DNS first: the address's own record at
 * `<selector>._btps.identity.<account>.<domain>`. When there is none, the
 * client asks the address's host, which answers from its identity store with
 * a response signed by its own key, published in DNS under the same domain.
 * Adapted from branch test/identity-lookup-failing (7a98259) to BTPS 1.1:
 * JCS signing, `signatureSelector`, the async signer.
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
import type { BTPKeyPair } from '@core/crypto/types.js';
import { JsonIdentityStore } from '@core/storage/JsonIdentityStore.js';
import type { BTPIdentityRecord, IdentityPubKeyRecord } from '@core/storage/types.js';
import type { AbstractIdentityStore } from '@core/storage/AbstractIdentityStore.js';
import type { AbstractTrustStore } from '@core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '@core/trust/types.js';
import type { BTPServerResponse } from '@core/server/types.js';
import { BtpServerResponseSchema } from '@core/server/schemas/responseSchema.js';
import { BTP_PROTOCOL_VERSION } from '@core/server/constants/index.js';
import { pemToBase64 } from '@core/utils/index.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const mockResolveTxt = vi.mocked(resolveTxt);

const DOMAIN = 'saas.test';
const HOST_IDENTITY = `admin$${DOMAIN}`;
const USER_IDENTITY = `alice$${DOMAIN}`;
const REQUESTER = 'billing$vendor.test';
/** The selector the address's domain publishes in `_btps.host` (`s=`). */
const DOMAIN_SELECTOR = 'btps1';
/** The host's own key, at its own selector: not the one a request names. */
const HOST_SELECTOR = 'host7';

const hostKeys = getBTPKeyPair();
const aliceKeys = getBTPKeyPair();

const keyRecord = (keys: { publicKey: string }, selector = DOMAIN_SELECTOR) =>
  ({
    selector,
    publicKey: keys.publicKey,
    keyType: 'rsa',
    version: BTP_PROTOCOL_VERSION,
    createdAt: '2026-10-11T00:00:00.000Z',
  }) satisfies IdentityPubKeyRecord;

/** A TXT identity record as a resolver returns it: split into strings of at most 255 characters. */
const keyTxt = (publicKey: string): string[][] => {
  const record = `v=${BTP_PROTOCOL_VERSION}; k=rsa; p=${pemToBase64(publicKey)}`;
  return [record.match(/.{1,255}/g)!];
};

const identityName = (identity: string, selector: string) => {
  const [account, domain] = identity.split('$');
  return `${selector}._btps.identity.${account}.${domain}`;
};

const dnsError = (name: string, code: 'ENOTFOUND' | 'ENODATA' | 'ESERVFAIL') =>
  Object.assign(new Error(`queryTxt ${code} ${name}`), { code });

/** Fakes DNS: the named TXT records exist; any other name has none (`missing`). */
const publishDns = (
  records: Record<string, string[][]>,
  missing: 'ENOTFOUND' | 'ENODATA' | 'empty' = 'ENOTFOUND',
) => {
  mockResolveTxt.mockImplementation(async (name: string) => {
    const found = records[name];
    if (found) return found;
    if (missing === 'empty') return [];
    throw dnsError(name, missing);
  });
};

let workDir: string;
let tlsCert: string;
let tlsKey: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'btps-identity-lookup-'));
  // A throwaway self-signed certificate for 127.0.0.1. Node cannot mint
  // X.509 itself, so openssl does. Clients below trust it as their CA, so
  // TLS is verified, not switched off.
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

const emptyTrustStore = {
  getById: async () => undefined,
  getAll: async () => [],
} as unknown as AbstractTrustStore<BTPTrustRecord>;

const lookupRequest = () => ({
  version: BTP_PROTOCOL_VERSION,
  id: 'lookup-1',
  issuedAt: new Date().toISOString(),
  identity: USER_IDENTITY,
  from: REQUESTER,
  hostSelector: DOMAIN_SELECTOR,
});

/** Sends one line to a BTPS host and resolves with the first reply line, or
 * with `null` if the host closes the connection without replying. */
const sendLine = (port: number, payload: unknown): Promise<Record<string, unknown> | null> =>
  new Promise((resolve, reject) => {
    let buffered = '';
    const socket = tls.connect({ host: '127.0.0.1', port, ca: tlsCert }, () => {
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

const jsonStore = async (records: Array<{ identity: string; keys: { publicKey: string } }>) => {
  const store = new JsonIdentityStore({
    connection: join(workDir, `identities-${Math.random().toString(36).slice(2)}.json`),
  });
  for (const { identity, keys } of records) {
    await store.create(
      {
        identity,
        currentSelector: DOMAIN_SELECTOR,
        publicKeys: [keyRecord(keys)],
        createdAt: '2026-10-11T00:00:00.000Z',
      },
      identity,
    );
  }
  await store.flushNow(); // no debounced write left to fire after the suite's cleanup
  return store;
};

/** A real BtpsServer for `saas.test`, listening on 127.0.0.1. */
const startBtpsServer = async (
  identityStore: AbstractIdentityStore<BTPIdentityRecord>,
  keys: BTPKeyPair | { publicKey: string; privateKey: string } = hostKeys,
) => {
  const port = await freePort();
  const server = new BtpsServer({
    serverIdentity: {
      identity: HOST_IDENTITY,
      selector: HOST_SELECTOR,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
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
  return { server, port };
};

describe('identity lookup served by BtpsServer', () => {
  let server: BtpsServer | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;
    vi.restoreAllMocks();
  });

  // Defect 1: handleIdentityLookup passed computeId(identity) to
  // getPublicKeyRecord, and JsonIdentityStore.getPublicKeyRecord hashes its
  // argument again, so a stored identity was never found.
  it('finds an identity that is in the identity store', async () => {
    const store = await jsonStore([{ identity: USER_IDENTITY, keys: aliceKeys }]);
    // The store itself is sound: asked by identity, it returns the key.
    expect((await store.getPublicKeyRecord(USER_IDENTITY))?.publicKey).toBe(aliceKeys.publicKey);

    const started = await startBtpsServer(store);
    server = started.server;
    const reply = await sendLine(started.port, lookupRequest());

    expect(reply, 'the host closed the connection without replying').not.toBeNull();
    expect(
      reply?.status,
      'the host answered "Identity not found" for a stored identity',
    ).toMatchObject({ ok: true });
  });

  // Defect 2: the reply's `document` is a key record, which
  // BtpServerResponseSchema did not allow, so sendBtpsResponse failed its own
  // validation and destroyed the socket instead of answering. The response
  // names the host's own selector, not the one the request carried.
  it('answers a lookup with the key record, signed at the host selector', async () => {
    // A store that returns the record whatever id it is asked with, so this
    // test does not depend on defect 1.
    const store = {
      getPublicKeyRecord: async () => keyRecord(aliceKeys),
    } as unknown as AbstractIdentityStore<BTPIdentityRecord>;

    const started = await startBtpsServer(store);
    server = started.server;
    const reply = await sendLine(started.port, lookupRequest());

    expect(reply, 'the host closed the connection without replying').not.toBeNull();
    expect(reply).toMatchObject({
      type: 'btps_response',
      reqId: 'lookup-1',
      signedBy: HOST_IDENTITY,
      signatureSelector: HOST_SELECTOR,
      document: { selector: DOMAIN_SELECTOR, publicKey: aliceKeys.publicKey, keyType: 'rsa' },
    });
    expect(reply).not.toHaveProperty('encryption');
    expect(reply).not.toHaveProperty('document.createdAt');
    expect(reply?.signature).toBeDefined();
  });

  it('answers "Identity not found" for an identity the store does not have', async () => {
    const started = await startBtpsServer(await jsonStore([]));
    server = started.server;
    const reply = await sendLine(started.port, lookupRequest());

    expect(reply).toMatchObject({ type: 'btps_error', reqId: 'lookup-1', status: { ok: false } });
  });

  // The same defect 2, isolated from sockets: the documented identity
  // response (specifications/responses.md, "Identity Response Document")
  // must be a valid server response.
  it('the response schema accepts an identity lookup response', async () => {
    const { createdAt: _createdAt, ...document } = keyRecord(aliceKeys);
    const unsigned = {
      version: BTP_PROTOCOL_VERSION,
      status: { ok: true, code: 200, message: 'success' },
      id: 'response-1',
      issuedAt: new Date().toISOString(),
      type: 'btps_response' as const,
      reqId: 'lookup-1',
      signatureSelector: HOST_SELECTOR,
      document,
      signedBy: HOST_IDENTITY,
    };
    const result = BtpServerResponseSchema.safeParse({
      ...unsigned,
      signature: await signBtpPayload(unsigned, hostKeys),
    });

    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  // The host signs with its own key, so it must say at which selector that
  // key is published: a server that serves lookups needs its own selector.
  it('refuses to start serving lookups without a selector of its own', () => {
    expect(
      () =>
        new BtpsServer({
          serverIdentity: {
            identity: HOST_IDENTITY,
            publicKey: hostKeys.publicKey,
            privateKey: hostKeys.privateKey,
          },
          trustStore: emptyTrustStore,
          identityStore: {} as AbstractIdentityStore<BTPIdentityRecord>,
          tlsOptions: { cert: tlsCert, key: tlsKey },
        }),
    ).toThrow(expect.objectContaining({ code: 'BTP_ERROR_SERVER_SELECTOR' }));
  });
});

describe('BtpsClient.resolveIdentity against a stand-in host', () => {
  let host: tls.Server | undefined;
  let lookupsReceived = 0;
  const openSockets = new Set<tls.TLSSocket>();

  /** A stand-in host: answers every identity lookup with `answer(request)`
   * and leaves the connection open, as a host may. */
  const startHost = async (answer: (request: { id: string }) => Promise<string> | string) => {
    const port = await freePort();
    lookupsReceived = 0;
    host = tls.createServer({ cert: tlsCert, key: tlsKey }, (socket) => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
      socket.on('error', () => {});
      socket.once('data', async (chunk) => {
        lookupsReceived += 1;
        socket.write(await answer(JSON.parse(chunk.toString())));
      });
    });
    await new Promise<void>((resolve) => host!.listen(port, '127.0.0.1', resolve));
    return port;
  };

  /** A correctly signed answer: alice's key record, signed by the host. */
  const signedAnswer =
    (overrides: Record<string, unknown> = {}, signingKeys: BTPKeyPair = hostKeys) =>
    async (request: { id: string }) => {
      const { createdAt: _createdAt, ...document } = keyRecord(aliceKeys);
      const unsigned = {
        version: BTP_PROTOCOL_VERSION,
        status: { ok: true, code: 200, message: 'success' },
        id: 'response-1',
        issuedAt: new Date().toISOString(),
        type: 'btps_response',
        reqId: request.id,
        signatureSelector: HOST_SELECTOR,
        document,
        signedBy: HOST_IDENTITY,
        ...overrides,
      };
      const signature = await signBtpPayload(unsigned, signingKeys);
      return JSON.stringify({ ...unsigned, signature }) + '\n';
    };

  const hostKeyName = identityName(HOST_IDENTITY, HOST_SELECTOR);

  const client = (port: number) =>
    new BtpsClient({
      to: USER_IDENTITY,
      host: '127.0.0.1',
      port,
      hostSelector: DOMAIN_SELECTOR,
      btpMtsOptions: { ca: tlsCert },
      connectionTimeoutMs: 3000,
    });

  afterEach(async () => {
    openSockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => (host ? host.close(() => resolve()) : resolve()));
    host = undefined;
    mockResolveTxt.mockReset();
  });

  // Defect 3: resolveIdentity registered its listeners inside a try whose
  // `finally` destroyed the socket straight away, so the reply never
  // arrived and the caller got "Connection closed".
  it('returns the key the host serves when DNS has no record for the identity', async () => {
    // A SaaS user has no DNS record of their own; the host's key is in DNS.
    publishDns({ [hostKeyName]: keyTxt(hostKeys.publicKey) }, 'empty');
    const port = await startHost(signedAnswer());

    const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
    expect(response?.publicKey).toBe(aliceKeys.publicKey);
    expect(response?.selector).toBe(DOMAIN_SELECTOR);
    expect(lookupsReceived).toBe(1);
  });

  // Defect 4: a resolver reports a missing TXT record by rejecting (ENOTFOUND
  // or ENODATA), not by returning an empty list. getDnsIdentityParts
  // rethrew that, so resolveIdentity returned the DNS error and never asked
  // the host.
  it.each(['ENODATA', 'ENOTFOUND'] as const)(
    'asks the host when the DNS query for the identity fails with %s',
    async (code) => {
      publishDns({ [hostKeyName]: keyTxt(hostKeys.publicKey) }, code);
      const port = await startHost(signedAnswer());

      const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

      expect(lookupsReceived, 'the host was never asked').toBe(1);
      expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
      expect(response?.publicKey).toBe(aliceKeys.publicKey);
    },
  );

  // A DNS failure is not an absent record: the client must not turn a
  // resolver it cannot reach into a question for the host.
  it('does not ask the host when DNS fails for another reason', async () => {
    mockResolveTxt.mockImplementation(async (name: string) => {
      if (name === hostKeyName) return keyTxt(hostKeys.publicKey);
      throw dnsError(name, 'ESERVFAIL');
    });
    const port = await startHost(signedAnswer());

    const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(response).toBeUndefined();
    expect(error).toBeDefined();
    expect(lookupsReceived).toBe(0);
  });

  // Defect 5: before verifying, the client rebuilt the response with
  // `encryption: msg.encryption ?? null`. A host signs its response without
  // an `encryption` member (and the response schema refuses `encryption:
  // null`), so the client verified bytes the host never signed. The same
  // code was in resolveIdentity and verifyServerMessage.
  it('accepts a correctly signed, unencrypted response from the host', async () => {
    publishDns({ [hostKeyName]: keyTxt(hostKeys.publicKey) });
    class ProbeClient extends BtpsClient {
      check(msg: BTPServerResponse) {
        return this.verifyServerMessage(msg);
      }
    }
    const unsigned = {
      version: BTP_PROTOCOL_VERSION,
      status: { ok: true, code: 200, message: 'success' },
      id: 'response-2',
      issuedAt: new Date().toISOString(),
      type: 'btps_response' as const,
      reqId: 'request-2',
      signatureSelector: HOST_SELECTOR,
      document: 'ok',
      signedBy: HOST_IDENTITY,
    };
    const signed = { ...unsigned, signature: await signBtpPayload(unsigned, hostKeys) };
    // The message is one this SDK's own server may send.
    expect(BtpServerResponseSchema.safeParse(signed).success).toBe(true);

    const probe = new ProbeClient({ to: USER_IDENTITY, host: '127.0.0.1', port: 1 });
    const { isValid, error } = await probe.check(signed);

    expect(error, `verification failed: ${error?.message}`).toBeUndefined();
    expect(isValid).toBe(true);
  });

  describe('refuses an answer it cannot trust', () => {
    const otherKeys = getBTPKeyPair();

    const refused = async (answer: (request: { id: string }) => Promise<string> | string) => {
      publishDns({
        [hostKeyName]: keyTxt(hostKeys.publicKey),
        [identityName('admin$evil.test', HOST_SELECTOR)]: keyTxt(otherKeys.publicKey),
      });
      const port = await startHost(answer);
      const result = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);
      expect(lookupsReceived).toBe(1);
      expect(result.response).toBeUndefined();
      return result.error;
    };

    it('signed by a key other than the one published at its signatureSelector', async () => {
      expect(await refused(signedAnswer({}, otherKeys))).toMatchObject({
        code: 'BTP_ERROR_SIG_VERIFICATION',
      });
    });

    it("signed by an identity outside the address's domain, whose key does verify", async () => {
      expect(await refused(signedAnswer({ signedBy: 'admin$evil.test' }, otherKeys))).toMatchObject(
        { code: 'BTP_ERROR_SIG_VERIFICATION' },
      );
    });

    it('answering another request', async () => {
      expect(await refused(signedAnswer({ reqId: 'someone-elses' }))).toMatchObject({
        code: 'BTP_ERROR_VALIDATION',
      });
    });

    it('not signed', async () => {
      expect(
        await refused(async (request) => {
          const answer = JSON.parse((await signedAnswer()(request)).trim());
          delete answer.signature;
          return JSON.stringify(answer) + '\n';
        }),
      ).toMatchObject({ code: 'BTP_ERROR_SIG_VERIFICATION' });
    });

    it('whose document is not a key record', async () => {
      expect(await refused(signedAnswer({ document: 'ok' }))).toMatchObject({
        code: 'BTP_ERROR_VALIDATION',
      });
    });

    it('an error answer', async () => {
      expect(
        await refused(
          (request) =>
            JSON.stringify({
              version: BTP_PROTOCOL_VERSION,
              status: { ok: false, code: 500, message: 'Identity not found' },
              id: 'response-3',
              issuedAt: new Date().toISOString(),
              type: 'btps_error',
              reqId: request.id,
            }) + '\n',
        ),
      ).toMatchObject({ code: 'BTP_ERROR_IDENTITY_NOT_FOUND' });
    });
  });

  // PR #14's report: resolveIdentity threw inside an async 'data' handler on
  // a malformed answer, which became an unhandled promise rejection (vitest
  // fails the run on one) and left the caller waiting.
  it.each([
    ['not JSON', 'this is not json\n'],
    ['JSON with no status', '{"type":"btps_response"}\n'],
    ['JSON that is not an object', '42\n'],
  ])('answers an error, without an unhandled rejection, for %s', async (_name, line) => {
    publishDns({ [hostKeyName]: keyTxt(hostKeys.publicKey) });
    const port = await startHost(() => line);

    const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(response).toBeUndefined();
    expect(error).toBeDefined();
  });

  it('answers an error when the host closes without answering', async () => {
    publishDns({ [hostKeyName]: keyTxt(hostKeys.publicKey) });
    const port = await freePort();
    host = tls.createServer({ cert: tlsCert, key: tlsKey }, (socket) => {
      socket.on('error', () => {});
      socket.once('data', () => socket.end());
    });
    await new Promise<void>((resolve) => host!.listen(port, '127.0.0.1', resolve));

    const { response, error } = await client(port).resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(response).toBeUndefined();
    expect(error?.code).toBe('BTP_ERROR_CONNECTION_CLOSED');
  });
});

describe('identity lookup end to end: BtpsClient and BtpsServer over TLS', () => {
  let server: BtpsServer | undefined;

  afterEach(() => {
    server?.stop();
    server = undefined;
    mockResolveTxt.mockReset();
    vi.restoreAllMocks();
  });

  /** DNS for saas.test: `_btps.host` names the server, and the host's key is published. */
  const saasDns = (port: number, hostPublicKey: string, extra: Record<string, string[][]> = {}) =>
    publishDns({
      [`_btps.host.${DOMAIN}`]: [
        [`v=${BTP_PROTOCOL_VERSION}; u=127.0.0.1:${port}; s=${DOMAIN_SELECTOR}`],
      ],
      [identityName(HOST_IDENTITY, HOST_SELECTOR)]: keyTxt(hostPublicKey),
      ...extra,
    });

  const sender = () =>
    new BtpsClient({ to: USER_IDENTITY, btpMtsOptions: { ca: tlsCert }, connectionTimeoutMs: 5000 });

  it('an address with no DNS record is found through its host, and the signed answer verifies', async () => {
    const store = await jsonStore([{ identity: USER_IDENTITY, keys: aliceKeys }]);
    const asked = vi.spyOn(store, 'getPublicKeyRecord');
    const started = await startBtpsServer(store);
    server = started.server;
    saasDns(started.port, hostKeys.publicKey);

    const { response, error } = await sender().resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
    expect(response).toMatchObject({
      publicKey: aliceKeys.publicKey,
      selector: DOMAIN_SELECTOR,
      keyType: 'rsa',
      hostname: '127.0.0.1',
      port: started.port,
    });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked).toHaveBeenCalledWith(USER_IDENTITY, undefined);
  });

  it('an address with a DNS record uses DNS and never asks the host', async () => {
    const dnsKeys = getBTPKeyPair();
    // The host would answer with another key: the answer must come from DNS.
    const store = await jsonStore([{ identity: USER_IDENTITY, keys: aliceKeys }]);
    const asked = vi.spyOn(store, 'getPublicKeyRecord');
    const started = await startBtpsServer(store);
    server = started.server;
    const connections = vi.fn();
    (server as unknown as { server: tls.Server }).server.on('secureConnection', connections);
    saasDns(started.port, hostKeys.publicKey, {
      [identityName(USER_IDENTITY, DOMAIN_SELECTOR)]: keyTxt(dnsKeys.publicKey),
    });

    const { response, error } = await sender().resolveIdentity(USER_IDENTITY, REQUESTER);

    expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
    expect(response?.publicKey).toBe(dnsKeys.publicKey);
    expect(asked).not.toHaveBeenCalled();
    expect(connections).not.toHaveBeenCalled();
  });

  // Fix list 9 (EBA-186): the TXT parser split each tag on every "=", so a
  // base64 key with padding never parsed. RSA-2048 keys encode without
  // padding; 3072-bit and 4096-bit keys do not.
  describe.each([3072, 4096])('%i-bit keys', (bits) => {
    const big = getBTPKeyPair({ keySize: bits });
    const bigHost = getBTPKeyPair({ keySize: bits });

    it('the fixture is padded', () => {
      expect(pemToBase64(big.publicKey).endsWith('=')).toBe(true);
    });

    it('resolve from DNS', async () => {
      const started = await startBtpsServer(await jsonStore([]));
      server = started.server;
      saasDns(started.port, hostKeys.publicKey, {
        [identityName(USER_IDENTITY, DOMAIN_SELECTOR)]: keyTxt(big.publicKey),
      });

      const { response, error } = await sender().resolveIdentity(USER_IDENTITY, REQUESTER);

      expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
      expect(response?.publicKey).toBe(big.publicKey);
    });

    it('resolve through the host, whose own key is as large', async () => {
      const started = await startBtpsServer(
        await jsonStore([{ identity: USER_IDENTITY, keys: big }]),
        bigHost,
      );
      server = started.server;
      saasDns(started.port, bigHost.publicKey);

      const { response, error } = await sender().resolveIdentity(USER_IDENTITY, REQUESTER);

      expect(error, `resolveIdentity failed: ${error?.message}`).toBeUndefined();
      expect(response?.publicKey).toBe(big.publicKey);
    });
  });
});
