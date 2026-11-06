/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import type { BTPAuthResDoc } from '@core/server/types.js';
import { computeAgentTrustId } from '@core/trust/trustUtils.js';
import type { BTPSealedSuccessor } from './types.js';

const INFO = 'btps refresh successor v1';

// The key is the old token's own: only whoever holds the old token can open its answer.
const keyFrom = (oldToken: string) => Buffer.from(hkdfSync('sha256', oldToken, '', INFO, 32));

// Bound to the device and its user, and to when it was rotated, so it cannot be moved or extended.
const boundTo = (agentId: string, userIdentity: string, at: string) =>
  Buffer.from(JSON.stringify([INFO, computeAgentTrustId(agentId, userIdentity), at]), 'utf8');

/** Seal the answer a refresh token was rotated with, under that token. */
export function sealSuccessor(
  oldToken: string,
  userIdentity: string,
  answer: BTPAuthResDoc,
  at: string,
): BTPSealedSuccessor {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(oldToken), iv);
  cipher.setAAD(boundTo(answer.agentId, userIdentity, at));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(answer), 'utf8'), cipher.final()]);
  return {
    at,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Open a sealed answer with the old token, or undefined when it is not this device's or was changed. */
export function openSuccessor(
  oldToken: string,
  agentId: string,
  userIdentity: string,
  sealed: BTPSealedSuccessor,
): BTPAuthResDoc | undefined {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFrom(oldToken),
      Buffer.from(sealed.iv, 'base64'),
    );
    decipher.setAAD(boundTo(agentId, userIdentity, sealed.at));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString('utf8')) as BTPAuthResDoc;
  } catch {
    return undefined;
  }
}
