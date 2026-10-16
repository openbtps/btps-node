/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1: every signing path signs through a Signer and
 * every decryption path decrypts through a Decrypter. The KMS signer and
 * decrypter here are KmsSigner and KmsDecrypter over a fake KMS client that
 * holds a key generated for the test: nothing here touches a real KMS.
 * Real keys otherwise, through the server's parse and verify steps; only DNS
 * lookup is faked.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import tls from 'tls';
import { EventEmitter } from 'events';
import { BtpsServer } from '../btpsServer.js';
import { BtpsClient } from '../../client/btpsClient.js';
import { BtpsAgent } from '../../client/btpsAgent.js';
import { BtpsDelegator } from '../../core/delegation/BtpsDelegator.js';
import {
  decryptBtpPayload,
  decryptVerify,
  encryptBtpPayload,
  KmsDecrypter,
  KmsSigner,
  PemDecrypter,
  resolveSignatureKey,
  signBtpPayload,
  signEncrypt,
  verifySignature,
  type KmsDecryptClient,
  type KmsSignClient,
} from '../../core/crypto/index.js';
import { AbstractTrustStore } from '../../core/trust/storage/AbstractTrustStore.js';
import type { BTPTrustRecord } from '../../core/trust/types.js';
import type { BTPEncryption, PemKeys } from '../../core/crypto/types.js';
import type { BTPServerResponse, BTPTransporterArtifact } from '../../core/server/types.js';
import type { ProcessedArtifact } from '../types.js';
import * as utils from '../../core/utils/index.js';

vi.mock('../../core/utils/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/utils/index.js')>();
  return {
    ...actual,
    resolvePublicKey: vi.fn(),
    getHostAndSelector: vi.fn(),
    getDnsIdentityParts: vi.fn(),
  };
});

const genKeys = (): PemKeys => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
};

/** A fake KMS: it holds the key and only ever hands back signatures and the public key. */
const fakeKms = (keys: PemKeys) => {
  const signClient: KmsSignClient = {
    sign: vi.fn(async ({ message }: { keyId: string; message: Uint8Array }) => ({
      signature: new Uint8Array(crypto.sign('sha256', Buffer.from(message), keys.privateKey)),
    })),
    getPublicKey: vi.fn(async () => ({ publicKeyPem: keys.publicKey })),
  };
  const decryptClient: KmsDecryptClient = {
    decrypt: vi.fn(async ({ encryptedKey }: { keyId: string; encryptedKey: Uint8Array }) => ({
      plaintextKey: new Uint8Array(
        crypto.privateDecrypt(
          {
            key: keys.privateKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256',
          },
          Buffer.from(encryptedKey),
        ),
      ),
    })),
  };
  return {
    signClient,
    decryptClient,
    signer: new KmsSigner({ client: signClient, keyId: 'test-sign-key' }),
    decrypter: new KmsDecrypter({ client: decryptClient, keyId: 'test-decrypt-key' }),
  };
};

// What DNS publishes, by identity and selector. alice signs at btps2 and bob
// receives at btps1, so the two selectors differ.
const dns: Record<string, Record<string, PemKeys>> = {
  'alice$saas.example': { btps1: genKeys(), btps2: genKeys() },
  'bob$receiver.example': { btps1: genKeys(), btps2: genKeys() },
  'delegator$saas.example': { sk1: genKeys() },
  'carol$custom.example': { c7: genKeys() },
  'server$receiver.example': { btps1: genKeys() },
};
const hostSelectors: Record<string, string> = {
  'alice$saas.example': 'btps2',
  'bob$receiver.example': 'btps1',
  'delegator$saas.example': 'sk1',
  'carol$custom.example': 'c7',
  'server$receiver.example': 'btps1',
};
const key = (identity: string, selector = hostSelectors[identity]!) => dns[identity]![selector]!;

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
  title: 'Invoice 441',
  id: 'INV-441',
  issuedAt: '2026-01-01T00:00:00.000Z',
  lineItems: {
    columns: ['Description', 'Amount'],
    rows: [{ Description: 'Item', Amount: 99 }],
  },
  totalAmount: { amount: 99, currency: 'AUD' },
};

type Opened = Parameters<typeof decryptVerify>[1];

/** An encryption block whose tag is cut to `bytes`. */
const withTag = (encryption: BTPEncryption, bytes: number): BTPEncryption => ({
  ...encryption,
  authTag: Buffer.from(encryption.authTag, 'base64').subarray(0, bytes).toString('base64'),
});

describe('the core signs through a Signer and decrypts through a Decrypter', () => {
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
      serverIdentity: {
        identity: 'server$receiver.example',
        selector: 'btps1',
        signer: fakeKms(key('server$receiver.example')).signer,
      },
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

  /** alice signs through `signer` at her selector, encrypted to bob's. */
  const aliceSends = async (signer: KmsSigner) => {
    const { payload, error } = await signEncrypt(
      'bob$receiver.example',
      {
        accountName: 'alice',
        domainName: 'saas.example',
        selector: hostSelectors['alice$saas.example']!,
        signer,
      },
      {
        version: '1.1.0',
        type: 'BTPS_DOC',
        from: 'alice$saas.example',
        to: 'bob$receiver.example',
        document: invoice,
        encryptionSelector: hostSelectors['bob$receiver.example'],
      },
      {
        signature: { algorithmHash: 'sha256' },
        encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
      },
    );
    expect(error).toBeUndefined();
    return payload as unknown as BTPTransporterArtifact;
  };

  it('a KMS signer signs a transporter artifact with separate selectors, and the server verifies it', async () => {
    const kms = fakeKms(key('alice$saas.example'));
    const artifact = await aliceSends(kms.signer);

    expect(kms.signClient.sign).toHaveBeenCalledTimes(1);
    expect(artifact).toMatchObject({ signatureSelector: 'btps2', encryptionSelector: 'btps1' });
    expect(serverAccepts(artifact).error).toBeUndefined();
    expect(await serverVerifies(artifact)).toMatchObject({ isValid: true });

    // A KMS signature is the same bytes a PEM signature over the same artifact is.
    const { signature, ...signed } = artifact;
    expect(await signBtpPayload(signed, key('alice$saas.example'))).toEqual(signature);
  });

  it('the receiver opens it through a KMS decrypter, a PEM decrypter, or a lookup that returns either', async () => {
    const artifact = await aliceSends(fakeKms(key('alice$saas.example')).signer);
    const senderKey = (await resolveSignatureKey(artifact))!;
    const bob = key('bob$receiver.example');
    const kms = fakeKms(bob);

    for (const receiverKeys of [
      kms.decrypter,
      new PemDecrypter({ privateKey: bob.privateKey }),
      (selector: string) => (selector === 'btps1' ? kms.decrypter : undefined),
    ]) {
      const { payload, error } = await decryptVerify(
        senderKey,
        artifact as unknown as Opened,
        receiverKeys,
      );
      expect(error).toBeUndefined();
      expect(payload?.document).toEqual(invoice);
    }
    expect(kms.decryptClient.decrypt).toHaveBeenCalledTimes(2);
  });

  it('a signer that does not hold the published key does not verify', async () => {
    const artifact = await aliceSends(fakeKms(genKeys()).signer);
    expect(await serverVerifies(artifact)).toMatchObject({ isValid: false });
  });

  it('a KMS failure is a BTPErrorException that keeps whether to retry', async () => {
    const kms = fakeKms(key('alice$saas.example'));
    vi.mocked(kms.signClient.sign).mockRejectedValueOnce(
      Object.assign(new Error('slow down'), { name: 'ThrottlingException' }),
    );
    const { payload, error } = await signEncrypt(
      undefined,
      { accountName: 'alice', domainName: 'saas.example', selector: 'btps2', signer: kms.signer },
      { version: '1.1.0', type: 'BTPS_DOC', from: 'alice$saas.example', document: invoice },
    );
    expect(payload).toBeUndefined();
    expect(error).toMatchObject({ name: 'BTPErrorException', meta: { retryable: true } });
  });

  describe('BtpsDelegator signs the delegation and the attestation through a Signer', () => {
    const agentKeys = genKeys();
    /** As BtpsAgent builds it: signed by the device key, so no signatureSelector. */
    const agentArtifact = async (from: string): Promise<BTPTransporterArtifact> => {
      const unsigned = {
        version: '1.1.0',
        id: 'agent-artifact-441',
        issuedAt: '2026-01-01T00:00:00.000Z',
        type: 'BTPS_DOC' as const,
        from,
        to: 'bob$receiver.example',
        document: invoice as unknown as BTPTransporterArtifact['document'],
        encryption: null,
      };
      return { ...unsigned, signature: await signBtpPayload(unsigned, agentKeys) };
    };
    const delegator = async (signer: KmsSigner) => {
      const d = new BtpsDelegator({ identity: 'delegator$saas.example', signer, autoInit: false });
      await d.init();
      return d;
    };

    it('init refuses a signer that does not hold the published key', async () => {
      await expect(delegator(fakeKms(genKeys()).signer)).rejects.toThrow(
        'Signature verification failed',
      );
    });

    it('a delegation signed through a KMS signer verifies at the server', async () => {
      const kms = fakeKms(key('delegator$saas.example'));
      const delegated = await (
        await delegator(kms.signer)
      ).delegateArtifact(
        'btps_ag_device-1',
        agentKeys.publicKey,
        await agentArtifact('alice$saas.example'),
      );

      expect(delegated.delegation).toMatchObject({
        signedBy: 'delegator$saas.example',
        selector: 'sk1',
      });
      expect(await serverVerifies(delegated)).toMatchObject({ isValid: true });
    });

    const onBehalfOfCarol = async (userSigner: KmsSigner) =>
      (await delegator(fakeKms(key('delegator$saas.example')).signer)).delegateArtifact(
        'btps_ag_device-1',
        agentKeys.publicKey,
        await agentArtifact('carol$custom.example'),
        { identity: 'carol$custom.example', signer: userSigner },
      );

    it("on behalf of a user, the user's Signer signs the delegation and the attestor's the attestation", async () => {
      const userKms = fakeKms(key('carol$custom.example'));
      const delegated = await onBehalfOfCarol(userKms.signer);
      expect(userKms.signClient.sign).toHaveBeenCalledTimes(1);

      // The delegation is signed before the attestation is added to it.
      const { attestation, signature, ...delegation } = delegated.delegation;
      expect(delegation).toMatchObject({ signedBy: 'carol$custom.example', selector: 'c7' });
      expect(
        verifySignature(
          { ...delegated, delegation },
          signature,
          key('carol$custom.example').publicKey,
        ).isValid,
      ).toBe(true);

      expect(attestation?.signedBy).toBe('delegator$saas.example');
      expect(
        await server['verifyAttestation'](
          delegated.delegation as typeof delegated.delegation & {
            attestation: NonNullable<typeof attestation>;
          },
        ),
      ).toMatchObject({ isValid: true });
    });

    // Pre-existing defect, not this change's, and the same with a PEM key pair:
    // the delegation is signed without its attestation, but the server
    // verifies it with the attestation in place, so an attested delegation
    // never verifies end to end. Reported on the pull request.
    it.fails(
      'an attested delegation verifies at the server end to end (expected failure: pre-existing server defect)',
      async () => {
        const delegated = await onBehalfOfCarol(fakeKms(key('carol$custom.example')).signer);
        expect(await serverVerifies(delegated)).toMatchObject({ isValid: true });
      },
    );
  });

  describe('BtpsAgent signs with its device key through a Signer', () => {
    const deviceKeys = genKeys();
    const agentWith = (agent: ConstructorParameters<typeof BtpsAgent>[0]['agent']) => {
      const a = new BtpsAgent({ agent, btpIdentity: 'carol$custom.example' });
      vi.spyOn(a, 'resolveBtpsHostDnsTxt').mockResolvedValue({
        hostname: 'btps.receiver.example',
        port: 3443,
        selector: 'btps1',
        version: '1.1.0',
      });
      return a;
    };
    const build = async (agent: BtpsAgent) =>
      agent['getAgentArtifact']({
        actionType: 'artifact.send',
        to: 'bob$receiver.example',
        document: invoice as never,
      });

    it('the agent artifact and the transporter artifact inside it both verify with the device key', async () => {
      const kms = fakeKms(deviceKeys);
      const { payload, error } = await build(
        agentWith({ id: 'btps_ag_device-1', signer: kms.signer }),
      );
      expect(error).toBeUndefined();

      const { signature, ...agentSigned } = payload as unknown as {
        signature: Parameters<typeof verifySignature>[1];
        document: BTPTransporterArtifact;
      };
      expect(verifySignature(agentSigned, signature, deviceKeys.publicKey).isValid).toBe(true);

      const { signature: inner, ...transporterSigned } = agentSigned.document;
      expect(verifySignature(transporterSigned, inner, deviceKeys.publicKey).isValid).toBe(true);
      expect(kms.signClient.sign).toHaveBeenCalledTimes(2);
    });

    it('a PEM device key still works, wrapped in a PemSigner', async () => {
      const { payload, error } = await build(
        agentWith({
          id: 'btps_ag_device-1',
          identityKey: deviceKeys.privateKey,
          identityCert: deviceKeys.publicKey,
        }),
      );
      expect(error).toBeUndefined();
      const { signature, ...agentSigned } = payload as unknown as {
        signature: Parameters<typeof verifySignature>[1];
      };
      expect(verifySignature(agentSigned, signature, deviceKeys.publicKey).isValid).toBe(true);
    });

    it('an agent with neither a signer nor a PEM pair is refused', () => {
      expect(
        () =>
          new BtpsAgent({
            agent: { id: 'btps_ag_device-1' } as never,
            btpIdentity: 'carol$custom.example',
          }),
      ).toThrow('Invalid agent or btpIdentity');
    });
  });

  it("the server's identity response is signed through its Signer and verifies", async () => {
    const sent: BTPServerResponse[] = [];
    vi.spyOn(
      server as unknown as { sendBtpsResponse: () => void },
      'sendBtpsResponse',
    ).mockImplementation((...args: unknown[]) => {
      sent.push(args[1] as BTPServerResponse);
    });
    Object.assign(server, {
      identityStore: {
        getPublicKeyRecord: async () => ({
          selector: 'btps1',
          publicKey: key('bob$receiver.example').publicKey,
          keyType: 'rsa',
          version: '1.0.0',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      },
    });

    await server['handleIdentityLookup'](
      {
        version: '1.1.0',
        id: 'lookup-441',
        issuedAt: '2026-01-01T00:00:00.000Z',
        identity: 'bob$receiver.example',
        from: 'alice$saas.example',
        hostSelector: 'btps1',
      },
      { req: {} as never, res: { socket: new EventEmitter(), reqId: 'lookup-441' } as never },
    );

    expect(sent).toHaveLength(1);
    const { signature, ...signed } = sent[0]!;
    expect(
      verifySignature(signed, signature!, key('server$receiver.example').publicKey).isValid,
    ).toBe(true);
  });

  describe('a GCM tag that is not 16 bytes is refused on every decrypt path', () => {
    const bob = key('bob$receiver.example');

    /** alice's artifact to bob, re-signed after its tag was cut to 4 bytes. */
    const shortTagged = async () => {
      const artifact = await aliceSends(fakeKms(key('alice$saas.example')).signer);
      const { signature: _s, ...rest } = artifact;
      const unsigned = { ...rest, encryption: withTag(artifact.encryption!, 4) };
      return {
        ...unsigned,
        signature: await signBtpPayload(unsigned, key('alice$saas.example')),
      } as BTPTransporterArtifact;
    };

    it('decryptBtpPayload, with a PEM, a PemDecrypter or a KmsDecrypter; KMS is never called', async () => {
      const { data, encryption } = encryptBtpPayload(invoice, bob.publicKey);
      const kms = fakeKms(bob);
      for (const receiver of [
        bob.privateKey,
        new PemDecrypter({ privateKey: bob.privateKey }),
        kms.decrypter,
      ]) {
        expect((await decryptBtpPayload(data, encryption, receiver)).data).toEqual(invoice);
        for (const bytes of [4, 12, 15]) {
          const result = await decryptBtpPayload(data, withTag(encryption, bytes), receiver);
          expect(result.data).toBeUndefined();
          expect(result.error).toMatchObject({
            code: 'BTP_ERROR_VALIDATION',
            meta: { authTagBytes: bytes },
          });
        }
      }
      expect(kms.decryptClient.decrypt).toHaveBeenCalledTimes(1);
    });

    it('decryptVerify, with a PEM, a Decrypter or a lookup', async () => {
      const artifact = await shortTagged();
      const senderKey = (await resolveSignatureKey(artifact))!;
      const kms = fakeKms(bob);
      for (const receiverKeys of [bob.privateKey, kms.decrypter, () => kms.decrypter]) {
        const { payload, error } = await decryptVerify(
          senderKey,
          artifact as unknown as Opened,
          receiverKeys,
        );
        expect(payload).toBeUndefined();
        expect(error?.code).toBe('BTP_ERROR_VALIDATION');
      }
      expect(kms.decryptClient.decrypt).not.toHaveBeenCalled();
    });

    it("the client's decryptVerifyArtifact", async () => {
      const artifact = await shortTagged();
      const client = new BtpsClient({ to: 'bob$receiver.example' });
      const { error } = await client.decryptVerifyArtifact(
        artifact as never,
        (await resolveSignatureKey(artifact))!,
        new PemDecrypter({ privateKey: bob.privateKey }),
      );
      expect(error?.code).toBe('BTP_ERROR_VALIDATION');
    });

    it("the client's resolveIdentity, when the host's answer is encrypted", async () => {
      vi.mocked(utils.getDnsIdentityParts).mockResolvedValue(undefined);
      const alice = key('alice$saas.example');
      const lookupDoc = {
        selector: 'btps1',
        publicKey: bob.publicKey,
        keyType: 'rsa',
        version: '1.0.0',
      };

      /** The host's answer, encrypted to alice with its tag cut to `bytes`, and signed by the host. */
      const resolveWithTag = async (bytes: number) => {
        const client = new BtpsClient({ to: 'alice$saas.example' });
        vi.spyOn(client, 'resolveBtpsHostDnsTxt').mockResolvedValue({
          hostname: 'btps.receiver.example',
          port: 3443,
          selector: 'btps1',
          version: '1.1.0',
        });
        const { data, encryption } = encryptBtpPayload(lookupDoc, alice.publicKey);
        /** The host's answer to the request written, which it names by id. */
        const answerTo = async (request: { id: string }) => {
          const unsigned = {
            version: '1.1.0',
            status: { ok: true, code: 200, message: 'success' },
            id: 'lookup-441',
            issuedAt: '2026-01-01T00:00:00.000Z',
            type: 'btps_response',
            reqId: request.id,
            signedBy: 'server$receiver.example',
            signatureSelector: 'btps1',
            document: data,
            encryption: withTag(encryption, bytes),
          };
          return {
            ...unsigned,
            signature: await signBtpPayload(unsigned, key('server$receiver.example')),
          };
        };
        const socket = Object.assign(new EventEmitter(), {
          write: vi.fn((line: string) => {
            void answerTo(JSON.parse(line)).then((answer) =>
              socket.emit('data', Buffer.from(JSON.stringify(answer) + '\n')),
            );
            return true;
          }),
          destroy: vi.fn(),
        });
        vi.spyOn(tls, 'connect').mockReturnValue(socket as unknown as tls.TLSSocket);

        const kms = fakeKms(alice);
        const result = await client.resolveIdentity(
          'bob$receiver.example',
          'alice$saas.example',
          kms.decrypter,
        );
        return { ...result, kmsCalls: vi.mocked(kms.decryptClient.decrypt).mock.calls.length };
      };

      // A full tag opens through the Decrypter, so the refusal below is the tag's.
      const full = await resolveWithTag(16);
      expect(full.error).toBeUndefined();
      expect(full.response).toMatchObject({ publicKey: bob.publicKey });
      expect(full.kmsCalls).toBe(1);

      const short = await resolveWithTag(4);
      expect(short.response).toBeUndefined();
      expect(short.error?.code).toBe('BTP_ERROR_VALIDATION');
      expect(short.kmsCalls).toBe(0);
    });
  });
});
