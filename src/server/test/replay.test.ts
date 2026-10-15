/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 item F (EBA-114, addendum item 4): replay and duplicate
 * protection through the server. Real keys, real signatures and the real
 * pipeline (parse, window, signature, trust, duplicate check); only DNS key
 * lookup is faked. The cases in test/vectors/replay.vectors.json run here
 * through the server, and in verify-btps-vectors against the SDK's parts.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import crypto from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import { signBtpPayload, signEncrypt } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '../../core/trust/index.js';
import { AbstractReplayStore } from '../../core/storage/AbstractReplayStore.js';
import { InMemoryReplayStore } from '../../core/storage/InMemoryReplayStore.js';
import type { BTPReplayEntry } from '../../core/storage/types.js';
import {
  BTP_ERROR_ALREADY_RECEIVED,
  BTP_ERROR_ISSUED_AT_WINDOW,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_VALIDATION,
} from '../../core/error/index.js';
import { ISSUED_AT_WINDOW_MS, MAX_ISSUED_AT_WINDOW_MS } from '../../core/server/constants/index.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type {
  BTPAgentArtifact,
  BTPEventDoc,
  BTPServerResponse,
  BTPTransporterArtifact,
} from '../../core/server/types.js';
import type { BTPRequestCtx, BTPResponseCtx, ProcessedArtifact } from '../types.js';
import * as utils from '../../core/utils/index.js';

vi.mock('../../core/utils/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/utils/index.js')>();
  return { ...actual, resolvePublicKey: vi.fn(), getHostAndSelector: vi.fn() };
});

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

const BILLER = 'billing$acme.example';
const PAYER = 'finance$client.example';
const OTHER = 'carol$other.example';
const AGENT = 'btps_ag_replay-test-agent';
const keys: Record<string, PemKeys> = {
  [BILLER]: genKeys(),
  [PAYER]: genKeys(),
  [OTHER]: genKeys(),
  [AGENT]: genKeys(),
};

const VECTORS = new URL('../../../test/vectors/', import.meta.url);
const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(name, VECTORS), 'utf8')) as T;
const event = (name: string): BTPEventDoc => readJson<BTPEventDoc>(`events/${name}`);

type WindowCase = {
  name: string;
  issuedAt: string;
  windowMs?: number;
  expect: 'accept' | 'refuse';
  reason?: string;
};
type Step = {
  from: string;
  id: string;
  issuedAt: string;
  receivedAt: string;
  expect: 'accept' | 'refuse-window' | 'refuse-duplicate';
};
const vectors = readJson<{
  windowMs: number;
  now: string;
  window: WindowCase[];
  deliveries: { name: string; steps: Step[] }[];
}>('replay.vectors.json');

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
  async create(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async update(): Promise<BTPTrustRecord> {
    throw new Error('not used');
  }
  async delete(): Promise<void> {}
  async getAll(): Promise<BTPTrustRecord[]> {
    return [...this.records.values()];
  }
  trust(senderId: string, receiverId: string, publicKeyBase64 = 'key') {
    const id = computeTrustId(senderId, receiverId);
    this.records.set(id, {
      id,
      senderId,
      receiverId,
      status: 'accepted',
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'admin',
      decidedAt: '2026-10-01T00:00:00.000Z',
      publicKeyBase64,
      publicKeyFingerprint: 'fp',
      keyHistory: [],
      privacyType: 'unencrypted',
    });
  }
}

/** A platform's own replay store, as one over Postgres or Redis would be: three key operations. */
class MapReplayStore extends AbstractReplayStore {
  readonly rows = new Map<string, BTPReplayEntry>();
  constructor() {
    super({ connection: null, entityName: 'replay' });
  }
  protected async hasKey(key: string) {
    const row = this.rows.get(key);
    return !!row && Date.parse(row.expiresAt) >= Date.now();
  }
  protected async add(entry: BTPReplayEntry) {
    if (await this.hasKey(entry.key)) return false;
    this.rows.set(entry.key, entry);
    return true;
  }
  protected async deleteKey(key: string) {
    this.rows.delete(key);
  }
}

const setClock = (iso: string) => vi.setSystemTime(new Date(iso));

/** The other party: biller and payer write to each other; anyone else writes to the biller. */
const peerOf = (from: string) => (from === BILLER ? PAYER : BILLER);

/**
 * A BTPS_EVENT from `from` with id `id`, signed at `issuedAt`. The event is
 * the biller's own paid record, or the payer's proposal, so it is valid
 * between the two parties; its id is the artifact id (section 2.7).
 */
const signedEvent = async (
  from: string,
  id: string,
  issuedAt: string,
  { to = peerOf(from), file, signer = from }: { to?: string; file?: string; signer?: string } = {},
): Promise<BTPTransporterArtifact> => {
  const document = {
    ...event(file ?? (from === BILLER ? 'paid.by-biller.json' : 'paid.by-payer.json')),
    id,
  };
  const [accountName, domainName] = from.split('$') as [string, string];
  const { payload, error } = await signEncrypt(
    to,
    { accountName, domainName, selector: 'btps1', pemFiles: keys[signer]! },
    { version: '1.1.0', type: 'BTPS_EVENT', from, to, document, id, issuedAt },
  );
  expect(error).toBeUndefined();
  return payload as unknown as BTPTransporterArtifact;
};

const fakeSocket = () =>
  ({
    destroyed: false,
    writableEnded: false,
    writable: true,
    write: vi.fn(),
    end: vi.fn(),
  }) as unknown as TLSSocket;

describe('item F: replay and duplicate protection through the server', () => {
  let trustStore: MapTrustStore;
  let handled: ProcessedArtifact[];

  const makeServer = (
    options: { replayStore?: AbstractReplayStore; issuedAtWindowMs?: number } = {},
  ) => {
    const server = new BtpsServer({
      trustStore,
      serverIdentity: { identity: 'server$acme.example', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
      ...options,
    });
    server.forwardTo(async (data) => {
      handled.push(data);
    });
    return server;
  };

  /**
   * Sends one wire line through parse and the request pipeline, as
   * handleConnection does, and returns what the server wrote back. A line
   * the schema refuses comes back as BTP_ERROR_VALIDATION.
   */
  const deliver = async (server: BtpsServer, artifact: unknown): Promise<BTPServerResponse> => {
    const { data, error } = server['_parseAndValidateArtifact'](JSON.stringify(artifact));
    if (error || !data) {
      return { status: { ok: false, message: BTP_ERROR_VALIDATION.message } } as BTPServerResponse;
    }
    const socket = fakeSocket();
    const base = { socket, startTime: new Date().toISOString(), remoteAddress: '127.0.0.1', data };
    await server['executeRequestPipeline'](
      base as unknown as BTPRequestCtx<'before', 'signatureVerification'>,
      {
        ...base,
        reqId: (artifact as { id: string }).id,
        responseSent: false,
        sendRes: () => {},
        sendError: () => {},
      } as unknown as BTPResponseCtx<'before', 'signatureVerification'>,
    );
    return JSON.parse((socket.write as Mock).mock.calls[0][0] as string) as BTPServerResponse;
  };

  const outcome = (response: BTPServerResponse) => {
    if (response.status.ok) return 'accept';
    if (response.status.message === BTP_ERROR_ISSUED_AT_WINDOW.message) return 'refuse-window';
    if (response.status.message === BTP_ERROR_ALREADY_RECEIVED.message) return 'refuse-duplicate';
    return `refused: ${response.status.message}`;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    setClock(vectors.now);
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    vi.mocked(utils.resolvePublicKey).mockImplementation(
      async (identity: string) => keys[identity]?.publicKey,
    );
    vi.mocked(utils.getHostAndSelector).mockImplementation(async () => ({
      version: '1.1.0',
      host: 'btps.example:3443',
      selector: 'btps1',
    }));
    trustStore = new MapTrustStore();
    trustStore.trust(BILLER, PAYER);
    handled = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('EBA-114 acceptance', () => {
    it('the same artifact delivered twice: the second is refused, and the application sees it once', async () => {
      const server = makeServer();
      const artifact = await signedEvent(PAYER, crypto.randomUUID(), new Date().toISOString());
      expect(outcome(await deliver(server, artifact))).toBe('accept');
      const second = await deliver(server, artifact);
      expect(outcome(second)).toBe('refuse-duplicate');
      expect(second.status.message).toBe(BTP_ERROR_ALREADY_RECEIVED.message);
      expect(second.reqId).toBe(artifact.id);
      expect(handled).toHaveLength(1);
    });

    it('an artifact whose issuedAt is 10 minutes old is refused', async () => {
      const server = makeServer();
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const artifact = await signedEvent(PAYER, crypto.randomUUID(), tenMinutesAgo);
      const response = await deliver(server, artifact);
      expect(response.status.message).toBe(BTP_ERROR_ISSUED_AT_WINDOW.message);
      expect(handled).toHaveLength(0);
    });

    it('the window is the named constant, ±5 minutes', () => {
      expect(ISSUED_AT_WINDOW_MS).toBe(5 * 60 * 1000);
    });

    it('the two refusals are told apart on the wire', () => {
      expect(BTP_ERROR_ISSUED_AT_WINDOW.code).not.toBe(BTP_ERROR_ALREADY_RECEIVED.code);
      expect(BTP_ERROR_ISSUED_AT_WINDOW.message).not.toBe(BTP_ERROR_ALREADY_RECEIVED.message);
    });
  });

  describe('replay.vectors.json, through the server', () => {
    it.each(vectors.window.map((c) => [c.name, c] as const))('window/%s', async (_, c) => {
      const server = makeServer({ issuedAtWindowMs: c.windowMs });
      const response = await deliver(
        server,
        await signedEvent(PAYER, crypto.randomUUID(), c.issuedAt),
      );
      if (c.expect === 'accept') {
        expect(outcome(response)).toBe('accept');
      } else if (c.reason === 'unreadable') {
        // The artifact schema refuses most unreadable values first; the window refuses the rest.
        expect([BTP_ERROR_VALIDATION.message, BTP_ERROR_ISSUED_AT_WINDOW.message]).toContain(
          response.status.message,
        );
      } else {
        expect(outcome(response)).toBe('refuse-window');
      }
    });

    it.each(vectors.deliveries.map((d) => [d.name, d] as const))('deliveries/%s', async (_, d) => {
      const replayStore = new InMemoryReplayStore();
      const seen = vi.spyOn(replayStore, 'seen');
      const server = makeServer({ replayStore });
      const sent = new Map<string, BTPTransporterArtifact>();
      for (const [index, step] of d.steps.entries()) {
        setClock(step.issuedAt);
        const key = `${step.from} ${step.id} ${step.issuedAt}`;
        // A step repeating an earlier one's from, id and issuedAt is that same artifact, sent again.
        if (!sent.has(key)) sent.set(key, await signedEvent(step.from, step.id, step.issuedAt));
        setClock(step.receivedAt);
        seen.mockClear();
        const result = outcome(await deliver(server, sent.get(key)));
        expect(result, `step ${index + 1}`).toBe(step.expect);
        // Refused by the window, the store is never asked.
        if (step.expect === 'refuse-window') expect(seen).not.toHaveBeenCalled();
      }
    });
  });

  describe('lifecycle events (section 2.7)', () => {
    it('a reused event id is refused, even on a different event', async () => {
      const server = makeServer();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const paid = await signedEvent(PAYER, id, now, { file: 'paid.by-payer.json' });
      const disputed = await signedEvent(PAYER, id, now, { file: 'disputed.json' });
      expect(paid.type).toBe('BTPS_EVENT');
      expect(outcome(await deliver(server, paid))).toBe('accept');
      expect(outcome(await deliver(server, disputed))).toBe('refuse-duplicate');
      expect(handled).toHaveLength(1);
    });

    it('the other party may use the same event id: ids are unique per sender', async () => {
      const server = makeServer();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      expect(outcome(await deliver(server, await signedEvent(PAYER, id, now)))).toBe('accept');
      expect(outcome(await deliver(server, await signedEvent(BILLER, id, now)))).toBe('accept');
    });
  });

  describe('only a verified, trusted artifact spends its id', () => {
    it("a forged signature under the sender's name does not block the real artifact", async () => {
      const server = makeServer();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const forged = await signedEvent(PAYER, id, now, { signer: OTHER });
      expect((await deliver(server, forged)).status.message).toBe(
        BTP_ERROR_SIG_VERIFICATION.message,
      );
      expect(outcome(await deliver(server, await signedEvent(PAYER, id, now)))).toBe('accept');
    });

    it('an artifact refused for trust is not remembered, so it may be sent again once trusted', async () => {
      const server = makeServer();
      const artifact = await signedEvent(OTHER, crypto.randomUUID(), new Date().toISOString(), {
        to: BILLER,
        file: 'paid.by-payer.json',
      });
      expect((await deliver(server, artifact)).status.message).toBe(
        BTP_ERROR_TRUST_NOT_ALLOWED.message,
      );
      trustStore.trust(BILLER, OTHER);
      expect(outcome(await deliver(server, artifact))).toBe('accept');
    });

    it('if the application throws, the pair is forgotten and the same artifact may be resent', async () => {
      const server = makeServer();
      server.forwardTo(async () => {
        throw new Error('database down');
      });
      const artifact = await signedEvent(PAYER, crypto.randomUUID(), new Date().toISOString());
      await expect(deliver(server, artifact)).rejects.toThrow('database down');
      server.forwardTo(async (data) => {
        handled.push(data);
      });
      expect(outcome(await deliver(server, artifact))).toBe('accept');
      expect(handled).toHaveLength(1);
    });

    it('of two copies racing past the first check, one is refused', async () => {
      const server = makeServer();
      const artifact = await signedEvent(PAYER, crypto.randomUUID(), new Date().toISOString());
      const results = await Promise.all([deliver(server, artifact), deliver(server, artifact)]);
      expect(results.map(outcome).sort()).toEqual(['accept', 'refuse-duplicate']);
      expect(handled).toHaveLength(1);
    });
  });

  describe('agent artifacts: the same window and the same check, keyed by agentId', () => {
    const signedAgent = async (id: string, issuedAt: string): Promise<BTPAgentArtifact> => {
      const unsigned = {
        version: '1.1.0',
        id,
        action: 'system.ping',
        agentId: AGENT,
        to: BILLER,
        issuedAt,
        encryption: null,
      };
      const signature = await signBtpPayload(unsigned, keys[AGENT]!);
      return { ...unsigned, signature } as unknown as BTPAgentArtifact;
    };

    beforeEach(() => {
      const base64 = keys[AGENT]!.publicKey.replace(
        /-----(BEGIN|END) PUBLIC KEY-----/g,
        '',
      ).replace(/\s+/g, '');
      trustStore.trust(AGENT, BILLER, base64);
    });

    it('accepts once and refuses the same artifact again', async () => {
      const server = makeServer();
      const artifact = await signedAgent(crypto.randomUUID(), new Date().toISOString());
      expect(outcome(await deliver(server, artifact))).toBe('accept');
      expect(outcome(await deliver(server, artifact))).toBe('refuse-duplicate');
    });

    it('refuses one 10 minutes old', async () => {
      const server = makeServer();
      const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(outcome(await deliver(server, await signedAgent(crypto.randomUUID(), old)))).toBe(
        'refuse-window',
      );
    });
  });

  describe('the store and the window are server options', () => {
    it('uses an in-memory store when given none', () => {
      expect(makeServer().getDependencies().replayStore).toBeInstanceOf(InMemoryReplayStore);
    });

    it("uses the platform's own store when given one", async () => {
      const replayStore = new MapReplayStore();
      const server = makeServer({ replayStore });
      const artifact = await signedEvent(PAYER, crypto.randomUUID(), new Date().toISOString());
      expect(outcome(await deliver(server, artifact))).toBe('accept');
      expect(replayStore.rows.size).toBe(1);
      const [row] = [...replayStore.rows.values()];
      expect(row).toMatchObject({ from: PAYER, id: artifact.id });
      // Held until issuedAt plus the window, then the window refuses it on its own.
      expect(Date.parse(row!.expiresAt)).toBe(Date.parse(artifact.issuedAt) + ISSUED_AT_WINDOW_MS);
      expect(outcome(await deliver(server, artifact))).toBe('refuse-duplicate');
    });

    it('takes a tighter window', async () => {
      const server = makeServer({ issuedAtWindowMs: 60_000 });
      const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
      expect(
        outcome(
          await deliver(server, await signedEvent(PAYER, crypto.randomUUID(), twoMinutesAgo)),
        ),
      ).toBe('refuse-window');
    });

    it('refuses a window wider than the maximum', () => {
      expect(() => makeServer({ issuedAtWindowMs: MAX_ISSUED_AT_WINDOW_MS + 1 })).toThrow(
        BTP_ERROR_VALIDATION.message,
      );
    });
  });

  describe('a client retry', () => {
    it('BtpsClient.send keeps the id and issuedAt it was given, so a resend is a duplicate', async () => {
      const server = makeServer();
      const artifact = await signedEvent(PAYER, crypto.randomUUID(), new Date().toISOString());
      const client = new BtpsClient({ to: BILLER });
      const written: unknown[] = [];
      type Job = { artifact: unknown; resolve: (v: unknown) => void };
      vi.spyOn(
        client as unknown as { dispatch: (job: Job) => Promise<void> },
        'dispatch',
      ).mockImplementation(async (job: Job) => {
        written.push(structuredClone(job.artifact));
        job.resolve({ response: undefined, error: undefined });
      });
      await client.send(artifact);
      setClock(new Date(Date.now() + 60_000).toISOString()); // the retry, a minute later
      await client.send(artifact);
      expect(written).toEqual([artifact, artifact]);
      expect(outcome(await deliver(server, written[0]))).toBe('accept');
      expect(outcome(await deliver(server, written[1]))).toBe('refuse-duplicate');
    });
  });
});
