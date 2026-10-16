/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.1 item D (EBA-112, addendum item 2, threat T-24): a refresh is
 * signed by the agent's current key, and a refresh that rotates the key
 * also proves possession of the new one.
 *
 * - Without rotation, `document.publicKey` is the current key and the
 *   artifact signature is checked against the key the server holds.
 * - With rotation, `document.publicKey` is the new key. The artifact is
 *   still signed by the current key, and `document.keyProof` is the new
 *   key's signature over the JCS form of
 *   `{ agentId, identity, newPublicKey, issuedAt }`.
 *
 * This applies to self-held custody only: a device that holds its own key
 * and refreshes through `auth.refresh`. A managed identity has no device
 * key; its key lives with the platform (KMS) and rotates by publishing a
 * new selector (item H), so no agent refresh is involved.
 */

import {
  getFingerprintFromPem,
  isSigner,
  signBtpPayload,
  verifySignature,
} from '@core/crypto/index.js';
import type { BTPSigningKey } from '@core/crypto/types.js';
import { checkIssuedAtWindow } from '@core/utils/timestampWindow.js';
import {
  BTP_ERROR_KEY_ROTATION_PROOF,
  BTP_ERROR_REFRESH_NOT_CURRENT_KEY,
  BTP_ERROR_VALIDATION,
} from '@core/error/constant.js';
import { BTPErrorException } from '@core/error/index.js';
import type { BTPAgentArtifact, BTPAuthReqDoc, BTPKeyProof } from '@core/server/types.js';

/** What the new key signs to prove it is held by the device that rotates to it. */
export type BTPKeyProofPayload = {
  agentId: string;
  identity: string;
  newPublicKey: string;
  issuedAt: string;
};

/** Why a refresh was refused. */
export type BTPRefreshRefusal =
  /** The server holds no key for the agent. */
  | 'no-current-key'
  /** The artifact is not signed by the current key. */
  | 'not-current-key'
  /** The document has no readable `publicKey`. */
  | 'no-public-key'
  /** `publicKey` is not an SPKI public key PEM. */
  | 'bad-new-key'
  /** The key changes and there is no `keyProof`. */
  | 'no-proof'
  /** A `keyProof` with no new key: nothing to prove. */
  | 'proof-without-rotation'
  /** The proof names an identity other than the artifact's `to`. */
  | 'identity-mismatch'
  /** The proof's `issuedAt` is outside the window. */
  | 'proof-stale'
  /** The proof is not the new key's signature over its payload. */
  | 'bad-proof';

export type BTPRefreshCheck =
  | { ok: true; rotation: false }
  | { ok: true; rotation: true; newPublicKey: string; newFingerprint: string }
  | { ok: false; reason: BTPRefreshRefusal; error: BTPErrorException };

/** The object a key proof signs. Fields outside these four are never signed. */
export const keyProofPayload = (payload: BTPKeyProofPayload): BTPKeyProofPayload => ({
  agentId: payload.agentId,
  identity: payload.identity,
  newPublicKey: payload.newPublicKey,
  issuedAt: payload.issuedAt,
});

/**
 * Signs a key proof with the new key, for a key-rotating `auth.refresh`.
 * Returns the new public key (`document.publicKey`) and the proof
 * (`document.keyProof`).
 */
export const signKeyProof = async (input: {
  agentId: string;
  identity: string;
  newKey: BTPSigningKey;
  issuedAt?: string;
}): Promise<{ publicKey: string; keyProof: BTPKeyProof }> => {
  const { agentId, identity, newKey } = input;
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const newPublicKey = isSigner(newKey)
    ? (await newKey.getPublicKey()).publicKey
    : newKey.publicKey;
  const signature = await signBtpPayload(
    keyProofPayload({ agentId, identity, newPublicKey, issuedAt }),
    newKey,
  );
  return { publicKey: newPublicKey, keyProof: { issuedAt, signature } };
};

const refuse = (
  reason: BTPRefreshRefusal,
  meta: Record<string, unknown>,
  cause?: unknown,
): BTPRefreshCheck => {
  const constant =
    reason === 'no-current-key' || reason === 'not-current-key'
      ? BTP_ERROR_REFRESH_NOT_CURRENT_KEY
      : reason === 'no-public-key'
        ? BTP_ERROR_VALIDATION
        : BTP_ERROR_KEY_ROTATION_PROOF;
  return {
    ok: false,
    reason,
    error: new BTPErrorException(constant, { cause: cause ?? reason, meta: { reason, ...meta } }),
  };
};

const fingerprintOf = (pem: string): string | undefined => {
  try {
    return getFingerprintFromPem(pem, 'sha256');
  } catch {
    return undefined;
  }
};

/**
 * Checks an `auth.refresh` artifact against the agent's current key.
 *
 * The refresh token itself is not checked here: it is single-use, and
 * `BtpsAuthentication.validateAndReissueRefreshToken` removes it when it
 * issues the next one.
 *
 * @param input.currentPublicKey the agent's trusted key (from its trust record), or null when there is none
 * @param input.nowMs the clock the proof's `issuedAt` is checked against
 * @param input.windowMs the server's issuedAt window
 */
export const verifyAgentRefresh = (input: {
  artifact: BTPAgentArtifact;
  currentPublicKey: string | null | undefined;
  nowMs: number;
  windowMs?: number;
}): BTPRefreshCheck => {
  const { artifact, currentPublicKey, nowMs, windowMs } = input;
  const { agentId, to } = artifact;

  if (!currentPublicKey) return refuse('no-current-key', { agentId, to });

  const { signature, ...signedMsg } = artifact;
  const signed = verifySignature(signedMsg, signature, currentPublicKey);
  if (!signed.isValid) {
    return refuse('not-current-key', { agentId, to }, signed.error);
  }

  const document = artifact.document as Partial<BTPAuthReqDoc> | undefined;
  const publicKey = document?.publicKey;
  if (typeof publicKey !== 'string' || publicKey.length === 0) {
    return refuse('no-public-key', { agentId, to });
  }

  const newFingerprint = fingerprintOf(publicKey);
  if (!newFingerprint) return refuse('bad-new-key', { agentId, to });

  const currentFingerprint = fingerprintOf(currentPublicKey);
  const { keyProof } = document;
  if (newFingerprint === currentFingerprint) {
    if (keyProof) return refuse('proof-without-rotation', { agentId, to });
    return { ok: true, rotation: false };
  }

  if (!keyProof) return refuse('no-proof', { agentId, to, newFingerprint });
  if (document.identity !== to) {
    return refuse('identity-mismatch', { agentId, to, identity: document.identity });
  }

  const window = checkIssuedAtWindow(keyProof.issuedAt, nowMs, windowMs);
  if (!window.ok) {
    return refuse('proof-stale', {
      agentId,
      to,
      issuedAt: keyProof.issuedAt,
      window: window.reason,
    });
  }

  const proved = verifySignature(
    keyProofPayload({
      agentId,
      identity: to,
      newPublicKey: publicKey,
      issuedAt: keyProof.issuedAt,
    }),
    keyProof.signature,
    publicKey,
  );
  if (!proved.isValid) {
    return refuse('bad-proof', { agentId, to, newFingerprint }, proved.error);
  }

  return { ok: true, rotation: true, newPublicKey: publicKey, newFingerprint };
};
