/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 item D (EBA-112, addendum item 2, threat T-24): a key-rotating
 * refresh is signed by the current key. Real keys, real signatures, the real
 * pipeline (parse, window, signature, trust, duplicate check) and a real
 * BtpsAuthentication behind it. The cases in test/vectors/refresh.vectors.json
 * run here through the server, and in keyRotation.test.ts and
 * verify-btps-vectors against verifyAgentRefresh.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import crypto from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { signBtpPayload } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '../../core/trust/index.js';
import { BtpsAuthentication } from '../../core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../core/authentication/storage/InMemoryTokenStore.js';
import { signKeyProof } from '../../core/authentication/keyRotation.js';
import {
  BTP_ERROR_ALREADY_RECEIVED,
  BTP_ERROR_KEY_ROTATION_PROOF,
  BTP_ERROR_REFRESH_NOT_CURRENT_KEY,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_VALIDATION,
} from '../../core/error/index.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type {
  BTPAgentArtifact,
  BTPAuthReqDoc,
  BTPAuthResDoc,
  BTPServerResponse,
} from '../../core/server/types.js';
import type { BTPRequestCtx, BTPResponseCtx } from '../types.js';
import { getFingerprintFromPem } from '../../core/crypto/index.js';
import { pemToBase64 } from '../../core/utils/index.js';

type RefreshCase = {
  name: string;
  currentKey: string | null;
  artifact: BTPAgentArtifact;
  expect: 'accept' | 'refuse';
  rotation?: boolean;
  reason?: string;
  error?: string;
};
const vectors = JSON.parse(
  readFileSync(new URL('../../../test/vectors/refresh.vectors.json', import.meta.url), 'utf8'),
) as {
  now: string;
  agentId: string;
  identity: string;
  selfHeld: {
    keys: Record<string, { publicKeyPem: string; privateKeyPem: string }>;
    cases: RefreshCase[];
    tokens: { use: string; expect: 'accept' | 'refuse' }[];
  };
  managed: { cases: RefreshCase[] };
};

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

const USER = 'alice$saas.example';

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
  /** An enrolled device: the agent's trust record holding `publicKey`. */
  enrol(agentId: string, receiverId: string, publicKey: string) {
    const id = computeTrustId(agentId, receiverId);
    this.records.set(id, {
      id,
      senderId: agentId,
      receiverId,
      status: 'accepted',
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: 'admin',
      decidedAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2027-10-01T00:00:00.000Z',
      publicKeyBase64: pemToBase64(publicKey),
      publicKeyFingerprint: getFingerprintFromPem(publicKey),
      keyHistory: [],
      privacyType: 'unencrypted',
    });
  }
  record(agentId: string, receiverId: string) {
    return this.records.get(computeTrustId(agentId, receiverId))!;
  }
}

const fakeSocket = () =>
  ({
    destroyed: false,
    writableEnded: false,
    writable: true,
    write: vi.fn(),
    end: vi.fn(),
  }) as unknown as TLSSocket;

/** An auth.refresh as a device signs it: by `signedBy`, carrying `document`. */
const refreshArtifact = async (
  agentId: string,
  signedBy: PemKeys,
  document: BTPAuthReqDoc,
): Promise<BTPAgentArtifact> => {
  const unsigned = {
    version: '1.1.0',
    id: crypto.randomUUID(),
    action: 'auth.refresh' as const,
    agentId,
    to: document.identity,
    issuedAt: new Date().toISOString(),
    encryption: null,
    document,
  };
  return { ...unsigned, signature: await signBtpPayload(unsigned, signedBy) } as BTPAgentArtifact;
};

describe('item D: a key-rotating refresh is signed by the current key, through the server', () => {
  let trustStore: MapTrustStore;
  let tokenStore: InMemoryTokenStore;
  let auth: BtpsAuthentication;
  /** What the application's auth.refresh handler did with each artifact it was given. */
  let reissued: { data?: BTPAuthResDoc; error?: Error }[];

  const makeServer = () => {
    const server = new BtpsServer({
      trustStore,
      serverIdentity: { identity: 'server$saas.example', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
    });
    // The handler from the authentication docs: the server has already
    // verified the signature and any key proof before it runs.
    server.onIncomingArtifact('Agent', async (artifact) => {
      if (artifact.action !== 'auth.refresh') return;
      const doc = artifact.document as BTPAuthReqDoc;
      reissued.push(
        await auth.validateAndReissueRefreshToken(artifact.agentId, doc.authToken, {
          decidedBy: 'system',
          publicKey: doc.publicKey,
          decryptBy: artifact.to,
        }),
      );
    });
    return server;
  };

  /** One wire line through parse and the request pipeline, as handleConnection does. */
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

  /** Enrols a device with `current` and returns its first refresh token. */
  const enrolDevice = async (current: PemKeys) => {
    const { agentId, refreshToken } = await auth.createAgent(
      { userIdentity: USER, publicKey: current.publicKey, decidedBy: 'system' },
      USER,
    );
    return { agentId, refreshToken };
  };

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    trustStore = new MapTrustStore();
    tokenStore = new InMemoryTokenStore();
    auth = new BtpsAuthentication({ trustStore, tokenStore });
    reissued = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('EBA-112 acceptance', () => {
    it('a refresh with a new key, signed only by the new key, is refused and the key is kept', async () => {
      const current = genKeys();
      const attacker = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      // The 1.0 rotation: a stolen refresh token, and a key the thief made.
      const artifact = await refreshArtifact(agentId, attacker, {
        identity: USER,
        authToken: refreshToken,
        publicKey: attacker.publicKey,
      });
      const response = await deliver(server, artifact);
      expect(response.status.ok).toBe(false);
      expect(response.status.message).toBe(BTP_ERROR_REFRESH_NOT_CURRENT_KEY.message);
      expect(reissued).toHaveLength(0);
      expect(trustStore.record(agentId, USER).publicKeyFingerprint).toBe(
        getFingerprintFromPem(current.publicKey),
      );
    });

    it('a refresh with a new key and its own proof, signed by the new key, is refused', async () => {
      const current = genKeys();
      const attacker = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const { publicKey, keyProof } = await signKeyProof({
        agentId,
        identity: USER,
        newKey: attacker,
      });
      const response = await deliver(
        server,
        await refreshArtifact(agentId, attacker, {
          identity: USER,
          authToken: refreshToken,
          publicKey,
          keyProof,
        }),
      );
      expect(response.status.message).toBe(BTP_ERROR_REFRESH_NOT_CURRENT_KEY.message);
      expect(reissued).toHaveLength(0);
    });

    it('signed by the current key, with the new key countersigned, is accepted and rotates', async () => {
      const current = genKeys();
      const next = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const { publicKey, keyProof } = await signKeyProof({ agentId, identity: USER, newKey: next });
      const response = await deliver(
        server,
        await refreshArtifact(agentId, current, {
          identity: USER,
          authToken: refreshToken,
          publicKey,
          keyProof,
        }),
      );
      expect(response.status.ok).toBe(true);
      expect(reissued).toHaveLength(1);
      expect(reissued[0]!.data?.refreshToken).toBeTruthy();
      const record = trustStore.record(agentId, USER);
      expect(record.publicKeyFingerprint).toBe(getFingerprintFromPem(next.publicKey));
      expect(record.keyHistory.map((k) => k.fingerprint)).toEqual([
        getFingerprintFromPem(current.publicKey),
      ]);

      // From now on the old key is not the current key.
      const stale = await deliver(
        server,
        await refreshArtifact(agentId, current, {
          identity: USER,
          authToken: reissued[0]!.data!.refreshToken,
          publicKey: current.publicKey,
        }),
      );
      expect(stale.status.message).toBe(BTP_ERROR_REFRESH_NOT_CURRENT_KEY.message);
      const withNewKey = await deliver(
        server,
        await refreshArtifact(agentId, next, {
          identity: USER,
          authToken: reissued[0]!.data!.refreshToken,
          publicKey: next.publicKey,
        }),
      );
      expect(withNewKey.status.ok).toBe(true);
    });

    it('a rotation with no proof, or a bad one, is refused', async () => {
      const current = genKeys();
      const next = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const noProof = await deliver(
        server,
        await refreshArtifact(agentId, current, {
          identity: USER,
          authToken: refreshToken,
          publicKey: next.publicKey,
        }),
      );
      expect(noProof.status.message).toBe(BTP_ERROR_KEY_ROTATION_PROOF.message);

      const { keyProof } = await signKeyProof({ agentId, identity: USER, newKey: genKeys() });
      const badProof = await deliver(
        server,
        await refreshArtifact(agentId, current, {
          identity: USER,
          authToken: refreshToken,
          publicKey: next.publicKey,
          keyProof,
        }),
      );
      expect(badProof.status.message).toBe(BTP_ERROR_KEY_ROTATION_PROOF.message);
      expect(reissued).toHaveLength(0);
      expect(trustStore.record(agentId, USER).publicKeyFingerprint).toBe(
        getFingerprintFromPem(current.publicKey),
      );
    });

    it('a refresh without rotation, signed by the current key, is accepted and keeps the key', async () => {
      const current = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const response = await deliver(
        server,
        await refreshArtifact(agentId, current, {
          identity: USER,
          authToken: refreshToken,
          publicKey: current.publicKey,
        }),
      );
      expect(response.status.ok).toBe(true);
      expect(reissued[0]!.data).toBeDefined();
      const record = trustStore.record(agentId, USER);
      expect(record.publicKeyFingerprint).toBe(getFingerprintFromPem(current.publicKey));
      expect(record.keyHistory).toEqual([]);
    });

    it('a replayed refresh token is refused: it is single-use', async () => {
      const current = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const refresh = (token: string) =>
        refreshArtifact(agentId, current, {
          identity: USER,
          authToken: token,
          publicKey: current.publicKey,
        });

      expect((await deliver(server, await refresh(refreshToken))).status.ok).toBe(true);
      // A new artifact, correctly signed, with the token already spent.
      await deliver(server, await refresh(refreshToken));
      expect(reissued).toHaveLength(2);
      expect(reissued[0]!.data).toBeDefined();
      expect(reissued[1]!.data).toBeUndefined();
      expect(reissued[1]!.error).toBeDefined();
      // The token it was given instead still works, once.
      await deliver(server, await refresh(reissued[0]!.data!.refreshToken));
      expect(reissued[2]!.data).toBeDefined();
    });

    it('the same refresh artifact sent twice is refused by replay protection (EBA-114)', async () => {
      const current = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const artifact = await refreshArtifact(agentId, current, {
        identity: USER,
        authToken: refreshToken,
        publicKey: current.publicKey,
      });
      expect((await deliver(server, artifact)).status.ok).toBe(true);
      const again = await deliver(server, artifact);
      expect(again.status.message).toBe(BTP_ERROR_ALREADY_RECEIVED.message);
      expect(reissued).toHaveLength(1);
    });
  });

  describe('refresh.vectors.json, through the server', () => {
    const run = async (c: RefreshCase) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(vectors.now));
      if (c.currentKey) {
        trustStore.enrol(
          c.artifact.agentId,
          c.artifact.to,
          vectors.selfHeld.keys[c.currentKey]!.publicKeyPem,
        );
      }
      return deliver(makeServer(), c.artifact);
    };

    it.each(vectors.selfHeld.cases.map((c) => [c.name, c] as const))(
      'self-held/%s',
      async (_, c) => {
        const response = await run(c);
        if (c.expect === 'accept') {
          expect(response.status.ok).toBe(true);
        } else if (c.reason === 'no-current-key') {
          // No trust record: the server refuses before item D's check runs.
          expect(response.status.message).toBe(BTP_ERROR_SIG_VERIFICATION.message);
        } else {
          const expected = [BTP_ERROR_REFRESH_NOT_CURRENT_KEY, BTP_ERROR_KEY_ROTATION_PROOF].find(
            (e) => e.code === c.error,
          );
          expect(response.status.message).toBe(expected!.message);
        }
      },
    );

    it('self-held/tokens: a refresh token is single-use', async () => {
      const current = genKeys();
      const server = makeServer();
      const { agentId, refreshToken } = await enrolDevice(current);
      const issued = [refreshToken];
      for (const step of vectors.selfHeld.tokens) {
        const token = issued[Number(step.use.replace('issued-', ''))]!;
        const response = await deliver(
          server,
          await refreshArtifact(agentId, current, {
            identity: USER,
            authToken: token,
            publicKey: current.publicKey,
          }),
        );
        expect(response.status.ok).toBe(true);
        const { data } = reissued.at(-1)!;
        expect(data ? 'accept' : 'refuse').toBe(step.expect);
        if (data) issued.push(data.refreshToken);
      }
    });

    it.each(vectors.managed.cases.map((c) => [c.name, c] as const))('managed/%s', async (_, c) => {
      // A managed identity has no agent trust record: there is no device key to refresh.
      const response = await run(c);
      expect(response.status.ok).toBe(false);
      expect(response.status.message).toBe(BTP_ERROR_SIG_VERIFICATION.message);
    });
  });
});
