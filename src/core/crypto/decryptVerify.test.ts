import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptVerify } from './decryptVerify';
import * as cryptoIndex from './index';
import * as utils from '../utils/index.js';
import { BTPErrorException } from '../error/index.js';
import { BTP_ERROR_IDENTITY, BTP_ERROR_RESOLVE_PUBKEY } from '../error/constant.js';
import { BTPCryptoArtifact, PemKeys } from './types';
import { BTPTrustReqDoc } from '../trust/types.js';

vi.mock('./index', () => ({
  decryptBtpPayload: vi.fn(),
  verifySignature: vi.fn(),
}));

vi.mock('../utils/index.js', () => ({
  parseIdentity: vi.fn(),
  resolvePublicKey: vi.fn(),
}));

const mockCrypto = vi.mocked(cryptoIndex);
const mockUtils = vi.mocked(utils);

describe('decryptVerify', () => {
  let pemFiles: PemKeys;
  let encryptedPayload: BTPCryptoArtifact<BTPTrustReqDoc>;

  beforeEach(() => {
    vi.resetAllMocks();

    pemFiles = {
      privateKey: 'private-key',
      publicKey: 'public-key',
    };

    encryptedPayload = {
      from: 'sender$example.com',
      to: 'receiver$example.com',
      type: 'btp_trust_request',
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
    mockUtils.parseIdentity.mockReturnValue({ accountName: 'sender', domainName: 'example.com' });
    mockUtils.resolvePublicKey.mockResolvedValue('sender-public-key');
    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: encryptedPayload.document });

    const result = await decryptVerify(pemFiles, encryptedPayload);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual(encryptedPayload);
    expect(mockUtils.parseIdentity).toHaveBeenCalledWith('sender$example.com');
    expect(mockUtils.resolvePublicKey).toHaveBeenCalledWith('sender$example.com');
    expect(mockCrypto.verifySignature).toHaveBeenCalled();
    expect(mockCrypto.decryptBtpPayload).toHaveBeenCalled();
  });

  it('should return an error if sender identity is invalid', async () => {
    mockUtils.parseIdentity.mockReturnValue(null);

    const result = await decryptVerify(pemFiles, encryptedPayload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBeInstanceOf(BTPErrorException);
    expect(result.error?.message).toBe(BTP_ERROR_IDENTITY.message);
  });

  it('should return an error if sender public key cannot be resolved', async () => {
    mockUtils.parseIdentity.mockReturnValue({ accountName: 'sender', domainName: 'example.com' });
    mockUtils.resolvePublicKey.mockResolvedValue(undefined);

    const result = await decryptVerify(pemFiles, encryptedPayload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBeInstanceOf(BTPErrorException);
    expect(result.error?.message).toBe(BTP_ERROR_RESOLVE_PUBKEY.message);
  });

  it('should return an error if signature verification fails', async () => {
    mockUtils.parseIdentity.mockReturnValue({ accountName: 'sender', domainName: 'example.com' });
    mockUtils.resolvePublicKey.mockResolvedValue('sender-public-key');
    const sigError = new BTPErrorException({ message: 'Invalid signature' });
    mockCrypto.verifySignature.mockReturnValue({ isValid: false, error: sigError });

    const result = await decryptVerify(pemFiles, encryptedPayload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(sigError);
  });

  it('should handle payloads that do not require decryption', async () => {
    const unencryptedPayload: BTPCryptoArtifact<BTPTrustReqDoc> = {
      ...encryptedPayload,
      encryption: null,
    };

    mockUtils.parseIdentity.mockReturnValue({ accountName: 'sender', domainName: 'example.com' });
    mockUtils.resolvePublicKey.mockResolvedValue('sender-public-key');
    mockCrypto.verifySignature.mockReturnValue({ isValid: true });

    const result = await decryptVerify(pemFiles, unencryptedPayload);

    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual(unencryptedPayload);
    expect(mockCrypto.decryptBtpPayload).not.toHaveBeenCalled();
  });

  it('should return an error if decryption fails', async () => {
    mockUtils.parseIdentity.mockReturnValue({ accountName: 'sender', domainName: 'example.com' });
    mockUtils.resolvePublicKey.mockResolvedValue('sender-public-key');
    mockCrypto.verifySignature.mockReturnValue({ isValid: true });
    const decryptionError = new BTPErrorException({ message: 'Decryption failed' });
    mockCrypto.decryptBtpPayload.mockReturnValue({ data: undefined, error: decryptionError });

    const result = await decryptVerify(pemFiles, encryptedPayload);

    expect(result.payload).toBeUndefined();
    expect(result.error).toBe(decryptionError);
  });
});
