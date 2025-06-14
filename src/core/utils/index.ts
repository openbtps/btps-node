import dns from 'dns/promises';
import { ParsedIdentity } from './types';

export const parseIdentity = (identity: string): ParsedIdentity | null => {
  const [accountName, domainName] = identity.split('$');
  if (!accountName || !domainName) {
    return null;
  }

  return {
    accountName,
    domainName,
  };
};

export const isValidIdentity = (identity: string = '') => {
  const parsedIdentity = parseIdentity(identity);
  return !!parsedIdentity;
};

export function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\r?\n/g, '')
    .trim();
}

export function base64ToPem(base64: string): string {
  const lines = base64.match(/.{1,64}/g) || [];
  return ['-----BEGIN PUBLIC KEY-----', ...lines, '-----END PUBLIC KEY-----'].join('\n');
}

export const resolvePublicKey = async (identity: string): Promise<string | undefined> => {
  const selector = 'btp1';
  const nameSpace = '_btp';
  const parsedIdentity = parseIdentity(identity);
  if (!parsedIdentity) {
    return undefined;
  }

  const { accountName, domainName } = parsedIdentity;

  const dnsName = `${selector}.${nameSpace}.${accountName}.${domainName}`;

  try {
    const txtRecords = await dns.resolveTxt(dnsName);
    if (!txtRecords.length) {
      return undefined;
    }

    const flat = txtRecords.map((r) => r.join('')).join('');

    const parts = Object.fromEntries(
      flat
        .split(';')
        .map((s) =>
          s
            .trim()
            .split('=')
            .map((p) => p.trim()),
        )
        .filter((pair) => pair.length === 2),
    );

    return base64ToPem(parts['p']);
  } catch (error: unknown) {
    throw new Error(`DNS resolution failed for ${domainName}: ${JSON.stringify(error)}`);
  }
};
