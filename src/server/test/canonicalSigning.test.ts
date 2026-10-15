/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * EBA-115 (BTPS 1.1 item 5): signatures are over the RFC 8785 (JCS) form, end
 * to end, with real keys. Only DNS key lookup is faked.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import tls, { TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import { BtpsDelegator } from '../../core/delegation/BtpsDelegator.js';
import { signBtpPayload, signEncrypt, verifySignature } from '../../core/crypto/index.js';
import { parseJson } from '../../core/crypto/jcs.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { AbstractIdentityStore } from '../../core/storage/AbstractIdentityStore.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { BTPIdentityRecord, IdentityPubKeyRecord } from '../../core/storage/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type {
  BTPAttestation,
  BTPDelegation,
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

const keys = {
  alice: genKeys(), // sender
  saas: genKeys(), // delegator and attestor
  agent: genKeys(), // the device the delegation is for
  server: genKeys(), // the receiving server's own identity
};
const identities: Record<string, PemKeys> = {
  'alice$saas.example': keys.alice,
  'delegator$saas.example': keys.saas,
  'server$receiver.example': keys.server,
};

/** The same JSON value with every object's keys in reverse order. */
const reorder = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .reverse()
        .map((k) => [k, reorder((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
};

/** Sends the artifact over a "wire" that reorders every key, as another implementation might. */
const overTheWire = <T>(artifact: T): T => {
  const line = JSON.stringify(reorder(artifact));
  expect(line).not.toBe(JSON.stringify(artifact));
  return parseJson<T>(line);
};

class EmptyTrustStore extends AbstractTrustStore<BTPTrustRecord> {
  constructor() {
    super({ connection: null, entityName: 'empty' });
  }
  async getById() {
    return undefined;
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
    return [];
  }
}

const aliceKeyRecord: IdentityPubKeyRecord = {
  selector: 'btps1',
  publicKey: keys.alice.publicKey,
  keyType: 'rsa',
  version: '1.0.0',
  createdAt: '2026-01-01T00:00:00.000Z',
};

class OneIdentityStore extends AbstractIdentityStore<BTPIdentityRecord> {
  constructor() {
    super({ connection: null, entityName: 'one' });
  }
  async getPublicKeyRecord() {
    return aliceKeyRecord;
  }
  async getById() {
    return undefined;
  }
  async create(): Promise<BTPIdentityRecord> {
    throw new Error('not used');
  }
  async update(): Promise<BTPIdentityRecord> {
    throw new Error('not used');
  }
  async delete(): Promise<void> {}
}

const baseArtifact = () => ({
  version: '1.0.0',
  from: 'alice$saas.example',
  to: 'bob$receiver.example',
  type: 'BTPS_DOC' as const,
  document: {
    title: 'Invoice ☕ — März',
    id: 'INV-1',
    issuedAt: '2026-01-01T00:00:00.000Z',
    status: 'unpaid',
    totalAmount: { value: 1250, currency: 'AUD' },
    lineItems: {
      columns: ['Description', 'Amount'],
      rows: [{ Description: 'Ünïcödé 😀', Amount: 1250 }],
    },
  },
});

describe('EBA-115: canonical signing end to end', () => {
  let server: BtpsServer;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    vi.mocked(utils.resolvePublicKey).mockImplementation(
      async (identity: string) => identities[identity]?.publicKey,
    );
    vi.mocked(utils.getHostAndSelector).mockResolvedValue({
      host: 'btps.saas.example:3443',
      selector: 'btps1',
    });
    server = new BtpsServer({
      trustStore: new EmptyTrustStore(),
      identityStore: new OneIdentityStore(),
      serverIdentity: { identity: 'server$receiver.example', ...keys.server },
      tlsOptions: { key: 'unused', cert: 'unused' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const signedArtifact = async (): Promise<BTPTransporterArtifact> => {
    const { payload, error } = await signEncrypt(
      undefined,
      { accountName: 'alice', domainName: 'saas.example', selector: 'btps1', pemFiles: keys.alice },
      baseArtifact(),
    );
    expect(error).toBeUndefined();
    return payload as unknown as BTPTransporterArtifact;
  };

  const serverVerifies = (artifact: BTPTransporterArtifact) =>
    server['verifySignature']({ artifact, type: 'transporter' } as ProcessedArtifact);

  it('the server verifies a transporter artifact whatever order its keys arrive in', async () => {
    const artifact = await signedArtifact();
    expect(await serverVerifies(artifact)).toMatchObject({ isValid: true });
    expect(await serverVerifies(overTheWire(artifact))).toMatchObject({ isValid: true });
  });

  it('the server does not verify an artifact changed after signing', async () => {
    const artifact = await signedArtifact();
    const tampered = overTheWire(artifact);
    (tampered.document as { totalAmount: { value: number } }).totalAmount.value = 1;
    expect(await serverVerifies(tampered)).toMatchObject({ isValid: false });
  });

  it('the server refuses a line with a duplicate member name before anything else', async () => {
    const artifact = await signedArtifact();
    const line = JSON.stringify(artifact);
    expect(server['_parseAndValidateArtifact'](line).error).toBeUndefined();

    const duplicated = line.replace('"to":', '"to":"mallory$receiver.example","to":');
    expect(JSON.parse(duplicated).to).toBe(artifact.to); // JSON.parse would let it through
    expect(server['_parseAndValidateArtifact'](duplicated)).toEqual({ error: 'JSON' });
  });

  it('a delegation made by BtpsDelegator verifies on the server, whatever the key order', async () => {
    const delegator = new BtpsDelegator({
      identity: 'delegator$saas.example',
      privateKey: keys.saas.privateKey,
      autoInit: false,
    });
    await delegator.init();

    const agentSigned = await signEncrypt(
      undefined,
      { accountName: 'alice', domainName: 'saas.example', selector: 'btps1', pemFiles: keys.agent },
      baseArtifact(),
    );
    const delegated = await delegator.delegateArtifact(
      'btps_ag_device-1',
      keys.agent.publicKey,
      agentSigned.payload as unknown as BTPTransporterArtifact,
    );

    expect(await serverVerifies(delegated)).toMatchObject({ isValid: true });
    expect(await serverVerifies(overTheWire(delegated))).toMatchObject({ isValid: true });

    const forged = overTheWire(delegated);
    forged.delegation!.agentPubKey = keys.alice.publicKey;
    expect(await serverVerifies(forged)).toMatchObject({ isValid: false });
  });

  it('an attestation made by BtpsDelegator verifies on the server, whatever the key order', async () => {
    const delegator = new BtpsDelegator({
      identity: 'delegator$saas.example',
      privateKey: keys.saas.privateKey,
      autoInit: false,
    });
    await delegator.init();

    const agentSigned = await signEncrypt(
      undefined,
      { accountName: 'alice', domainName: 'saas.example', selector: 'btps1', pemFiles: keys.agent },
      baseArtifact(),
    );
    const delegated = await delegator.delegateArtifact(
      'btps_ag_device-1',
      keys.agent.publicKey,
      agentSigned.payload as unknown as BTPTransporterArtifact,
      { identity: 'alice$saas.example', keyPair: keys.alice },
    );
    const attested = (artifact: BTPTransporterArtifact) =>
      artifact.delegation as BTPDelegation & { attestation: BTPAttestation };

    expect(attested(delegated).attestation.signedBy).toBe('delegator$saas.example');
    expect(await server['verifyAttestation'](attested(delegated))).toMatchObject({
      isValid: true,
    });
    expect(await server['verifyAttestation'](attested(overTheWire(delegated)))).toMatchObject({
      isValid: true,
    });

    // The delegation signature itself (by alice, the user) is over the artifact
    // and the delegation as it was before the attestation was added.
    const { signature, attestation: _attestation, ...unattested } = attested(delegated);
    const { delegation: _delegation, ...artifact } = overTheWire(delegated);
    expect(
      verifySignature(
        { ...artifact, delegation: reorder(unattested) },
        signature,
        keys.alice.publicKey,
      ).isValid,
    ).toBe(true);
  });

  // Addendum item 10 ("an attested delegation never verifies on the server
  // path"), not EBA-115's: the delegation is signed before the attestation is
  // added, but verifyDelegation checks it with the attestation still in. The
  // same on release/1.1 before JCS.
  it.fails(
    'the server accepts an attested delegation (expected failure until addendum item 10 is fixed)',
    async () => {
      const delegator = new BtpsDelegator({
        identity: 'delegator$saas.example',
        privateKey: keys.saas.privateKey,
        autoInit: false,
      });
      await delegator.init();
      const agentSigned = await signEncrypt(
        undefined,
        {
          accountName: 'alice',
          domainName: 'saas.example',
          selector: 'btps1',
          pemFiles: keys.agent,
        },
        baseArtifact(),
      );
      const delegated = await delegator.delegateArtifact(
        'btps_ag_device-1',
        keys.agent.publicKey,
        agentSigned.payload as unknown as BTPTransporterArtifact,
        { identity: 'alice$saas.example', keyPair: keys.alice },
      );
      expect(await serverVerifies(delegated)).toMatchObject({ isValid: true });
    },
  );

  it('the server signs its own response over the JCS form', async () => {
    // Captured as handed to sendBtpsResponse, before its schema check: on
    // release/1.1 that check refuses the identity-lookup document (a separate
    // defect, reported on EBA-115's pull request), and signing is what is
    // under test here.
    const sent: BTPServerResponse[] = [];
    vi.spyOn(
      server as unknown as { sendBtpsResponse: () => void },
      'sendBtpsResponse',
    ).mockImplementation((...args: unknown[]) => {
      sent.push(args[1] as BTPServerResponse);
    });
    const socket = new EventEmitter() as unknown as TLSSocket;

    await server['handleIdentityLookup'](
      {
        version: '1.0.0',
        id: 'lookup-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        identity: 'alice$saas.example',
        from: 'bob$receiver.example',
        hostSelector: 'btps1',
      },
      {
        req: {} as BTPRequestCtx,
        res: { socket, reqId: 'lookup-1' } as unknown as BTPResponseCtx,
      },
    );

    expect(sent).toHaveLength(1);
    const response = overTheWire(sent[0]!);
    const { signature, ...signed } = response;
    expect(signed.signedBy).toBe('server$receiver.example');
    expect(verifySignature(signed, signature!, keys.server.publicKey).isValid).toBe(true);
  });

  const signedResponse = (extra: Record<string, unknown>) => {
    const unsigned = {
      ...server.prepareBtpsResponse({ ok: true, message: 'success', code: 200 }, 'req-1'),
      type: 'btps_response' as const,
      signatureSelector: 'btps1',
      signedBy: 'server$receiver.example',
      ...extra,
    } as unknown as BTPServerResponse;
    return { ...unsigned, signature: signBtpPayload(unsigned, keys.server) };
  };

  it('the client verifies a signed server response whatever its key order', async () => {
    const client = new BtpsClient({ to: 'server$receiver.example' });
    // `encryption: null` is signed here because the client adds it before
    // verifying; see the expected failure below.
    const response = signedResponse({ encryption: null });

    expect(await client['verifyServerMessage'](overTheWire(response))).toMatchObject({
      isValid: true,
    });

    const tampered = overTheWire(response);
    tampered.status.message = 'tampered';
    expect(await client['verifyServerMessage'](tampered)).toMatchObject({ isValid: false });
  });

  // Pre-existing defect, not EBA-115's, and the same on release/1.1 before
  // JCS: verifyServerMessage verifies `{ ...msg, encryption: msg.encryption ?? null }`,
  // so a response the server signed without an `encryption` member (as
  // handleIdentityLookup does) never verifies. Reported on the pull request.
  it.fails(
    'the client verifies a server response signed without an encryption member (expected failure: pre-existing client defect)',
    async () => {
      const client = new BtpsClient({ to: 'server$receiver.example' });
      expect(await client['verifyServerMessage'](signedResponse({}))).toMatchObject({
        isValid: true,
      });
    },
  );
});
