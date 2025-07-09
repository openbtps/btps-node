/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { generateKeyPairSync } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { BTPKeyConfig, BTPKeyPair } from './types.js';
import { getFingerprintFromPem } from './index.js';

export async function generateKeys(accountName: string) {
  const dir = join('keys', accountName);
  mkdirSync(dir, { recursive: true });

  const { publicKey, privateKey } = getBTPKeyPair();

  writeFileSync(join(dir, `${accountName}-private.pem`), privateKey);
  writeFileSync(join(dir, `${accountName}-public.pem`), publicKey);

  console.log(`✅ Keys created for '${accountName}' in ${dir}`);
}

export const getBTPKeyPair = (keyConfig?: BTPKeyConfig): BTPKeyPair => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: keyConfig?.keySize ?? 2048,
    publicKeyEncoding: {
      type: keyConfig?.publicKeyEncoding ?? 'spki',
      format: keyConfig?.format ?? 'pem',
    },
    privateKeyEncoding: {
      type: keyConfig?.privateKeyEncoding ?? 'pkcs8',
      format: keyConfig?.format ?? 'pem',
    },
  });

  const fingerprint = getFingerprintFromPem(publicKey, 'sha256');

  return { publicKey, privateKey, fingerprint };
};
