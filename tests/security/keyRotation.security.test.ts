/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// Attacks on key rotation, end to end: a compromised or hostile host, a
// replayed answer, a stolen key, a forged chain, a failing DNS, a costly
// chain, a downgrade, and a forged authority in an evidence bundle. Each is
// one attack against real BtpsServers over real TLS, and each is refused, with
// nothing delivered.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import crypto, { randomUUID } from 'crypto';
import tls from 'tls';
import { resolveTxt } from 'dns/promises';
import { computeId } from '../../src/core/utils/index.js';
import { createDefaultKeyResolver, signBtpPayload } from '../../src/core/crypto/index.js';
import { BtpsDelegator } from '../../src/core/delegation/BtpsDelegator.js';
import {
  BTP_ERROR_KEY_RETIRED,
  BTP_ERROR_KEY_REVOKED,
  BTP_ERROR_RESOLVE_PUBKEY,
} from '../../src/core/error/index.js';
import { BTP_PROTOCOL_VERSION } from '../../src/core/server/constants/index.js';
import { keyChainRecordHash, signKeyRotation } from '../../src/core/trust/keyRotation.js';
import { agreementRef, signAgreement, signStatement } from '../../src/core/trust/agreements.js';
import { buildEvidenceBundle, verifyEvidenceBundle } from '../../src/core/trust/evidence.js';
import type { BTPKeyChainRecord } from '../../src/core/trust/types.js';
import type { BTPServerResponse, BTPTransporterArtifact } from '../../src/core/server/types.js';
import { dnsModule } from '../e2e/zone.js';
import {
  addUser,
  artifactFrom,
  deliver,
  fingerprintOf,
  freePort,
  invoiceDocument,
  newKeys,
  publishHost,
  publishKey,
  recordTrust,
  senderTls,
  serverTls,
  startProvider,
  unpublishKey,
  type Keys,
  type Provider,
  type User,
} from '../e2e/harness.js';

// The journeys' DNS, which a test can make fail for one name.
vi.mock('dns/promises', async () => {
  const zone = await import('../e2e/zone.js');
  return { resolveTxt: vi.fn(zone.dnsModule.resolveTxt) };
});
const dns = vi.mocked(resolveTxt);
afterEach(() => dns.mockImplementation(dnsModule.resolveTxt));

const secondsAgo = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();
const providers: Provider[] = [];
const servers: tls.Server[] = [];
afterAll(() => {
  for (const provider of providers) provider.stop();
  for (const server of servers) server.close();
});

const provider = async (domain: string, server: object = {}) => {
  const started = await startProvider(domain, { server });
  providers.push(started);
  return started;
};

/** A receiver that asks for each sender's chain on every arrival (no cache), trusting `senders`. */
const receiver = async (domain: string, senders: string[], server: object = {}) => {
  const host = await provider(domain, {
    keyResolver: createDefaultKeyResolver({
      from: `admin$${domain}`,
      btpMtsOptions: senderTls,
      keyChainMaxCacheSeconds: 0,
    }),
    ...server,
  });
  const user = await addUser(host, 'pay');
  for (const sender of senders)
    await recordTrust(host.trustStore, sender, user.identity, 'accepted');
  return user;
};

/** `artifact` sent to `to`: its answer's status, and whether `to`'s platform got anything. */
const attempt = async (artifact: BTPTransporterArtifact, to: User) => {
  const before = to.provider.inbox.length;
  const { response } = await deliver(artifact);
  return { status: response?.status, delivered: to.provider.inbox.length > before };
};
const invoice = (from: User, to: User, extra?: Record<string, unknown>) =>
  artifactFrom(from, to.identity, 'BTPS_DOC', invoiceDocument({ id: randomUUID() }), {
    ...(extra && { extra }),
  });
/** Refused, with the 401 and the code of `error`, and nothing delivered. */
const refusedWith = (error: { code?: string | number }) => ({
  status: { code: 401, error: error.code },
  delivered: false,
});
const taken = { status: { ok: true, code: 200 }, delivered: true };

/** `identity`, signing with `keys` under `selector`, at `host`. */
const as = (host: Provider, identity: string, keys: Keys, selector: string): User => ({
  identity,
  keys,
  selector,
  provider: host,
});

/** The host keeps `identity`'s chain in its identity store, as a provider writes it. */
const keepChain = async (host: Provider, identity: string, chain: BTPKeyChainRecord[]) => {
  const id = computeId(identity);
  if (await host.identityStore.getById(id)) {
    await host.identityStore.update(id, { keyChain: [...chain] });
  } else {
    await host.identityStore.create(
      {
        identity,
        currentSelector: 'btps1',
        publicKeys: [],
        keyChain: [...chain],
        createdAt: new Date().toISOString(),
      },
      id,
    );
  }
};

/** The domain moves `s=`; its operator re-publishes its unchanged key under it. */
const moveDomainTo = (host: Provider, selector: string) => {
  publishHost(host.domain, { port: host.port, selector, operator: host.operator });
  publishKey(host.operator, selector, host.operatorKeys.publicKey);
};

type Ends = [keys: Keys, selector: string];
const rotation = (
  identity: string,
  [from, fromSelector]: Ends,
  [to, toSelector]: Ends,
  at: string,
  prev: BTPKeyChainRecord | null,
  immediate?: { compromisedSince: string },
) => {
  const base = {
    identity,
    from: { selector: fromSelector },
    to: { selector: toSelector },
    at,
    prev: prev && keyChainRecordHash(prev),
  };
  return signKeyRotation(
    immediate ? { ...base, expiry: 'immediate', ...immediate, reason: 'compromised' } : base,
    { from: { pemFiles: from }, to: { pemFiles: to } },
  );
};

/** A record changed after signing, signed again by `signers`: what a forger can make. */
const resigned = (
  record: BTPKeyChainRecord,
  change: (signed: Record<string, unknown>) => void,
  signers: [by: 'from' | 'to', keys: Keys][],
): BTPKeyChainRecord => {
  const signed = structuredClone('rotation' in record ? record.rotation : record.expiry);
  change(signed as unknown as Record<string, unknown>);
  const signatures = signers.map(([by, keys]) => ({ by, ...signBtpPayload(signed, keys) }));
  return { rotation: signed, signatures } as unknown as BTPKeyChainRecord;
};

/**
 * A hostile host for `domain`: it answers every identity lookup with what
 * `answer` makes of it, signed by its operator's real key, published in DNS.
 */
const hostileHost = async (
  domain: string,
  answer: (lookup: { id: string; identity: string }, operator: string) => BTPServerResponse,
) => {
  const operator = `admin$${domain}`;
  const operatorKeys = newKeys();
  const port = await freePort();
  const server = tls.createServer(serverTls, (socket) => {
    let buffered = '';
    socket.on('data', (data) => {
      buffered += data.toString();
      let end;
      while ((end = buffered.indexOf('\n')) !== -1) {
        const lookup = JSON.parse(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        const unsigned = { ...answer(lookup, operator), signedBy: operator, selector: 'btps1' };
        const signature = signBtpPayload(unsigned, operatorKeys);
        socket.write(`${JSON.stringify({ ...unsigned, signature })}\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  servers.push(server);
  publishHost(domain, { port, selector: 'btps1', operator });
  publishKey(operator, 'btps1', operatorKeys.publicKey);
  return { operator, operatorKeys };
};

/** A genuine answer to `lookup`, fresh, as a 1.2 host signs it. */
const answerTo = (
  lookup: { id: string; identity: string },
  document: Record<string, unknown>,
): BTPServerResponse =>
  ({
    version: '1.2.0',
    status: { ok: true, code: 200 },
    id: randomUUID(),
    issuedAt: new Date().toISOString(),
    type: 'btps_response',
    reqId: lookup.id,
    document: { identity: lookup.identity, ...document },
  }) as BTPServerResponse;

describe('1. a compromised host serving a fabricated chain for an identity with a DNS key', () => {
  let host: Provider;
  let victim: User;
  let client: User;
  const thief = [newKeys(), newKeys()];

  beforeAll(async () => {
    host = await provider('fabricated.example');
    victim = await addUser(host, 'billing');
    client = await receiver('fabricated-client.example', [victim.identity]);
  });

  it("refuses a lost-key record to the host's own key, while DNS still names the real one", async () => {
    const lost = await signKeyRotation(
      {
        identity: victim.identity,
        from: { selector: 'btps1', publicKey: victim.keys.publicKey },
        to: { selector: 'btps2' },
        at: secondsAgo(30),
        prev: null,
        expiry: 'immediate',
        compromisedSince: secondsAgo(60),
        reason: 'lost',
      },
      { to: { pemFiles: thief[0]! } },
    );
    await keepChain(host, victim.identity, [lost]);

    const forged = await invoice(as(host, victim.identity, thief[0]!, 'btps2'), client);
    expect(await attempt(forged, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
  });

  it('refuses a whole fresh root of its own keys', async () => {
    const root = await rotation(
      victim.identity,
      [thief[0]!, 'btps7'],
      [thief[1]!, 'btps8'],
      secondsAgo(30),
      null,
    );
    await keepChain(host, victim.identity, [root]);

    const forged = await invoice(as(host, victim.identity, thief[1]!, 'btps8'), client);
    expect(await attempt(forged, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
  });
});

describe('2. a replayed lookup answer', () => {
  type Replay = 'fresh' | 'another lookup' | 'stale' | 'another identity' | 'no key chain';
  let replay: Replay = 'fresh';
  let sender: User;
  let client: User;

  beforeAll(async () => {
    const identity = 'billing$replayed.example';
    const keys = newKeys();
    publishKey(identity, 'btps1', keys.publicKey);
    await hostileHost('replayed.example', (lookup) => {
      const document = { selector: 'btps1', publicKey: keys.publicKey, keyType: 'rsa' };
      const genuine = answerTo(lookup, {
        ...document,
        version: BTP_PROTOCOL_VERSION,
        keyChain: [],
      });
      switch (replay) {
        case 'another lookup':
          return { ...genuine, reqId: randomUUID() };
        case 'stale':
          return { ...genuine, issuedAt: secondsAgo(600) };
        case 'another identity':
          return {
            ...genuine,
            document: { ...(genuine.document as object), identity: 'other$replayed.example' },
          } as BTPServerResponse;
        case 'no key chain':
          return answerTo(lookup, { ...document, version: BTP_PROTOCOL_VERSION });
        default:
          return genuine;
      }
    });
    sender = as({ domain: 'replayed.example' } as Provider, identity, keys, 'btps1');
    client = await receiver('replayed-client.example', [identity]);
  });

  it('takes a fresh answer to this lookup: the hostile host is a working one', async () => {
    replay = 'fresh';
    expect(await attempt(await invoice(sender, client), client)).toMatchObject(taken);
  });

  it.each<Replay>(['another lookup', 'stale', 'another identity', 'no key chain'])(
    'refuses an answer to %s',
    async (kind) => {
      replay = kind;
      const artifact = await invoice(sender, client);
      expect(await attempt(artifact, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
    },
  );
});

describe('3. a key stolen after a planned rotation', () => {
  let host: Provider;
  let stolen: User;
  let lenient: User;
  let strict: User;

  beforeAll(async () => {
    host = await provider('planned.example');
    stolen = await addUser(host, 'billing');
    const next = newKeys();
    const record = await rotation(
      stolen.identity,
      [stolen.keys, 'btps1'],
      [next, 'btps2'],
      secondsAgo(30),
      null,
    );
    await keepChain(host, stolen.identity, [record]);
    publishKey(stolen.identity, 'btps2', next.publicKey);
    moveDomainTo(host, 'btps2');
    lenient = await receiver('planned-lenient.example', [stolen.identity]);
    strict = await receiver('planned-strict.example', [stolen.identity], {
      retiredKeyGraceSeconds: 5,
    });
  });

  it('is taken within the grace', async () => {
    expect(await attempt(await invoice(stolen, lenient), lenient)).toMatchObject(taken);
  });

  it("is refused after it, though DNS still has the old key's record", async () => {
    expect(await attempt(await invoice(stolen, strict), strict)).toMatchObject(
      refusedWith(BTP_ERROR_KEY_RETIRED),
    );
  });
});

describe('4. a key stolen after its immediate expiry', () => {
  let host: Provider;
  let delegating: Provider;
  let stolen: User;
  let client: User;
  let delegator: BtpsDelegator;
  const device = newKeys();
  const owner = { identity: 'bob$attested.example', keys: newKeys() };

  /** A device's invoice, delegated by the operator of delegating.example, or attested by it. */
  const delegated = async (from: string, onBehalfOf?: typeof owner) => {
    const unsigned = {
      version: BTP_PROTOCOL_VERSION,
      id: randomUUID(),
      issuedAt: new Date().toISOString(),
      type: 'BTPS_DOC' as const,
      from,
      to: client.identity,
      selector: 'btps1',
      encryption: null,
      document: invoiceDocument({ id: randomUUID() }),
    };
    const artifact = { ...unsigned, signature: signBtpPayload(unsigned, device) };
    return delegator.delegateArtifact(
      'btps_ag_phone',
      device.publicKey,
      artifact as BTPTransporterArtifact,
      onBehalfOf && { identity: onBehalfOf.identity, keyPair: onBehalfOf.keys },
    );
  };

  /** `identity`'s key at btps1, expired at once from a minute ago; DNS keeps its record. */
  const expire = async (on: Provider, identity: string, keys: Keys) => {
    const next = newKeys();
    const record = await rotation(
      identity,
      [keys, 'btps1'],
      [next, 'btps2'],
      secondsAgo(10),
      null,
      {
        compromisedSince: secondsAgo(60),
      },
    );
    await keepChain(on, identity, [record]);
    publishKey(identity, 'btps2', next.publicKey);
  };

  beforeAll(async () => {
    host = await provider('revoked.example');
    stolen = await addUser(host, 'billing');
    delegating = await provider('delegating.example');
    publishHost('attested.example', {
      port: delegating.port,
      selector: 'btps1',
      operator: delegating.operator,
    });
    publishKey(owner.identity, 'btps1', owner.keys.publicKey);
    client = await receiver('revoked-client.example', [
      stolen.identity,
      'alice$delegating.example',
      owner.identity,
    ]);
    // The operator's delegator, signing with its key at btps1, as it did before the theft.
    delegator = new BtpsDelegator({
      identity: delegating.operator,
      privateKey: delegating.operatorKeys.privateKey,
    });
    await expire(host, stolen.identity, stolen.keys);
    await expire(delegating, delegating.operator, delegating.operatorKeys);
  });

  it('is refused at once', async () => {
    expect(await attempt(await invoice(stolen, client), client)).toMatchObject(
      refusedWith(BTP_ERROR_KEY_REVOKED),
    );
  });

  it('is refused for an artifact backdated before compromisedSince', async () => {
    const backdated = await invoice(stolen, client, { issuedAt: secondsAgo(120) });
    expect(await attempt(backdated, client)).toMatchObject(refusedWith(BTP_ERROR_KEY_REVOKED));
  });

  it('is refused as a delegator', async () => {
    const artifact = await delegated('alice$delegating.example');
    expect(artifact.delegation?.signedBy).toBe(delegating.operator);
    expect(await attempt(artifact, client)).toMatchObject(refusedWith(BTP_ERROR_KEY_REVOKED));
  });

  it('is refused as an attestor', async () => {
    const artifact = await delegated(owner.identity, owner);
    expect(artifact.delegation?.attestation?.signedBy).toBe(delegating.operator);
    expect(await attempt(artifact, client)).toMatchObject(refusedWith(BTP_ERROR_KEY_REVOKED));
  });
});

/**
 * A compromised host for `domain`, serving each identity the chain it holds
 * for it as is, in a well-formed answer signed by its operator. (A BtpsServer
 * checks its own store's chain before it answers: a chain with no single
 * current key, it answers as an identity it does not know.)
 */
const servingHost = async (
  domain: string,
  served: Map<string, { chain: BTPKeyChainRecord[]; current: Ends }>,
) => {
  await hostileHost(domain, (lookup) => {
    const { chain, current } = served.get(lookup.identity)!;
    const [keys, selector] = current;
    return answerTo(lookup, {
      selector,
      publicKey: keys.publicKey,
      keyType: 'rsa',
      version: BTP_PROTOCOL_VERSION,
      keyChain: chain,
    });
  });
  return { domain } as Provider;
};

describe("5. a thief's fork, served by the host", () => {
  it('is refused: a key with a second successor, though the owner signs too', async () => {
    const identity = 'billing$forked.example';
    const [k1, k2, k3, thief] = [newKeys(), newKeys(), newKeys(), newKeys()];
    const first = await rotation(identity, [k1, 'btps1'], [k2, 'btps2'], secondsAgo(60), null);
    const second = await rotation(identity, [k2, 'btps2'], [k3, 'btps3'], secondsAgo(30), first);
    // The thief holds btps2, and hands it on to a key of its own.
    const fork = await rotation(identity, [k2, 'btps2'], [thief, 'btps4'], secondsAgo(20), first);
    // DNS publishes the owner's current key only.
    publishKey(identity, 'btps3', k3.publicKey);
    const host = await servingHost(
      'forked.example',
      new Map([[identity, { chain: [first, second, fork], current: [k3, 'btps3'] as Ends }]]),
    );
    const client = await receiver('forked-client.example', [identity]);

    const forged = await invoice(as(host, identity, thief, 'btps4'), client);
    expect(await attempt(forged, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
    // The fork is refused itself, not only the thief's unpublished key.
    const owners = await invoice(as(host, identity, k3, 'btps3'), client);
    expect(await attempt(owners, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
  });
});

describe('6. a chain that breaks a rule, served by the host', () => {
  let host: Provider;
  let client: User;
  const accounts = ['loop', 'reused', 'future'];
  const served = new Map<string, { chain: BTPKeyChainRecord[]; current: Ends }>();

  beforeAll(async () => {
    host = await servingHost('broken.example', served);
    client = await receiver(
      'broken-client.example',
      accounts.map((account) => `${account}$broken.example`),
    );
  });

  /** Each chain, and the key and selector its last record hands on to. */
  const chains: Record<string, (identity: string) => Promise<[BTPKeyChainRecord[], Keys, string]>> =
    {
      // A → B → A, the second A under a stated fingerprint of another key, signed again.
      'a loop, A → B → A under a second stated fingerprint': async (identity) => {
        const [a, b] = [newKeys(), newKeys()];
        const first = await rotation(identity, [a, 'btps1'], [b, 'btps2'], secondsAgo(60), null);
        const back = await rotation(identity, [b, 'btps2'], [a, 'btps3'], secondsAgo(30), first);
        const restated = resigned(
          back,
          (signed) => {
            (signed.to as { fingerprint: string }).fingerprint = fingerprintOf(newKeys().publicKey);
          },
          [
            ['from', b],
            ['to', a],
          ],
        );
        return [[first, restated], a, 'btps3'];
      },
      // A → B → C, C under A's selector.
      'a reused selector': async (identity) => {
        const [a, b, c] = [newKeys(), newKeys(), newKeys()];
        const first = await rotation(identity, [a, 'btps1'], [b, 'btps2'], secondsAgo(60), null);
        const second = await rotation(identity, [b, 'btps2'], [c, 'btps1'], secondsAgo(30), first);
        return [[first, second], c, 'btps1'];
      },
      // A → B, dated a day ahead.
      'a record dated in the future': async (identity) => {
        const [a, b] = [newKeys(), newKeys()];
        const ahead = new Date(Date.now() + 86_400_000).toISOString();
        return [[await rotation(identity, [a, 'btps1'], [b, 'btps2'], ahead, null)], b, 'btps2'];
      },
    };

  it.each(Object.keys(chains).map((name, i) => [name, accounts[i]!] as const))(
    'refuses %s',
    async (name, account) => {
      const identity = `${account}$broken.example`;
      const [chain, last, selector] = await chains[name]!(identity);
      served.set(identity, { chain, current: [last, selector] });
      // DNS publishes the chain's last key, as its owner would: only the rule refuses it.
      publishKey(identity, selector, last.publicKey);

      const artifact = await invoice(as(host, identity, last, selector), client);
      expect(await attempt(artifact, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
    },
  );
});

describe('7. DNS that fails while a chain is checked', () => {
  it('is refused, never taken for a host-only identity', async () => {
    const host = await provider('dnsfail.example');
    const owner = await addUser(host, 'billing');
    const next = newKeys();
    const record = await rotation(
      owner.identity,
      [owner.keys, 'btps1'],
      [next, 'btps2'],
      secondsAgo(30),
      null,
    );
    await keepChain(host, owner.identity, [record]);
    publishKey(owner.identity, 'btps2', next.publicKey);
    const client = await receiver('dnsfail-client.example', [owner.identity]);
    const artifact = await invoice(as(host, owner.identity, next, 'btps2'), client);

    // The identity's own key records time out; everything else answers.
    dns.mockImplementation(async (name: string) => {
      if (/\._btps\.identity\.billing\.dnsfail\.example$/i.test(name)) {
        throw Object.assign(new Error(`queryTxt ETIMEOUT ${name}`), { code: 'ETIMEOUT' });
      }
      return dnsModule.resolveTxt(name);
    });
    expect(await attempt(artifact, client)).toMatchObject(refusedWith(BTP_ERROR_RESOLVE_PUBKEY));
  });
});

describe('8. the cost of a long chain', () => {
  let host: Provider;
  let client: User;
  let last: User;

  beforeAll(async () => {
    host = await provider('long.example');
    const identity = 'billing$long.example';
    // 101 keys, 100 records: the longest chain a verifier takes.
    const keys = Array.from({ length: 101 }, () => newKeys());
    const chain: BTPKeyChainRecord[] = [];
    for (let i = 0; i < 100; i++) {
      chain.push(
        await rotation(
          identity,
          [keys[i]!, `btps${i + 1}`],
          [keys[i + 1]!, `btps${i + 2}`],
          secondsAgo(200 - i),
          chain.at(-1) ?? null,
        ),
      );
    }
    await keepChain(host, identity, chain);
    publishKey(identity, 'btps101', keys[100]!.publicKey);
    last = as(host, identity, keys[100]!, 'btps101');
    // A receiver as shipped: it keeps a chain for keyChainMaxCacheSeconds.
    const receiving = await provider('long-client.example');
    client = await addUser(receiving, 'pay');
    await recordTrust(receiving.trustStore, identity, client.identity, 'accepted');
  }, 120_000);

  it('is verified once per window, however many artifacts its sender sends', async () => {
    const verifies = vi.spyOn(crypto, 'verify');
    try {
      expect(await attempt(await invoice(last, client), client)).toMatchObject(taken);
      const first = verifies.mock.calls.length;
      for (let i = 0; i < 5; i++) {
        expect(await attempt(await invoice(last, client), client)).toMatchObject(taken);
      }
      // The first arrival checks every record's two signatures; the next five, none of them.
      expect(first).toBeGreaterThanOrEqual(200);
      expect(verifies.mock.calls.length - first).toBeLessThan(5 * 10);
    } finally {
      verifies.mockRestore();
    }
  });

  it('is refused past the limit, before a signature in it is checked', async () => {
    const identity = 'billing$oversized.example';
    const keys = newKeys();
    publishKey(identity, 'btps1', keys.publicKey);
    const record = await rotation(
      identity,
      [newKeys(), 'btps7'],
      [newKeys(), 'btps8'],
      secondsAgo(30),
      null,
    );
    // A hostile host serves 101 records: one over the limit.
    await hostileHost('oversized.example', (lookup) =>
      answerTo(lookup, {
        selector: 'btps1',
        publicKey: keys.publicKey,
        keyType: 'rsa',
        version: BTP_PROTOCOL_VERSION,
        keyChain: Array.from({ length: 101 }, () => record),
      }),
    );
    const receiving = await receiver('oversized-client.example', [identity]);
    const artifact = await invoice(as(host, identity, keys, 'btps1'), receiving);

    const verifies = vi.spyOn(crypto, 'verify');
    try {
      expect(await attempt(artifact, receiving)).toMatchObject(
        refusedWith(BTP_ERROR_RESOLVE_PUBKEY),
      );
      // At most the answer's own signature: none of the 202 in its records.
      expect(verifies.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      verifies.mockRestore();
    }
  });
});

describe('9. a downgrade: the sender’s host hides its chain', () => {
  it.each<[string, string, number]>([
    ['refuses the 1.2.0 lookup', 'BTP_ERROR_VERSION_UNSUPPORTED', 400],
    ['answers it with an error', 'BTP_ERROR_INTERNAL', 500],
  ])(
    'when it %s, falls back to DNS, where a revoked key whose record is gone is still refused',
    async (_name, error, code) => {
      const domain = `hidden-${code}.example`;
      const identity = `billing$${domain}`;
      const [revoked, current] = [newKeys(), newKeys()];
      // The revoked key's record removed at once, as the rule says; the current one published.
      publishKey(identity, 'btps1', revoked.publicKey);
      unpublishKey(identity, 'btps1');
      publishKey(identity, 'btps2', current.publicKey);
      await hostileHost(domain, (lookup) => ({
        version: '1.2.0',
        status: { ok: false, code, error },
        id: randomUUID(),
        issuedAt: new Date().toISOString(),
        type: 'btps_error',
        reqId: lookup.id,
      }));
      const client = await receiver(`${domain.replace('.example', '')}-client.example`, [identity]);
      const sender = { domain } as Provider;

      const withRevoked = await invoice(as(sender, identity, revoked, 'btps1'), client);
      expect(await attempt(withRevoked, client)).toMatchObject(
        refusedWith(BTP_ERROR_RESOLVE_PUBKEY),
      );
      // The fallback is DNS, as in 1.1: the current key is taken.
      const withCurrent = await invoice(as(sender, identity, current, 'btps2'), client);
      expect(await attempt(withCurrent, client)).toMatchObject(taken);
    },
  );
});

describe('10. a forged authority in an evidence bundle', () => {
  let bundleWith: (answer: BTPServerResponse, operatorKey: string) => unknown;
  let genuine: BTPServerResponse;
  let bank: User;
  let operatorKey: string;
  let operatorFingerprint: string;
  const online = () => ({
    resolveKeyChain: (identity: string) =>
      createDefaultKeyResolver({ from: bank.identity, btpMtsOptions: senderTls }).resolveKeyChain!(
        identity,
      ),
    retiredKeyGraceSeconds: 0,
  });
  const chainFacts = async (bundle: unknown, options: Parameters<typeof verifyEvidenceBundle>[1]) =>
    (await verifyEvidenceBundle(JSON.parse(JSON.stringify(bundle)), options)).statements[0]
      ?.keyChain;

  beforeAll(async () => {
    const janeHost = await provider('lostkey.example');
    const bankHost = await provider('lender.example');
    bank = await addUser(bankHost, 'loans');
    const jane = await addUser(janeHost, 'jane');
    operatorKey = janeHost.operatorKeys.publicKey;
    operatorFingerprint = fingerprintOf(operatorKey);

    const agreement = await signAgreement(
      {
        type: 'agreement',
        title: 'Loan',
        id: 'AGR-1',
        issuedAt: secondsAgo(200),
        body: { format: 'text', content: 'A loan.' },
        acceptance: { terms: [], signers: [{ address: jane.identity }], signingOrder: 'any' },
      },
      { originator: bank.identity, selector: 'btps1', pemFiles: bank.keys },
    );
    const statement = await signStatement(
      {
        agreement: agreementRef(agreement, bank.identity),
        terms: [],
        signer: jane.identity,
        decision: 'accepted',
        signedAt: secondsAgo(120),
      },
      { selector: 'btps1', pemFiles: jane.keys },
    );
    // Jane loses her key: only the new one signs its rotation, which her host serves.
    const next = newKeys();
    const lost = await signKeyRotation(
      {
        identity: jane.identity,
        from: { selector: 'btps1', publicKey: jane.keys.publicKey },
        to: { selector: 'btps2' },
        at: secondsAgo(30),
        prev: null,
        expiry: 'immediate',
        compromisedSince: secondsAgo(30),
        reason: 'lost',
      },
      { to: { pemFiles: next } },
    );
    await keepChain(janeHost, jane.identity, [lost]);
    const lookup = await createDefaultKeyResolver({
      from: bank.identity,
      btpMtsOptions: senderTls,
    }).resolveKeyChain!(jane.identity);
    if (lookup.status !== 'chain' || !lookup.answer) throw new Error('no chain from the host');
    genuine = lookup.answer;
    // Jane's host is gone now: her chain is to be had from the bundle alone.
    janeHost.stop();

    bundleWith = (answer, operatorKey) =>
      buildEvidenceBundle(
        {
          originator: bank.identity,
          agreement,
          statements: [statement],
          keyChains: [{ identity: jane.identity, records: [lost], operatorAnswer: answer }],
        },
        (identity) =>
          identity === bank.identity
            ? bank.keys.publicKey
            : identity === answer.signedBy
              ? operatorKey
              : undefined,
      );
  });

  /** The genuine answer, signed again by someone else, as `signedBy`. */
  const signedAgain = (signedBy: string, keys: Keys) => {
    const answer: BTPServerResponse = { ...genuine, signedBy, selector: 'btps1' };
    delete answer.signature;
    return { ...answer, signature: signBtpPayload(answer, keys) };
  };

  it("is unconfirmed offline: a forger's answer, beside the real operator the reader named", async () => {
    const forger = newKeys();
    const forged = signedAgain(genuine.signedBy!, forger);
    const facts = await chainFacts(bundleWith(forged, forger.publicKey), {
      operators: { 'lostkey.example': operatorFingerprint },
    });
    expect(facts).toMatchObject({
      authorityUnverified: true,
      operatorAnswer: { signatureValid: true, operatorKeyAnchored: false },
    });
  });

  it('is unconfirmed online: an answer by a genuine identity that is not the operator', async () => {
    const byBank = signedAgain(bank.identity, bank.keys);
    const facts = await chainFacts(bundleWith(byBank, bank.keys.publicKey), { online: online() });
    expect(facts).toMatchObject({
      authorityUnverified: true,
      operatorAnswer: { signedBy: bank.identity, signatureValid: true, operatorKeyAnchored: false },
    });
  });

  it("is unconfirmed by the counterparty's key, kept as a plain anchor", async () => {
    const byBank = signedAgain(bank.identity, bank.keys);
    const facts = await chainFacts(bundleWith(byBank, bank.keys.publicKey), {
      anchors: [fingerprintOf(bank.keys.publicKey)],
    });
    expect(facts).toMatchObject({ authorityUnverified: true });
  });

  it('is confirmed by the genuine answer, online, where DNS names its signer the operator', async () => {
    const facts = await chainFacts(bundleWith(genuine, operatorKey), { online: online() });
    expect(facts).toMatchObject({
      authorityUnverified: false,
      operatorAnswer: { operatorKeyAnchored: true },
    });
  });
});
