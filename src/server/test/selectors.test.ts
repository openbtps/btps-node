/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Separate selectors: a transporter artifact names the sender key it
 * was signed with (signatureSelector) apart from the receiver key it was
 * encrypted to (encryptionSelector), and 1.0's single `selector` is refused.
 * Real keys, end to end through the server's parse and verify steps; only
 * DNS key lookup is faked.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import tls from 'tls';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { BtpsTransporter } from '../../client/btpsTransporter.js';
import type { ZodError } from 'zod';
import { BtpsDelegator } from '../../core/delegation/BtpsDelegator.js';
import { decryptVerify, resolveSignatureKey, signEncrypt } from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import { BtpTransporterArtifactSchema } from '../../core/server/schemas/artifacts/transporterSchema.js';
import { BtpServerResponseSchema } from '../../core/server/schemas/responseSchema.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { PemKeys } from '../../core/crypto/types.js';
import type { BTPTransporterArtifact } from '../../core/server/types.js';
import type { ProcessedArtifact } from '../types.js';
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

// What DNS publishes, by identity and selector. alice rotated btps1 -> btps2
// and keeps btps1 published; bob is on btps1.
const dns: Record<string, Record<string, PemKeys>> = {
  'alice$saas.example': { btps1: genKeys(), btps2: genKeys() },
  'bob$receiver.example': { btps1: genKeys(), btps2: genKeys() },
  'delegator$saas.example': { sk1: genKeys() },
  'carol$custom.example': { c7: genKeys() },
};
const hostSelectors: Record<string, string> = {
  'alice$saas.example': 'btps2',
  'bob$receiver.example': 'btps1',
  'delegator$saas.example': 'sk1',
  'carol$custom.example': 'c7',
};
const key = (identity: string, selector: string) => dns[identity]![selector]!;

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

const invoice = {
  schemaVersion: 2,
  type: 'invoice',
  title: 'Invoice 116',
  id: 'INV-116',
  issuedAt: '2026-01-01T00:00:00.000Z',
  lineItems: {
    columns: ['Description', 'Amount'],
    rows: [{ Description: 'Item', Amount: 99 }],
  },
  totalAmount: { amount: 99, currency: 'AUD' },
};

/** alice, on her current selector, sends to bob, encrypted to his current selector. */
const aliceSends = async (encrypted = true): Promise<BTPTransporterArtifact> => {
  const { payload, error } = await signEncrypt(
    'bob$receiver.example',
    {
      accountName: 'alice',
      domainName: 'saas.example',
      selector: hostSelectors['alice$saas.example']!,
      pemFiles: key('alice$saas.example', hostSelectors['alice$saas.example']!),
    },
    {
      version: '1.0.0',
      type: 'BTPS_DOC',
      from: 'alice$saas.example',
      to: 'bob$receiver.example',
      document: invoice,
      ...(encrypted ? { encryptionSelector: hostSelectors['bob$receiver.example'] } : {}),
    },
    encrypted
      ? {
          signature: { algorithmHash: 'sha256' },
          encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
        }
      : undefined,
  );
  expect(error).toBeUndefined();
  return payload as unknown as BTPTransporterArtifact;
};

describe('separate signatureSelector and encryptionSelector', () => {
  let server: BtpsServer;

  beforeEach(() => {
    vi.spyOn(tls, 'createServer').mockImplementation(
      () => new EventEmitter() as unknown as tls.Server,
    );
    vi.mocked(utils.resolvePublicKey).mockImplementation(
      async (identity: string, selector: string) => dns[identity]?.[selector]?.publicKey,
    );
    vi.mocked(utils.getHostAndSelector).mockImplementation(async (identity: string) => ({
      version: '1.1.0',
      host: 'btps.example:3443',
      selector: hostSelectors[identity]!,
    }));
    server = new BtpsServer({
      trustStore: new EmptyTrustStore(),
      serverIdentity: { identity: 'server$receiver.example', selector: 'srv1', ...genKeys() },
      tlsOptions: { key: 'unused', cert: 'unused' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const serverAccepts = (artifact: unknown) =>
    server['_parseAndValidateArtifact'](JSON.stringify(artifact));
  const serverVerifies = (artifact: BTPTransporterArtifact) =>
    server['verifySignature']({ artifact, type: 'transporter' } as ProcessedArtifact);

  it('a sender on btps2 delivers to a receiver on btps1: it parses, verifies and decrypts', async () => {
    const artifact = await aliceSends();
    expect(artifact).toMatchObject({ signatureSelector: 'btps2', encryptionSelector: 'btps1' });
    expect(artifact).not.toHaveProperty('selector');

    expect(serverAccepts(artifact).error).toBeUndefined();
    expect(await serverVerifies(artifact)).toMatchObject({ isValid: true });

    const { payload, error } = await decryptVerify(
      (await resolveSignatureKey(artifact))!,
      { ...artifact },
      (selector) => dns['bob$receiver.example']![selector]?.privateKey,
    );
    expect(error).toBeUndefined();
    expect(payload?.document).toEqual(invoice);
  });

  it('the server verifies with the sender key at signatureSelector, never at the encryption selector', async () => {
    const artifact = await aliceSends();
    expect(await serverVerifies(artifact)).toMatchObject({ isValid: true });
    expect(utils.resolvePublicKey).toHaveBeenCalledWith('alice$saas.example', 'btps2');
    expect(utils.resolvePublicKey).not.toHaveBeenCalledWith('alice$saas.example', 'btps1');

    // Naming another published sender key does not verify (and changes the signed bytes).
    expect(await serverVerifies({ ...artifact, signatureSelector: 'btps1' })).toMatchObject({
      isValid: false,
    });
  });

  it('an unencrypted artifact carries a signatureSelector and no encryptionSelector', async () => {
    const artifact = await aliceSends(false);
    expect(artifact.encryption).toBeNull();
    expect(artifact).not.toHaveProperty('encryptionSelector');
    expect(serverAccepts(artifact).error).toBeUndefined();
    expect(await serverVerifies(artifact)).toMatchObject({ isValid: true });
  });

  describe('1.0 artifacts are refused (no 1.0 fallback)', () => {
    const asOneDotZero = (artifact: BTPTransporterArtifact) => {
      const { signatureSelector: _s, encryptionSelector, ...rest } = artifact;
      return { ...rest, selector: encryptionSelector ?? 'btps1' };
    };

    it('the server refuses an artifact that carries only the single selector', async () => {
      const legacy = asOneDotZero(await aliceSends());
      expect(serverAccepts(legacy).error).toBe('VALIDATION');
    });

    it('with a validation error that says what replaced the field', async () => {
      const result = BtpTransporterArtifactSchema.safeParse(asOneDotZero(await aliceSends()));
      expect(result.success).toBe(false);
      const messages = result.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      expect(messages).toContainEqual(
        expect.stringMatching(
          /^selector: selector is not part of BTPS 1\.1: use signatureSelector .* and encryptionSelector/,
        ),
      );
    });

    it('the transporter refuses to send one, naming the field', async () => {
      const transporter = new BtpsTransporter({});
      const { response, error } = await transporter.transport(
        'bob$receiver.example',
        asOneDotZero(await aliceSends()) as unknown as BTPTransporterArtifact,
      );
      expect(response).toBeUndefined();
      const { validationZodError } = error!.cause as { validationZodError: ZodError };
      expect(validationZodError.issues).toContainEqual(
        expect.objectContaining({
          path: ['selector'],
          message: expect.stringMatching(/signatureSelector .* encryptionSelector/),
        }),
      );
    });

    it('a server response naming its key with selector is refused too', () => {
      const result = BtpServerResponseSchema.safeParse({
        version: '1.0.0',
        status: { ok: true, code: 200 },
        id: 'r-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        type: 'btps_response',
        signature: { algorithmHash: 'sha256', value: 'v', fingerprint: 'f' },
        signedBy: 'server$receiver.example',
        selector: 'btps1',
      });
      expect(result.success).toBe(false);
      const paths = result.error!.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(expect.arrayContaining(['selector']));
    });
  });

  describe('schema rules for the two selectors', () => {
    it('an encrypted artifact must name its encryptionSelector', async () => {
      const { encryptionSelector: _e, ...artifact } = await aliceSends();
      const result = BtpTransporterArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
      expect(result.error!.issues[0]!.path).toEqual(['encryptionSelector']);
    });

    it('an unencrypted artifact may not name an encryptionSelector', async () => {
      const artifact = { ...(await aliceSends(false)), encryptionSelector: 'btps1' };
      const result = BtpTransporterArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
      expect(result.error!.issues[0]!.path).toEqual(['encryptionSelector']);
    });

    it('an undelegated artifact must name its signatureSelector', async () => {
      const { signatureSelector: _s, ...artifact } = await aliceSends();
      const result = BtpTransporterArtifactSchema.safeParse(artifact);
      expect(result.success).toBe(false);
      expect(result.error!.issues[0]!.path).toEqual(['signatureSelector']);
      expect(await serverVerifies(artifact as unknown as BTPTransporterArtifact)).toMatchObject({
        isValid: false,
      });
    });
  });

  describe('BtpsDelegator: each signature names its own signer key', () => {
    const delegator = async () => {
      const d = new BtpsDelegator({
        identity: 'delegator$saas.example',
        privateKey: key('delegator$saas.example', 'sk1').privateKey,
        autoInit: false,
      });
      await d.init();
      return d;
    };
    const agentKeys = genKeys();
    // As BtpsAgent builds it: signed by the device key, so no signatureSelector.
    const agentArtifact = (): BTPTransporterArtifact => ({
      version: '1.0.0',
      id: 'agent-artifact-1',
      issuedAt: '2026-01-01T00:00:00.000Z',
      type: 'BTPS_DOC',
      from: 'carol$custom.example',
      to: 'bob$receiver.example',
      document: invoice as unknown as BTPTransporterArtifact['document'],
      encryption: null,
      signature: { algorithmHash: 'sha256', value: 'agent-signature', fingerprint: 'agent' },
    });

    it('a delegation names the delegator key; the artifact needs no signatureSelector', async () => {
      const delegated = await (
        await delegator()
      ).delegateArtifact('btps_ag_device-1', agentKeys.publicKey, agentArtifact());
      expect(delegated.delegation.signedBy).toBe('delegator$saas.example');
      expect(delegated.delegation.selector).toBe('sk1');
      expect(BtpTransporterArtifactSchema.safeParse(delegated).success).toBe(true);
    });

    it('on behalf of a user, the delegation names the user key and the attestation the attestor key', async () => {
      const delegated = await (
        await delegator()
      ).delegateArtifact('btps_ag_device-1', agentKeys.publicKey, agentArtifact(), {
        identity: 'carol$custom.example',
        keyPair: key('carol$custom.example', 'c7'),
      });
      const { delegation } = delegated;
      expect(delegation.signedBy).toBe('carol$custom.example');
      expect(delegation.selector).toBe('c7');
      expect(delegation.attestation?.signedBy).toBe('delegator$saas.example');
      expect(delegation.attestation?.selector).toBe('sk1');

      expect(
        await server['verifyAttestation'](
          delegation as typeof delegation & {
            attestation: NonNullable<typeof delegation.attestation>;
          },
        ),
      ).toMatchObject({ isValid: true });
      expect(utils.resolvePublicKey).toHaveBeenCalledWith('delegator$saas.example', 'sk1');
    });
  });

  it('a signed server response names its key as signatureSelector', async () => {
    const sent: unknown[] = [];
    vi.spyOn(
      server as unknown as { sendBtpsResponse: () => void },
      'sendBtpsResponse',
    ).mockImplementation((...args: unknown[]) => {
      sent.push(args[1]);
    });
    Object.assign(server, {
      identityStore: {
        getPublicKeyRecord: async () => ({
          selector: 'btps1',
          publicKey: key('bob$receiver.example', 'btps1').publicKey,
          keyType: 'rsa',
          version: '1.0.0',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });

    await server['handleIdentityLookup'](
      {
        version: '1.0.0',
        id: 'lookup-1',
        issuedAt: '2026-01-01T00:00:00.000Z',
        identity: 'bob$receiver.example',
        from: 'alice$saas.example',
        hostSelector: 'btps1',
      },
      {
        req: {} as never,
        res: { socket: new EventEmitter(), reqId: 'lookup-1' } as never,
      },
    );

    expect(sent).toHaveLength(1);
    // The server's own selector, not the request's hostSelector.
    expect(sent[0]).toMatchObject({ signatureSelector: 'srv1' });
    expect(sent[0]).not.toHaveProperty('selector');
  });
});
