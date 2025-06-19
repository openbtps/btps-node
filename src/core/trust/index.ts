import { BTPTrustRecord } from './types';
import JsonTrustStore from './storage/Class/JsonTrustStore';
export default JsonTrustStore;
export { AbstractTrustStore } from './storage/Class/Abstract/AbstractTrustStore';
export * from './types';

export const isTrustActive = (trust?: BTPTrustRecord): boolean => {
  if (!trust || trust.status !== 'accepted') return false;
  if (!trust.expiresAt) return true;
  return new Date(trust.expiresAt).getTime() > Date.now();
};
