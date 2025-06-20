import { BTPTrustRecord } from './types.js';
export { default as JsonTrustStore } from './storage/JsonTrustStore.js';
export { AbstractTrustStore } from './storage/AbstractTrustStore.js';
export * from './types.js';

export const isTrustActive = (trust?: BTPTrustRecord): boolean => {
  if (!trust || trust.status !== 'accepted') return false;
  if (!trust.expiresAt) return true;
  return new Date(trust.expiresAt).getTime() > Date.now();
};
