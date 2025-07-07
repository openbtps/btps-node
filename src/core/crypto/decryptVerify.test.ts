/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptVerify } from './decryptVerify';
import * as cryptoIndex from './index';
import { BTPErrorException } from '../error/index.js';
import { VerifyEncryptedPayload } from './types';
import { BTPTrustReqDoc } from '../trust/types.js';

vi.mock('./index', () => ({
  decryptBtpPayload: vi.fn(),
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
        name: 'test',
        email: 'test@test.com',
        phone: '1234567890',
        reason: 'test',
      },
      signature: {
        algorithm: 'sha256',
        fingerprint: 'fingerprint',
        value: 'signature-value',
      },
      encryption: {
        algorithm: 'aes-256-cbc',
        encryptedKey: 'encrypted-key',
        iv: 'iv-value',
        type: 'standardEncrypt',
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
    mockCrypto.decryptBtpPayload.mockReturnValue({
      data: { name: 'test', email: 'test@test.com', phone: '1234567890', reason: 'test' },
    });

    const result = await decryptVerify(senderPubPem, encryptedStringPayload, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...encryptedStringPayload,
      document: { name: 'test', email: 'test@test.com', phone: '1234567890', reason: 'test' },
    });
    expect(mockCrypto.verifySignature).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'sender$example.com',
        to: 'receiver$example.com',
        type: 'TRUST_REQ',
        issuedAt: '2023-01-01T00:00:00Z',
        document: 'encrypted-string-data',
        encryption: {
          algorithm: 'aes-256-cbc',
          encryptedKey: 'encrypted-key',
          iv: 'iv-value',
          type: 'standardEncrypt',
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
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: { decrypted: 'data' } });

    const result = await decryptVerify(senderPubPem, encryptedStringPayload, privateKey);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({
      ...encryptedStringPayload,
      document: { decrypted: 'data' },
    });
    expect(mockCrypto.decryptBtpPayload).toHaveBeenCalledWith(
      'encrypted-string-data',
      encryptedStringPayload.encryption,
      privateKey,
    );
  });

  it('should handle payloads with delegation', async () => {
    const payloadWithDelegation: VerifyEncryptedPayload<BTPTrustReqDoc> = {
      ...encryptedPayload,
      delegation: {
        agentId: 'agent123',
        agentPubKey: 'agent-public-key',
        signedBy: 'delegator$example.com',
        signature: {
          algorithm: 'sha256',
          value: 'delegation-sig',
          fingerprint: 'delegation-fp',
        },
        issuedAt: '2023-01-01T00:00:00Z',
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
});
