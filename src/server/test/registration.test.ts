/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 device registration bound to the identity: a device is
 * registered only on a one-time registration token issued to the identity's
 * owner, and is bound to exactly that identity. Also: a
 * forged agent artifact is refused for every action. Real keys, real
 * signatures, the real pipeline (parse, window, signature, trust, duplicate
 * check) and a real BtpsAuthentication beside it. The cases in
 * test/vectors/registration.vectors.json run here through the server, and in
 * verify-btps-vectors against the SDK's parts.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import crypto from 'crypto';
import tls, { type TLSSocket } from 'tls';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { getFingerprintFromPem, signBtpPayload } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { computeTrustId } from '../../core/trust/index.js';
import { BtpsAuthentication } from '../../core/authentication/BtpsAuthentication.js';
import { InMemoryTokenStore } from '../../core/authentication/storage/InMemoryTokenStore.js';
import { signKeyProof } from '../../core/authentication/keyRotation.js';
import { AGENT_ACTIONS } from '../../core/server/constants/index.js';
import {
  BTP_ERROR_REFRESH_NOT_CURRENT_KEY,
  BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH,
  BTP_ERROR_REGISTRATION_TOKEN_INVALID,
  BTP_ERROR_REGISTRATION_TOKEN_MISSING,
  BTP_ERROR_REGISTRATION_TOKEN_USED,
  BTP_ERROR_REGISTRATION_UNAVAILABLE,
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_TRUST_NOT_ALLOWED,
  BTP_ERROR_VALIDATION,
} from '../../core/error/index.js';
import type { BTPError } from '../../core/error/types.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type {
  AgentAction,
  BTPAgentArtifact,
  BTPAuthReqDoc,
  BTPAuthResDoc,
  BTPServerResponse,
} from '../../core/server/types.js';
import type { BTPRequestCtx, BTPResponseCtx } from '../types.js';
import { pemToBase64 } from '../../core/utils/index.js';
import * as ERRORS from '../../core/error/constant.js';

type Step = {
  request: BTPAgentArtifact;
  expect: 'accept' | 'refuse';
  reason?: string;
  error?: string;
};
type ForgedCase = {
  name: string;
  action: string;
  artifact: BTPAgentArtifact;
  expect: 'accept' | 'refuse';
  reason?: string;
};
const vectors = JSON.parse(
  readFileSync(new URL('../../../test/vectors/registration.vectors.json', import.meta.url), 'utf8'),
) as {
  now: string;
  tokenExpiryMs: number;
  identity: string;
  otherIdentity: string;
  keys: Record<string, { publicKeyPem: string; privateKeyPem: string; fingerprint: string }>;
  tokens: Record<string, { identity: string; token: string; issuedMsBeforeUse: number }>;
  sequences: { name: string; tokenStore: boolean; issue: string[]; steps: Step[] }[];
  concurrent: {
    issue: string[];
    requests: BTPAgentArtifact[];
    expect: { accept: number; refuse: number; error: string };
  };
  forged: {
    enrolled: { agentId: string; identity: string; key: string };
    correspondentTrust: { senderId: string; receiverId: string; key: string };
    cases: ForgedCase[];
  };
};

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

const ALICE = 'alice$saas.example';
const BOB = 'bob$saas.example';
const CAROL = 'carol$other.example';

/** Every error constant, by code, to read a wire message back as its error. */
const byCode = (code: string | undefined): BTPError =>
  Object.values(ERRORS).find((e) => e.code === code)!;

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
  /** An accepted trust record `senderId → receiverId` holding `publicKey`. */
  seed(senderId: string, receiverId: string, publicKey: string) {
    const id = computeTrustId(senderId, receiverId);
    this.records.set(id, {
      id,
      senderId,
      receiverId,
      status: 'accepted',
      createdAt: '2026-10-01T00:00:00.000Z',
      decidedBy: receiverId,
      decidedAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      publicKeyBase64: pemToBase64(publicKey),
      publicKeyFingerprint: getFingerprintFromPem(publicKey),
      keyHistory: [],
      privacyType: 'unencrypted',
    });
  }
  agents() {
    return [...this.records.values()].filter((r) => r.senderId.startsWith('btps_ag_'));
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

/** An agent artifact as a device signs it. */
const agentArtifact = async (
  action: AgentAction,
  agentId: string,
  to: string,
  signedBy: PemKeys,
  document?: BTPAuthReqDoc,
): Promise<BTPAgentArtifact> => {
  const unsigned = {
    version: '1.1.0',
    id: crypto.randomUUID(),
    action,
    agentId,
    to,
    issuedAt: new Date().toISOString(),
    encryption: null,
    ...(document ? { document } : {}),
  };
  return { ...unsigned, signature: await signBtpPayload(unsigned, signedBy) } as BTPAgentArtifact;
};

/** An auth.request as BtpsAuthentication.authenticate builds it. */
const registrationRequest = (
  device: PemKeys,
  authToken: string,
  { identity = ALICE, to = ALICE, agentId = 'temp' } = {},
) =>
  agentArtifact('auth.request', agentId, to, device, {
    identity,
    authToken,
    publicKey: device.publicKey,
    agentInfo: { deviceName: 'test' },
  });

describe('device registration bound to the identity, through the server', () => {
  let trustStore: MapTrustStore;
  let tokenStore: InMemoryTokenStore;
  /** The platform's own BtpsAuthentication: it issues tokens and refreshes sessions. */
  let auth: BtpsAuthentication;
  /** Every agent artifact the application's handler was given. */
  let handled: BTPAgentArtifact[];
  let reissued: { data?: BTPAuthResDoc; error?: Error }[];

  const makeServer = (withTokenStore = true) => {
    const server = new BtpsServer({
      trustStore,
      ...(withTokenStore ? { tokenStore } : {}),
      serverIdentity: { identity: 'server$saas.example', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
    });
    server.onIncomingArtifact('Agent', async (artifact) => {
      handled.push(artifact);
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
    const writes = (socket.write as Mock).mock.calls;
    expect(writes).toHaveLength(1);
    return JSON.parse(writes[0]![0] as string) as BTPServerResponse;
  };

  const issueToken = async (identity = ALICE) => {
    const token = BtpsAuthentication.generateAuthToken(identity);
    await auth.storeAuthToken(token, identity, identity);
    return token;
  };

  const registered = (response: BTPServerResponse) => response.document as BTPAuthResDoc;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    trustStore = new MapTrustStore();
    tokenStore = new InMemoryTokenStore();
    auth = new BtpsAuthentication({ trustStore, tokenStore });
    handled = [];
    reissued = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('device registration cases', () => {
    it('the full lifecycle: issue, register, use, refresh with rotation, and reuse refused', async () => {
      const server = makeServer();
      const device = genKeys();
      const token = await issueToken();

      // Register.
      const response = await deliver(server, await registrationRequest(device, token));
      expect(response.status.ok).toBe(true);
      const { agentId, refreshToken, decryptBy } = registered(response);
      expect(agentId).toMatch(/^btps_ag_/);
      expect(decryptBy).toBe(ALICE);
      // The server answered it: the application never saw the auth.request.
      expect(handled).toHaveLength(0);
      const [record] = trustStore.agents();
      expect(trustStore.agents()).toHaveLength(1);
      expect(record).toMatchObject({ senderId: agentId, receiverId: ALICE, status: 'accepted' });
      expect(record!.publicKeyFingerprint).toBe(getFingerprintFromPem(device.publicKey));

      // Use the device.
      const used = await deliver(
        server,
        await agentArtifact('inbox.fetch', agentId, ALICE, device),
      );
      expect(used.status.ok).toBe(true);
      expect(handled.map((a) => a.action)).toEqual(['inbox.fetch']);

      // Refresh, rotating the key.
      const next = genKeys();
      const { publicKey, keyProof } = await signKeyProof({
        agentId,
        identity: ALICE,
        newKey: next,
      });
      const refreshed = await deliver(
        server,
        await agentArtifact('auth.refresh', agentId, ALICE, device, {
          identity: ALICE,
          authToken: refreshToken,
          publicKey,
          keyProof,
        }),
      );
      expect(refreshed.status.ok).toBe(true);
      expect(reissued[0]!.data?.refreshToken).toBeTruthy();
      expect(trustStore.agents()[0]!.publicKeyFingerprint).toBe(
        getFingerprintFromPem(next.publicKey),
      );
      const oldKey = await deliver(
        server,
        await agentArtifact('inbox.fetch', agentId, ALICE, device),
      );
      expect(oldKey.status.message).toBe(BTP_ERROR_SIG_VERIFICATION.message);
      const newKey = await deliver(
        server,
        await agentArtifact('inbox.fetch', agentId, ALICE, next),
      );
      expect(newKey.status.ok).toBe(true);

      // The token registered one device, once.
      const reused = await deliver(server, await registrationRequest(genKeys(), token));
      expect(reused.status.message).toBe(BTP_ERROR_REGISTRATION_TOKEN_USED.message);
      expect(trustStore.agents()).toHaveLength(1);
    });

    it('an auth.request without a token is refused', async () => {
      const server = makeServer();
      await issueToken();
      const response = await deliver(server, await registrationRequest(genKeys(), ''));
      expect(response.status.message).toBe(BTP_ERROR_REGISTRATION_TOKEN_MISSING.message);
      expect(trustStore.agents()).toHaveLength(0);
    });

    it('an unknown token is refused', async () => {
      const server = makeServer();
      await issueToken();
      const response = await deliver(server, await registrationRequest(genKeys(), 'ZZZZZZZZZZZZ'));
      expect(response.status.message).toBe(BTP_ERROR_REGISTRATION_TOKEN_INVALID.message);
    });

    it('an expired token is refused: tokens last 15 minutes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'));
      const server = makeServer();
      const token = await issueToken();
      vi.setSystemTime(new Date('2026-10-16T00:15:01.000Z'));
      const response = await deliver(server, await registrationRequest(genKeys(), token));
      expect(response.status.message).toBe(BTP_ERROR_REGISTRATION_TOKEN_INVALID.message);
      expect(trustStore.agents()).toHaveLength(0);
    });

    it('a token issued to another identity is refused, and binds nothing', async () => {
      const server = makeServer();
      const bobsToken = await issueToken(BOB);
      // Presented for alice: looked up under alice, not found.
      const forAlice = await deliver(server, await registrationRequest(genKeys(), bobsToken));
      expect(forAlice.status.message).toBe(BTP_ERROR_REGISTRATION_TOKEN_INVALID.message);
      // The document names bob, the artifact goes to alice.
      const split = await deliver(
        server,
        await registrationRequest(genKeys(), bobsToken, { identity: BOB, to: ALICE }),
      );
      expect(split.status.message).toBe(BTP_ERROR_REGISTRATION_IDENTITY_MISMATCH.message);
      expect(trustStore.agents()).toHaveLength(0);
      // Bob's token still registers a device for bob, and only for bob.
      const forBob = await deliver(
        server,
        await registrationRequest(genKeys(), bobsToken, { identity: BOB, to: BOB }),
      );
      expect(forBob.status.ok).toBe(true);
      expect(trustStore.agents().map((r) => r.receiverId)).toEqual([BOB]);
    });

    it('a token reused on a second device is refused', async () => {
      const server = makeServer();
      const token = await issueToken();
      const first = await deliver(server, await registrationRequest(genKeys(), token));
      expect(first.status.ok).toBe(true);
      const second = await deliver(server, await registrationRequest(genKeys(), token));
      expect(second.status.message).toBe(BTP_ERROR_REGISTRATION_TOKEN_USED.message);
      expect(trustStore.agents()).toHaveLength(1);
    });

    it('two devices racing with one token: one is registered', async () => {
      const server = makeServer();
      const token = await issueToken();
      const responses = await Promise.all([
        deliver(server, await registrationRequest(genKeys(), token)),
        deliver(server, await registrationRequest(genKeys(), token)),
      ]);
      expect(responses.filter((r) => r.status.ok)).toHaveLength(1);
      expect(responses.find((r) => !r.status.ok)!.status.message).toBe(
        BTP_ERROR_REGISTRATION_TOKEN_USED.message,
      );
      expect(trustStore.agents()).toHaveLength(1);
    });

    it('with no token store, every auth.request is refused', async () => {
      const server = makeServer(false);
      const token = await issueToken();
      const response = await deliver(server, await registrationRequest(genKeys(), token));
      expect(response.status.message).toBe(BTP_ERROR_REGISTRATION_UNAVAILABLE.message);
      expect(trustStore.agents()).toHaveLength(0);
      expect(handled).toHaveLength(0);
    });

    it('the agent id is the server’s, never the one in the request', async () => {
      const server = makeServer();
      const token = await issueToken();
      const chosen = 'btps_ag_00000000-0000-4000-8000-000000000001';
      const response = await deliver(
        server,
        await registrationRequest(genKeys(), token, { agentId: chosen }),
      );
      expect(registered(response).agentId).not.toBe(chosen);
      expect(trustStore.records.has(computeTrustId(chosen, ALICE))).toBe(false);
    });

    it('a refusal at the signature does not spend the token', async () => {
      const server = makeServer();
      const token = await issueToken();
      const device = genKeys();
      const forged = await registrationRequest(device, token);
      forged.signature = (await registrationRequest(genKeys(), token)).signature;
      const refused = await deliver(server, forged);
      expect(refused.status.message).toBe(BTP_ERROR_SIG_VERIFICATION.message);
      const accepted = await deliver(server, await registrationRequest(device, token));
      expect(accepted.status.ok).toBe(true);
    });
  });

  describe('a forged agent artifact is refused for every action', () => {
    it('a correspondent cannot act as the receiver’s device (the case open after PR #20)', async () => {
      const server = makeServer();
      const carol = genKeys();
      // Alice trusts carol: a record carol → alice, holding carol's key.
      trustStore.seed(CAROL, ALICE, carol.publicKey);
      const response = await deliver(
        server,
        await agentArtifact('inbox.fetch', CAROL, ALICE, carol),
      );
      expect(response.status.ok).toBe(false);
      expect(response.status.message).toBe(BTP_ERROR_SIG_VERIFICATION.message);
      expect(handled).toHaveLength(0);
    });

    it('a device of one identity cannot act for another', async () => {
      const server = makeServer();
      const device = genKeys();
      const { agentId } = registered(
        await deliver(server, await registrationRequest(device, await issueToken())),
      );
      const response = await deliver(
        server,
        await agentArtifact('inbox.fetch', agentId, BOB, device),
      );
      expect(response.status.message).toBe(BTP_ERROR_SIG_VERIFICATION.message);
      expect(handled).toHaveLength(0);
    });

    it('a refresh named after a real device but signed by another key is refused', async () => {
      const server = makeServer();
      const device = genKeys();
      const { agentId, refreshToken } = registered(
        await deliver(server, await registrationRequest(device, await issueToken())),
      );
      const thief = genKeys();
      const response = await deliver(
        server,
        await agentArtifact('auth.refresh', agentId, ALICE, thief, {
          identity: ALICE,
          authToken: refreshToken,
          publicKey: thief.publicKey,
        }),
      );
      expect(response.status.message).toBe(BTP_ERROR_REFRESH_NOT_CURRENT_KEY.message);
      expect(reissued).toHaveLength(0);
    });
  });

  describe('registration.vectors.json, through the server', () => {
    const issueVectorTokens = async (names: string[]) => {
      for (const name of names) {
        const t = vectors.tokens[name]!;
        await tokenStore.store(
          t.token,
          null,
          t.identity,
          vectors.tokenExpiryMs - t.issuedMsBeforeUse,
          t.identity,
        );
      }
    };
    const atVectorTime = () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(vectors.now));
    };

    it.each(vectors.sequences.map((s) => [s.name, s] as const))('sequence/%s', async (_, s) => {
      atVectorTime();
      await issueVectorTokens(s.issue);
      const server = makeServer(s.tokenStore);
      for (const step of s.steps) {
        const response = await deliver(server, step.request);
        if (step.expect === 'accept') {
          expect(response.status.ok).toBe(true);
          const { agentId } = registered(response);
          const document = step.request.document as BTPAuthReqDoc;
          const record = trustStore.records.get(computeTrustId(agentId, document.identity));
          expect(record?.publicKeyFingerprint).toBe(getFingerprintFromPem(document.publicKey));
        } else {
          expect(response.status.message).toBe(byCode(step.error).message);
        }
      }
      expect(handled).toHaveLength(0);
    });

    it('concurrent: one of two racing registrations is accepted', async () => {
      atVectorTime();
      await issueVectorTokens(vectors.concurrent.issue);
      const server = makeServer();
      const responses = await Promise.all(
        vectors.concurrent.requests.map((r) => deliver(server, r)),
      );
      expect(responses.filter((r) => r.status.ok)).toHaveLength(vectors.concurrent.expect.accept);
      const refused = responses.filter((r) => !r.status.ok);
      expect(refused).toHaveLength(vectors.concurrent.expect.refuse);
      for (const r of refused) {
        expect(r.status.message).toBe(byCode(vectors.concurrent.expect.error).message);
      }
    });

    it('forged: the vectors cover every agent action but auth.request', () => {
      const covered = new Set(vectors.forged.cases.map((c) => c.action));
      expect([...covered].sort()).toEqual(AGENT_ACTIONS.filter((a) => a !== 'auth.request').sort());
    });

    // The core steps every agent artifact goes through: signature, then trust.
    it.each(vectors.forged.cases.map((c) => [c.name, c] as const))('forged/%s', async (_, c) => {
      atVectorTime();
      const { enrolled, correspondentTrust } = vectors.forged;
      trustStore.seed(
        enrolled.agentId,
        enrolled.identity,
        vectors.keys[enrolled.key]!.publicKeyPem,
      );
      trustStore.seed(
        correspondentTrust.senderId,
        correspondentTrust.receiverId,
        vectors.keys[correspondentTrust.key]!.publicKeyPem,
      );
      const server = makeServer();
      const data = { type: 'agent' as const, artifact: c.artifact, respondNow: true };
      const signature = await server['verifySignature'](data);
      const trust = await server['verifyTrust'](data);
      if (c.expect === 'accept') {
        expect(signature.isValid).toBe(true);
        expect(trust.isTrusted).toBe(true);
      } else {
        expect(signature.isValid).toBe(false);
        if (c.reason !== 'signature') {
          expect(trust.isTrusted).toBe(false);
          expect(trust.error?.code).toBe(BTP_ERROR_TRUST_NOT_ALLOWED.code);
        }
      }
    });
  });
});
