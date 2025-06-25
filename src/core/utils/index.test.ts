import { describe, it, expect, vi, beforeEach } from 'vitest';
import dns from 'dns/promises';
import {
  parseIdentity,
  isValidIdentity,
  pemToBase64,
  base64ToPem,
  getDnsParts,
  getBtpAddressParts,
  resolvePublicKey,
} from './index';

vi.mock('dns/promises', () => ({
  default: {
    resolveTxt: vi.fn(),
  },
}));

const mockDns = vi.mocked(dns);

describe('utils/index', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseIdentity', () => {
    it('should parse a valid identity', () => {
      expect(parseIdentity('test$example.com')).toEqual({
        accountName: 'test',
        domainName: 'example.com',
      });
    });

    it('should return null for an invalid identity', () => {
      expect(parseIdentity('test.example.com')).toBeNull();
    });
  });

  describe('isValidIdentity', () => {
    it('should return true for a valid identity', () => {
      expect(isValidIdentity('test$example.com')).toBe(true);
    });

    it('should return false for an invalid identity', () => {
      expect(isValidIdentity('test.example.com')).toBe(false);
    });
  });

  describe('pem and base64 conversion', () => {
    const pem = `-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE.../-----END PUBLIC KEY-----`;
    const base64 = `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE.../`;

    it('should convert PEM to base64', () => {
      expect(pemToBase64(pem)).toBe(base64);
    });

    it('should convert base64 to PEM', () => {
      const expectedPem = `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
      expect(base64ToPem(base64)).toBe(expectedPem);
    });
  });

  describe('getDnsParts', () => {
    it('should resolve all DNS parts correctly', async () => {
      const txtRecord = `k=key;v=1;p=cGVt;u=btps://btp.example.com`;
      mockDns.resolveTxt.mockResolvedValue([[txtRecord]]);

      const parts = await getDnsParts('test$example.com');
      expect(parts).toEqual({
        key: 'key',
        version: '1',
        pem: base64ToPem('cGVt'),
        btpAddress: 'btps://btp.example.com',
      });
    });

    it('should resolve a specific DNS part', async () => {
      const txtRecord = `u=btps://btp.example.com`;
      mockDns.resolveTxt.mockResolvedValue([[txtRecord]]);

      const btpAddress = await getDnsParts('test$example.com', 'btpAddress');
      expect(btpAddress).toBe('btps://btp.example.com');
    });

    it('should return undefined for an invalid identity', async () => {
      const parts = await getDnsParts('test.example.com');
      expect(parts).toBeUndefined();
    });

    it('should throw an error on DNS resolution failure', async () => {
      mockDns.resolveTxt.mockRejectedValue(new Error('DNS error'));
      await expect(getDnsParts('test$example.com')).rejects.toThrow('DNS resolution failed');
    });
  });

  describe('getBtpAddressParts', () => {
    it('should parse a valid BTP address', () => {
      const url = getBtpAddressParts('btps://user:pass@host.com:8080/path?query=1');
      expect(url).toBeInstanceOf(URL);
      expect(url?.hostname).toBe('host.com');
    });

    it('should normalize a BTP address without a scheme', () => {
      const url = getBtpAddressParts('host.com');
      expect(url?.protocol).toBe('btps:');
    });

    it('should return null for an invalid BTP address', () => {
      expect(getBtpAddressParts('not a url')).toBeNull();
    });
  });

  describe('resolvePublicKey', () => {
    it('should resolve the public key PEM', async () => {
      const txtRecord = `p=cGVt`;
      mockDns.resolveTxt.mockResolvedValue([[txtRecord]]);
      const pem = await resolvePublicKey('test$example.com');
      expect(pem).toBe('-----BEGIN PUBLIC KEY-----\ncGVt\n-----END PUBLIC KEY-----'); // getDnsParts returns the raw value here
    });
  });
});
