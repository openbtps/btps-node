import { generateKeyPairSync } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export async function generateKeys(accountName: string) {
  const dir = join('keys', accountName);
  mkdirSync(dir, { recursive: true });

  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  writeFileSync(join(dir, `${accountName}-private.pem`), privateKey);
  writeFileSync(join(dir, `${accountName}-public.pem`), publicKey);

  console.log(`✅ Keys created for '${accountName}' in ${dir}`);
}
