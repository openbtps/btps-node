/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptVerify } from './decryptVerify.js';
import * as cryptoIndex from './index.js';
import { BTPErrorException } from '../error/index.js';
import { VerifyEncryptedPayload } from './types.js';
import { BTPTrustReqDoc } from '../trust/types.js';
import type { Decrypter } from './decrypter-interface.js';

vi.mock('./index', () => ({
  decryptBtpPayload: vi.fn(),
  decryptBtpPayloadWithDecrypter: vi.fn(),
  verifySignature: vi.fn(),
}));

const mockCrypto = vi.mocked(cryptoIndex);

describe('decryptVerify', () => {
  let privateKey: string;
  let senderPubPem: string;
  let encryptedPayload: VerifyEncryptedPayload<BTPTrustReqDoc>;

  beforeEach(() => {
    vi.resetAllMocks();
    senderPubPem = 'sender-public-key';
    privateKey = 'private-key';

    encryptedPayload = {
      from: 'sender$example.com',
      to: 'receiver$example.com',
      type: 'TRUST_REQ',
      issuedAt: '2023-01-01T00:00:00Z',
      document: {
        id: 'req-1',
        name: 'test',
        email: 'test@test.com',
        phone: '1234567890',
        reason: 'test',
      },
      signature: {
        algorithmHash: 'sha256',
        fingerprint: 'fingerprint',
        value: 'signature-value',
      },
      encryption: {
        algorithm: 'aes-256-gcm',
        encryptedKey: 'encrypted-key',
        iv: 'iv-value',
        type: 'standardEncrypt',
        authTag: 'auth-tag',
      },
    };
  });

  it('should successfully decrypt and verify the payload', async () => {
    // For decryption to work, document must be a string
    const encryptedStringPayload: VerifyEncryptedPayload<string> = {
      ...encryptedPayload,
      document: 'encrypted-string-data',
    };

    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: encryptedPayload.document });

    const result = await decryptVerify(senderPubPem, encryptedStringPayload, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...encryptedStringPayload,
      document: encryptedPayload.document,
    });
    expect(mockCrypto.verifySignature).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender$example.com',
        to: 'receiver$example.com',
        type: 'TRUST_REQ',
        issuedAt: '2023-01-01T00:00:00Z',
        document: 'encrypted-string-data',
        encryption: {
          algorithm: 'aes-256-gcm',
          encryptedKey: 'encrypted-key',
          iv: 'iv-value',
          type: 'standardEncrypt',
          authTag: 'auth-tag',
        },
      }),
      encryptedStringPayload.signature,
      senderPubPem,
    );
    expect(mockCrypto.decryptBtpPayload).toHaveBeenCalledWith(
      'encrypted-string-data',
      encryptedStringPayload.encryption,
      privateKey,
    );
  });

  it('should return an error if signature verification fails', async () => {
    const sigError = new BTPErrorException({ message: 'Invalid signature' });
    mockCrypto.verifySignature.mockReturnValue({ isValid: false, error: sigError });

    const result = await decryptVerify(senderPubPem, encryptedPayload, privateKey);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(sigError);
    expect(mockCrypto.decryptBtpPayload).not.toHaveBeenCalled();
  });

  it('should handle payloads that do not require decryption', async () => {
    const unencryptedPayload: VerifyEncryptedPayload<BTPTrustReqDoc> = {
      ...encryptedPayload,
      encryption: null,
    };

    mockCrypto.verifySignature.mockReturnValue({ isValid: true });

    const result = await decryptVerify(senderPubPem, unencryptedPayload, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...unencryptedPayload,
      document: unencryptedPayload.document,
    });
    expect(mockCrypto.decryptBtpPayload).not.toHaveBeenCalled();
  });

  it('should return an error if decryption fails', async () => {
    // For decryption to work, document must be a string
    const encryptedStringPayload: VerifyEncryptedPayload<string> = {
      ...encryptedPayload,
      document: 'encrypted-string-data',
    };

    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    const decryptionError = new BTPErrorException({ message: 'Decryption failed' });
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: undefined, error: decryptionError });

    const result = await decryptVerify(senderPubPem, encryptedStringPayload, privateKey);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(decryptionError);
  });

  it('should handle encrypted string documents', async () => {
    const encryptedStringPayload: VerifyEncryptedPayload<string> = {
      ...encryptedPayload,
      document: 'encrypted-string-data',
    };

    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: encryptedPayload.document });

    const result = await decryptVerify(senderPubPem, encryptedStringPayload, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...encryptedStringPayload,
      document: encryptedPayload.document,
    });
    expect(mockCrypto.decryptBtpPayload).toHaveBeenCalledWith(
      'encrypted-string-data',
      encryptedStringPayload.encryption,
      privateKey,
    );
  });

  describe('a decrypted BTPS_EVENT', () => {
    const eventId = '0b6f4b5e-5d0a-4c4e-8f43-2a7d3a1f9e01';
    const event = {
      type: 'lifecycle_event',
      id: eventId,
      occurredAt: '2025-02-03T08:15:00Z',
      document: { from: 'receiver$example.com', id: 'INV-001', sha256: 'd'.repeat(64) },
      eventType: 'paid',
    };
    const carried = (): VerifyEncryptedPayload<string> => ({
      ...encryptedPayload,
      id: eventId,
      type: 'BTPS_EVENT',
      relatesTo: 'doc-1',
      document: 'encrypted-event',
    });
    const opened = async (decrypted: unknown, payload = carried()) => {
      mockCrypto.verifySignature.mockReturnValue({ isValid: true });
      mockCrypto.decryptBtpPayload.mockReturnValue({ data: decrypted });
      return decryptVerify(senderPubPem, payload, privateKey);
    };

    it('is returned when it is a valid event matching its envelope', async () => {
      const result = await opened(event);
      expect(result.error).toBeUndefined();
      expect(result.payload?.document).toEqual(event);
    });

    it('is refused when it is not a lifecycle event', async () => {
      const result = await opened({ decrypted: 'data' });
      expect(result.payload).toBeUndefined();
      expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
    });

    it('is refused when its id is not the id of the artifact carrying it', async () => {
      const result = await opened({ ...event, id: '1c7e5c6f-6e1b-4d5f-9a54-3b8e4b2a0f12' });
      expect(result.payload).toBeUndefined();
      expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
    });

    it('is refused when it is about an invoice outside its two parties', async () => {
      const result = await opened({
        ...event,
        document: { ...event.document, from: 'someone$else.com' },
      });
      expect(result.payload).toBeUndefined();
      expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
    });

    it('is refused when its message is over the limit', async () => {
      const result = await opened({ ...event, message: 'a'.repeat(5001) });
      expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
    });
  });

  describe('a decrypted document of another type', () => {
    const request = {
      id: 'req-1',
      name: 'Acme',
      email: 'billing@acme.com',
      reason: 'invoices',
      phone: '+61 400 000 000',
    };
    const opened = async (decrypted: unknown, type = 'TRUST_REQ') => {
      mockCrypto.verifySignature.mockReturnValue({ isValid: true });
      mockCrypto.decryptBtpPayload.mockReturnValue({ data: decrypted });
      return decryptVerify(
        senderPubPem,
        { ...encryptedPayload, type, document: 'encrypted' } as VerifyEncryptedPayload<string>,
        privateKey,
      );
    };

    it('is returned when it matches its type', async () => {
      const result = await opened(request);
      expect(result.error).toBeUndefined();
      expect(result.payload?.document).toEqual(request);
    });

    it('is refused when a field is over its limit, as it would be unencrypted', async () => {
      const result = await opened({ ...request, reason: 'a'.repeat(2001) });
      expect(result.payload).toBeUndefined();
      expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
    });

    it('is refused when it is not its type', async () => {
      const result = await opened({ decrypted: 'data' }, 'BTPS_DOC');
      expect(result.error?.code).toBe('BTP_ERROR_VALIDATION');
    });
  });

  it('should handle payloads with delegation', async () => {
    const payloadWithDelegation: VerifyEncryptedPayload<BTPTrustReqDoc> = {
      ...encryptedPayload,
      delegation: {
        agentId: 'agent123',
        agentPubKey: 'agent-public-key',
        signedBy: 'delegator$example.com',
        signature: {
          algorithmHash: 'sha256',
          value: 'delegation-sig',
          fingerprint: 'delegation-fp',
        },
        issuedAt: '2023-01-01T00:00:00Z',
        selector: 'btps1',
      },
    };

    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: encryptedPayload.document });

    const result = await decryptVerify(senderPubPem, payloadWithDelegation, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...payloadWithDelegation,
      document: encryptedPayload.document,
    });
  });

  it('should not decrypt when private key is not provided', async () => {
    mockCrypto.verifySignature.mockReturnValue({ isValid: true });

    const result = await decryptVerify(senderPubPem, encryptedPayload);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...encryptedPayload,
      document: encryptedPayload.document,
    });
    expect(mockCrypto.decryptBtpPayload).not.toHaveBeenCalled();
  });

  it('should not decrypt when encryption is empty', async () => {
    const emptyEncryptionPayload: VerifyEncryptedPayload<BTPTrustReqDoc> = {
      ...encryptedPayload,
      encryption: null, // No encryption
    };

    mockCrypto.verifySignature.mockReturnValue({ isValid: true });

    const result = await decryptVerify(senderPubPem, emptyEncryptionPayload, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...emptyEncryptionPayload,
      document: emptyEncryptionPayload.document,
    });
    expect(mockCrypto.decryptBtpPayload).not.toHaveBeenCalled();
  });

  it('decrypts through a Decrypter, even one whose methods are all on its prototype', async () => {
    class RemoteDecrypter implements Decrypter {
      get algorithm(): 'aes-256-gcm' {
        return 'aes-256-gcm';
      }
      async decrypt(): Promise<Uint8Array> {
        return new Uint8Array();
      }
    }
    // No own properties at all, which lodash's isEmpty would call empty.
    const decrypter = new RemoteDecrypter();
    const encryptedStringPayload: VerifyEncryptedPayload<string> = {
      ...encryptedPayload,
      document: 'encrypted-string-data',
    };
    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    mockCrypto.decryptBtpPayloadWithDecrypter.mockResolvedValue({
      data: encryptedPayload.document,
    });

    const result = await decryptVerify(senderPubPem, encryptedStringPayload, decrypter);

    expect(result.error).toBeUndefined();
    expect(result.payload?.document).toEqual(encryptedPayload.document);
    expect(mockCrypto.decryptBtpPayloadWithDecrypter).toHaveBeenCalledWith(
      'encrypted-string-data',
      encryptedStringPayload.encryption,
      decrypter,
    );
    expect(mockCrypto.decryptBtpPayload).not.toHaveBeenCalled();
  });
});
