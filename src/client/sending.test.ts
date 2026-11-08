/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A client sending over a real connection: a receiver at 127.0.0.1 answers
// each line as a test tells it to. TCP stands in for TLS: what is under test
// is the client, not the handshake.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import net, { type AddressInfo, type Socket } from 'net';
import tls from 'tls';
import { generateKeyPairSync } from 'crypto';
import { resolveTxt } from 'dns/promises';
import { BtpsClient } from './btpsClient.js';
import { signBtpPayload } from '../core/crypto/index.js';
import { pemToBase64 } from '../core/utils/index.js';
import {
  BTP_ERROR_CONNECTION_CLOSED,
  BTP_ERROR_CONNECTION_ENDED,
  BTP_ERROR_IDENTITY,
  BTP_ERROR_IDENTITY_NOT_FOUND,
  BTP_ERROR_RESOLVE_DNS,
  BTP_ERROR_RESOLVE_PUBKEY,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_TIMEOUT,
  BTP_ERROR_VALIDATION,
} from '../core/error/index.js';
import type { BTPArtifact, BTPServerResponse } from '../core/server/types.js';
import type { BtpsKeyResolver } from '../core/crypto/keyResolver.js';

vi.mock('dns/promises', () => ({ resolveTxt: vi.fn() }));
const dns = vi.mocked(resolveTxt);
const notFound = () => Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' });

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
const operatorKeys = keyPair();
const bobKeys = keyPair();

const artifact = (id?: string) =>
  ({
    version: '1.0.0',
    ...(id !== undefined && { id }),
    issuedAt: new Date().toISOString(),
    action: 'PING',
  }) as BTPArtifact;

const answerTo = (reqId: string, more: Partial<BTPServerResponse> = {}): BTPServerResponse => ({
  version: '1.2.0',
  status: { ok: true, code: 200 },
  id: `answer-${reqId}`,
  issuedAt: new Date().toISOString(),
  type: 'btps_response',
  reqId,
  ...more,
});

/** An answer signed as the server signs it: signedBy and selector are signed too. */
const signed = (unsigned: BTPServerResponse, keys = operatorKeys): BTPServerResponse => {
  const withSigner = { ...unsigned, signedBy: 'admin$saas.test', selector: 'btps1' };
  return { ...withSigner, signature: signBtpPayload(withSigner, keys) };
};

type Answer = (line: string, socket: Socket) => void;

// The receiver: every connection it takes, and each line it reads, answered by `answer`.
const receiver = async (answer: Answer) => {
  const connections: Socket[] = [];
  const lines: string[] = [];
  const tcp = net.createServer((socket) => {
    connections.push(socket);
    let buffered = '';
    socket.on('data', (data) => {
      buffered += data.toString();
      let end;
      while ((end = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        lines.push(line);
        answer(line, socket);
      }
    });
  });
  await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
  const port = (tcp.address() as AddressInfo).port;
  vi.spyOn(tls, 'connect').mockImplementation(((_options: unknown, onConnect?: () => void) =>
    net.connect(port, '127.0.0.1', onConnect)) as unknown as typeof tls.connect);
  return { tcp, port, connections, lines };
};

const reply = (socket: Socket, message: unknown) =>
  socket.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
const echo: Answer = (line, socket) => reply(socket, answerTo(JSON.parse(line).id));

const clientFor = (options: Partial<ConstructorParameters<typeof BtpsClient>[0]> = {}) =>
  new BtpsClient({ to: 'bob$saas.test', host: '127.0.0.1', maxRetries: 0, ...options });

/** Resolves operator keys for checking a signature, and no receiver key, so a lookup asks the host. */
const resolverFor = (verifyKey?: string | Error): BtpsKeyResolver => ({
  async resolvePublicKey(_identity, _selector, use) {
    if (use === 'encrypt') return undefined;
    if (verifyKey instanceof Error) throw verifyKey;
    return verifyKey;
  },
});

const servers: net.Server[] = [];
const clients: BtpsClient[] = [];
const track = <T extends net.Server | BtpsClient>(value: T): T => {
  if (value instanceof BtpsClient) clients.push(value);
  else servers.push(value);
  return value;
};

beforeEach(() => dns.mockRejectedValue(notFound()));

afterEach(() => {
  for (const client of clients.splice(0)) client.destroy();
  for (const tcp of servers.splice(0)) tcp.close();
  vi.restoreAllMocks();
  dns.mockReset();
});

describe('a client sending over a real connection', () => {
  it('answers each send with the answer that names it, while several wait at once', async () => {
    const { tcp } = await receiver((line, socket) => {
      const { id } = JSON.parse(line);
      // Answered in reverse order: each send still gets its own.
      setTimeout(() => reply(socket, answerTo(id)), id === 'first' ? 30 : 0);
    });
    track(tcp);
    const client = track(clientFor());

    const sends = [client.send(artifact('first')), client.send(artifact('second'))];
    await vi.waitFor(() => expect(client['queue'].size).toBe(2));
    const [first, second] = await Promise.all(sends);

    expect(first.response?.reqId).toBe('first');
    expect(second.response?.reqId).toBe('second');
    expect(client['queue'].size).toBe(0);
  });

  it('is connecting while it connects, and connected once it has', async () => {
    const { tcp } = await receiver(echo);
    track(tcp);
    const client = track(clientFor());

    const sending = client.send(artifact('a'));
    expect(client.getConnectionStates().isConnecting).toBe(true);
    await sending;

    expect(client.getConnectionStates()).toMatchObject({ isConnecting: false, isConnected: true });
  });

  it('reads past empty lines to the answer', async () => {
    const { tcp } = await receiver((line, socket) => {
      socket.write('\n\n');
      echo(line, socket);
    });
    track(tcp);
    const client = track(clientFor());

    expect((await client.send(artifact('a'))).response?.reqId).toBe('a');
  });

  it('refuses a send past maxQueue without writing it', async () => {
    const { tcp, lines } = await receiver(() => undefined);
    track(tcp);
    const client = track(clientFor({ maxQueue: 1 }));

    void client.send(artifact('waiting'));
    await vi.waitFor(() => expect(lines).toHaveLength(1));
    const { response, error } = await client.send(artifact('one-too-many'));

    expect(response).toBeUndefined();
    expect(error?.message).toContain('request queue full');
    expect(lines).toHaveLength(1);
  });

  it('answers a send at once when the client is destroyed, and connects to nothing', async () => {
    const connect = vi.spyOn(tls, 'connect');
    const client = clientFor();
    client.destroy();

    const { response, error } = await client.send(artifact('a'));

    expect(response).toBeUndefined();
    expect(error?.message).toBe('BtpsClient instance is destroyed');
    expect(connect).not.toHaveBeenCalled();
  });

  it('refuses an artifact that is not one before connecting', async () => {
    const connect = vi.spyOn(tls, 'connect');
    const client = track(clientFor());

    const { error } = await client.send({ version: '1.0.0' } as BTPArtifact);

    expect(error?.code).toBe(BTP_ERROR_VALIDATION.code);
    expect(connect).not.toHaveBeenCalled();
  });

  it('fails a send whose connection closes before its answer, and forgets it', async () => {
    const { tcp } = await receiver((_line, socket) => socket.destroy());
    track(tcp);
    const client = track(clientFor());

    const { error } = await client.send(artifact('a'));

    expect(error?.code).toBe(BTP_ERROR_CONNECTION_ENDED.code);
    expect(client['queue'].size).toBe(0);
  });

  it('makes a new connection for the next send once the receiver has ended one', async () => {
    const { tcp, connections } = await receiver((line, socket) => {
      echo(line, socket);
      socket.end();
    });
    track(tcp);
    const client = track(clientFor());

    expect((await client.send(artifact('a'))).response?.reqId).toBe('a');
    await vi.waitFor(() => expect(client.getConnectionStates().isConnected).toBe(false));
    expect((await client.send(artifact('b'))).response?.reqId).toBe('b');
    expect(connections).toHaveLength(2);
  });

  it('fails a send to an address whose host is in no DNS record, and does not try again', async () => {
    const client = track(new BtpsClient({ to: 'bob$saas.test', maxRetries: 3, retryDelayMs: 10 }));
    const failures: { willRetry: boolean }[] = [];
    client.on('error', (info) => failures.push(info));

    const { error } = await client.send(artifact('a'));

    expect(error?.message).toContain('DNS resolution failed for bob$saas.test');
    expect(failures.map((f) => f.willRetry)).toEqual([false]);
  });

  it('tries to connect again maxRetries times, telling each failure, when the receiver refuses', async () => {
    const { tcp, port } = await receiver(echo);
    await new Promise((resolve) => tcp.close(resolve));
    const client = track(clientFor({ maxRetries: 2, retryDelayMs: 10 }));
    const failures: { willRetry: boolean }[] = [];
    client.on('error', (info) => failures.push(info));

    const { error } = await client.send(artifact('a'));

    expect(error).toBeDefined();
    expect(tls.connect).toHaveBeenCalledTimes(3);
    expect(failures.map((f) => f.willRetry)).toEqual([true, true, false]);
    expect(port).toBeGreaterThan(0);
  });

  it('keeps no connection made after it was destroyed', async () => {
    const { tcp } = await receiver(echo);
    track(tcp);
    let found: () => void = () => undefined;
    dns.mockImplementation(
      () =>
        new Promise((resolve) => {
          found = () => resolve([[`v=1.0.0; u=127.0.0.1:${tcp.address() && 1}; s=btps1`]]);
        }),
    );
    const client = new BtpsClient({ to: 'bob$saas.test', maxRetries: 0 });
    const connecting = client['connect']();

    await vi.waitFor(() => expect(dns).toHaveBeenCalled());
    client.destroy();
    found();
    const { socket, error } = await connecting;

    expect(socket).toBeUndefined();
    expect(error?.message).toBe('BtpsClient instance is destroyed');
    expect(client['socket']).toBeUndefined();
  });
});

describe('where a client finds its receiver', () => {
  it('uses the host it is given: its port, or the port option, or 3443, with the selector and operator given', async () => {
    const at = (options: Partial<ConstructorParameters<typeof BtpsClient>[0]>) =>
      track(clientFor(options)).resolveBtpsHostDnsTxt('bob$saas.test');

    expect(await at({ host: 'btps.saas.test:4443' })).toMatchObject({
      hostname: 'btps.saas.test',
      port: 4443,
      selector: 'btps1',
    });
    expect(await at({ host: 'btps.saas.test', port: 5443 })).toMatchObject({ port: 5443 });
    expect(
      await at({
        host: 'btps.saas.test',
        hostSelector: 'btps2',
        version: '1.1.0',
        hostOperator: 'admin$saas.test',
      }),
    ).toEqual({
      hostname: 'btps.saas.test',
      port: 3443,
      selector: 'btps2',
      version: '1.1.0',
      operator: 'admin$saas.test',
    });
  });

  it("reads the receiver's host record, 3443 when it names no port, and nothing when there is none", async () => {
    const client = track(new BtpsClient({ to: 'bob$saas.test', maxRetries: 0 }));
    const record = (txt: string) =>
      dns.mockImplementation(async (name: string) => {
        if (name === '_btps.host.saas.test') return [[txt]];
        throw notFound();
      });

    record('v=1.2.0; u=btps.saas.test:4443; s=btps1; op=admin$saas.test');
    expect(await client.resolveBtpsHostDnsTxt('bob$saas.test')).toEqual({
      hostname: 'btps.saas.test',
      port: 4443,
      selector: 'btps1',
      version: '1.2.0',
      operator: 'admin$saas.test',
    });
    record('v=1.2.0; u=btps.saas.test; s=btps1');
    expect(await client.resolveBtpsHostDnsTxt('bob$saas.test')).toMatchObject({ port: 3443 });
    dns.mockRejectedValue(notFound());
    expect(await client.resolveBtpsHostDnsTxt('bob$saas.test')).toBeUndefined();
  });
});

describe('a client changing its options', () => {
  it('takes what it is given and keeps the rest, with each wait at least its minimum', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = track(clientFor({ maxRetries: 1, maxQueue: 5 }));

    client.update({ maxRetries: 3, connectTimeoutMs: 1000, replyTimeoutMs: 60000 });

    expect(client['options']).toMatchObject({ maxRetries: 3, maxQueue: 5 });
    expect(client['connectTimeoutMs']).toBe(5000);
    expect(client['replyTimeoutMs']).toBe(60000);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("a server's signed answer", () => {
  const sendTo = async (
    answer: (reqId: string) => BTPServerResponse,
    resolver: BtpsKeyResolver,
  ) => {
    const { tcp } = await receiver((line, socket) => reply(socket, answer(JSON.parse(line).id)));
    track(tcp);
    return track(clientFor({ keyResolver: resolver })).send(artifact('a'));
  };

  it('is taken when it verifies under its signer key', async () => {
    const { response, error } = await sendTo(
      (id) => signed(answerTo(id)),
      resolverFor(operatorKeys.publicKey),
    );

    expect(error).toBeUndefined();
    expect(response?.signedBy).toBe('admin$saas.test');
  });

  it('is refused when its signer has no key', async () => {
    const { error } = await sendTo((id) => signed(answerTo(id)), resolverFor(undefined));

    expect(error?.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
    expect(String(error?.cause)).toContain('Failed to resolve public key');
  });

  it("is refused when its signer's key cannot be looked up", async () => {
    const { error } = await sendTo(
      (id) => signed(answerTo(id)),
      resolverFor(new Error('lookup down')),
    );

    expect(String(error?.cause)).toContain('Failed to resolve public key');
  });

  it('is refused when it was changed after signing', async () => {
    const { error } = await sendTo(
      (id) => ({ ...signed(answerTo(id)), status: { ok: true, code: 201 } }),
      resolverFor(operatorKeys.publicKey),
    );

    expect(error?.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
  });

  it('is refused when it has a signature but names no signer', async () => {
    const { error } = await sendTo((id) => {
      const { signedBy: _signedBy, ...unsigned } = signed(answerTo(id));
      return unsigned;
    }, resolverFor(operatorKeys.publicKey));

    expect(error?.code).toBe(BTP_ERROR_VALIDATION.code);
  });
});

describe('looking an identity up from its host', () => {
  // The operator's signed answer with bob's key, as a host gives it.
  // A 1.2 host names the identity in its answer to a 1.2.0 lookup.
  const keyDocument = {
    selector: 'btps1',
    publicKey: bobKeys.publicKey,
    keyType: 'rsa',
    version: '1.0.0',
    identity: 'bob$saas.test',
  };
  const answerWithKey = (reqId: string, more: Partial<BTPServerResponse> = {}) =>
    signed(
      answerTo(reqId, {
        document: keyDocument as BTPServerResponse['document'],
        ...more,
      }),
    );

  const lookUp = async (
    answer: Answer | undefined,
    options: Partial<ConstructorParameters<typeof BtpsClient>[0]> = {},
  ) => {
    if (answer) track((await receiver(answer)).tcp);
    const client = track(
      clientFor({
        hostOperator: 'admin$saas.test',
        keyResolver: resolverFor(operatorKeys.publicKey),
        ...options,
      }),
    );
    return client.resolveIdentity('bob$saas.test', 'alice$other.test');
  };

  it("returns the key in the operator's signed answer", async () => {
    const { response, error } = await lookUp((line, socket) =>
      reply(socket, answerWithKey(JSON.parse(line).id)),
    );

    expect(error).toBeUndefined();
    expect(response?.publicKey).toBe(bobKeys.publicKey);
  });

  it('refuses an identity or asker that is not an address', async () => {
    const client = track(clientFor());

    expect((await client.resolveIdentity('bob', 'alice$other.test')).error?.code).toBe(
      BTP_ERROR_IDENTITY.code,
    );
    expect((await client.resolveIdentity('bob$saas.test', 'alice')).error?.code).toBe(
      BTP_ERROR_IDENTITY.code,
    );
  });

  it('fails when the address has no host', async () => {
    const client = track(new BtpsClient({ to: 'bob$saas.test', maxRetries: 0 }));

    const { error } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

    expect(error?.code).toBe(BTP_ERROR_RESOLVE_DNS.code);
  });

  it("takes the keyResolver's key without asking the host", async () => {
    const connect = vi.spyOn(tls, 'connect');
    const client = track(
      clientFor({
        keyResolver: { resolvePublicKey: async () => bobKeys.publicKey },
      }),
    );

    const { response } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

    expect(response?.publicKey).toBe(bobKeys.publicKey);
    expect(connect).not.toHaveBeenCalled();
  });

  it('takes the key published in DNS without asking the host', async () => {
    const connect = vi.spyOn(tls, 'connect');
    dns.mockImplementation(async (name: string) => {
      if (name === 'btps1._btps.identity.bob.saas.test') {
        return [[`k=rsa; v=1.0.0; p=${pemToBase64(bobKeys.publicKey)}`]];
      }
      throw notFound();
    });
    const client = track(clientFor());

    const { response } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

    expect(response?.publicKey).toBe(bobKeys.publicKey.trim());
    expect(connect).not.toHaveBeenCalled();
  });

  it('fails when the domain declares no operator to answer for it', async () => {
    const { error } = await lookUp(undefined, { hostOperator: undefined });

    expect(error?.code).toBe(BTP_ERROR_IDENTITY_NOT_FOUND.code);
    expect(String(error?.cause)).toContain('declares no operator');
  });

  it('fails when the host answers with an error', async () => {
    const { error } = await lookUp((line, socket) =>
      reply(
        socket,
        answerTo(JSON.parse(line).id, { type: 'btps_error', status: { ok: false, code: 404 } }),
      ),
    );

    expect(error?.code).toBe(BTP_ERROR_IDENTITY_NOT_FOUND.code);
  });

  it('refuses an answer that is not signed', async () => {
    const { error } = await lookUp((line, socket) =>
      reply(
        socket,
        answerTo(JSON.parse(line).id, { document: {} as BTPServerResponse['document'] }),
      ),
    );

    expect(error?.code).toBe(BTP_ERROR_VALIDATION.code);
    expect(String(error?.cause)).toContain('not signed');
  });

  it("refuses an answer when the operator's key cannot be found", async () => {
    const { error } = await lookUp(
      (line, socket) => reply(socket, answerWithKey(JSON.parse(line).id)),
      { keyResolver: resolverFor(undefined) },
    );

    expect(error?.code).toBe(BTP_ERROR_RESOLVE_PUBKEY.code);
  });

  it('refuses an answer changed after signing', async () => {
    const { error } = await lookUp((line, socket) =>
      reply(socket, { ...answerWithKey(JSON.parse(line).id), reqId: 'another' }),
    );

    expect(error?.code).toBe(BTP_ERROR_SIG_VERIFICATION.code);
  });

  it('refuses a signed answer with no document', async () => {
    const { error } = await lookUp((line, socket) =>
      reply(socket, signed(answerTo(JSON.parse(line).id))),
    );

    expect(String(error?.cause)).toContain('document is not present');
  });

  it('refuses an answer that is not JSON', async () => {
    const { error } = await lookUp((_line, socket) => reply(socket, '{not json'));

    expect(error?.code).toBe(BTP_ERROR_VALIDATION.code);
  });

  it('fails when the host closes the connection before answering', async () => {
    const { error } = await lookUp((_line, socket) => socket.destroy());

    expect(error?.code).toBe(BTP_ERROR_CONNECTION_CLOSED.code);
  });

  describe('since 1.2, as a 1.2.0 lookup', () => {
    const refusedFor = async (more: (reqId: string) => Partial<BTPServerResponse>) => {
      const { error } = await lookUp((line, socket) => {
        const { id } = JSON.parse(line);
        reply(socket, answerWithKey(id, more(id)));
      });
      expect(error?.code).toBe(BTP_ERROR_VALIDATION.code);
      return String(error?.cause);
    };
    const named = (identity?: string) =>
      ({ ...keyDocument, identity }) as BTPServerResponse['document'];

    it('takes only an answer to this lookup', async () => {
      expect(await refusedFor(() => ({ reqId: 'another-lookup' }))).toContain(
        'answers another lookup',
      );
    });

    it('takes only a fresh answer', async () => {
      const stale = new Date(Date.now() - 10 * 60_000).toISOString();
      expect(await refusedFor(() => ({ issuedAt: stale }))).toContain('not fresh');
    });

    it('takes only an answer naming the identity asked about', async () => {
      expect(await refusedFor(() => ({ document: named('eve$saas.test') }))).toContain(
        'does not name bob$saas.test',
      );
      expect(await refusedFor(() => ({ document: named(undefined) }))).toContain('does not name');
    });

    it('asks a 1.1 host again as 1.1 asks, when it refuses the version', async () => {
      const versions: string[] = [];
      const { response, error } = await lookUp((line, socket) => {
        const { id, version } = JSON.parse(line);
        versions.push(version);
        reply(
          socket,
          version === '1.2.0'
            ? answerTo(id, {
                type: 'btps_error',
                status: { ok: false, code: 400, error: 'BTP_ERROR_VERSION_UNSUPPORTED' },
              })
            : answerWithKey(id, { document: named(undefined), version: '1.1.0' }),
        );
      });

      expect(error).toBeUndefined();
      expect(response?.publicKey).toBe(bobKeys.publicKey);
      expect(versions).toEqual(['1.2.0', '1.1.0']);
    });

    it('gives up on a host that does not answer in time', async () => {
      track((await receiver(() => {})).tcp);
      const client = track(
        clientFor({
          hostOperator: 'admin$saas.test',
          keyResolver: resolverFor(operatorKeys.publicKey),
        }),
      );
      client['replyTimeoutMs'] = 50;

      const { error } = await client.resolveIdentity('bob$saas.test', 'alice$other.test');

      expect(error?.code).toBe(BTP_ERROR_TIMEOUT.code);
    });
  });
});

describe("since 1.2, looking an identity's key chain up from its host", () => {
  const lookUpChain = async (
    answer: Answer | undefined,
    options: Partial<ConstructorParameters<typeof BtpsClient>[0]> = {},
  ) => {
    if (answer) track((await receiver(answer)).tcp);
    const client = track(
      clientFor({
        hostOperator: 'admin$saas.test',
        keyResolver: resolverFor(operatorKeys.publicKey),
        ...options,
      }),
    );
    return client.lookupKeyChain('bob$saas.test', 'alice$other.test');
  };
  const chainAnswer = (reqId: string, document: Record<string, unknown>) =>
    signed(answerTo(reqId, { document: document as BTPServerResponse['document'] }));
  const current = {
    selector: 'btps1',
    publicKey: bobKeys.publicKey,
    keyType: 'rsa',
    version: '1.2.0',
    identity: 'bob$saas.test',
  };

  it("gives the chain in the operator's signed answer to a 1.2.0 lookup that asks for it", async () => {
    let asked: Record<string, unknown> = {};
    const found = await lookUpChain((line, socket) => {
      asked = JSON.parse(line);
      reply(socket, chainAnswer(asked.id as string, { ...current, keyChain: [] }));
    });

    expect(found).toEqual({ status: 'chain', records: [] });
    expect(asked).toMatchObject({ version: '1.2.0', keyChain: true, identity: 'bob$saas.test' });
  });

  it('is invalid when the answer fails its checks', async () => {
    const noChain = await lookUpChain((line, socket) =>
      reply(socket, chainAnswer(JSON.parse(line).id, current)),
    );
    expect(noChain).toMatchObject({
      status: 'invalid',
      reason: expect.stringContaining('no key chain'),
    });

    const unsigned = await lookUpChain((line, socket) =>
      reply(
        socket,
        answerTo(JSON.parse(line).id, { document: current as BTPServerResponse['document'] }),
      ),
    );
    expect(unsigned.status).toBe('invalid');

    const client = track(clientFor());
    expect((await client.lookupKeyChain('bob', 'alice$other.test')).status).toBe('invalid');
  });

  it('is unavailable from a host that refuses the lookup, cannot be reached, or names no operator', async () => {
    // A 1.1 host refuses a lookup with keyChain as not its schema.
    const refused = await lookUpChain((line, socket) =>
      reply(
        socket,
        answerTo(JSON.parse(line).id, {
          type: 'btps_error',
          status: { ok: false, code: 400, error: 'BTP_ERROR_VALIDATION' },
        }),
      ),
    );
    expect(refused.status).toBe('unavailable');
    expect((await lookUpChain((_line, socket) => socket.destroy())).status).toBe('unavailable');
    expect((await lookUpChain(undefined, { hostOperator: undefined })).status).toBe('unavailable');

    // A DNS failure reading the host record.
    dns.mockRejectedValue(Object.assign(new Error('queryTxt ETIMEOUT'), { code: 'ETIMEOUT' }));
    const noHost = track(new BtpsClient({ to: 'bob$saas.test', maxRetries: 0 }));
    expect((await noHost.lookupKeyChain('bob$saas.test', 'alice$other.test')).status).toBe(
      'unavailable',
    );
  });
});
