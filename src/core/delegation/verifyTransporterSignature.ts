/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Who signed a transporter artifact, checked the one way a server checks it on
 * arrival and a device checks it when it opens a result: the sender's own key
 * from DNS, or, for a delegated artifact, the delegation (and its attestation)
 * against the signers' DNS keys and then the artifact against the delegated
 * agent's key.
 */

import { BTPErrorException } from '@core/error/index.js';
import {
  BTP_ERROR_ATTESTATION_VERIFICATION,
  BTP_ERROR_DELEGATION_INVALID,
  BTP_ERROR_DELEGATION_SIG_VERIFICATION,
  BTP_ERROR_RESOLVE_PUBKEY,
} from '@core/error/constant.js';
import { createHash } from 'crypto';
import type { BTPError } from '@core/error/types.js';
import { getFingerprintFromPem, verifySignature } from '@core/crypto/index.js';
import { canonicalizeValue } from '@core/crypto/jcs.js';
import {
  getDnsIdentityParts,
  getHostAndSelector,
  isDelegationAllowed,
  resolvePublicKey,
} from '@core/utils/index.js';
import type { BTPAttestation, BTPDelegation, BTPTransporterArtifact } from '@core/server/types.js';
import type { BtpsKeyResolver } from '@core/crypto/keyResolver.js';
import {
  checkKeyChain,
  keyAt,
  keyChainFactsOf,
  keyChainProblemOf,
  keyChainSignerProblem,
  type BTPCheckedKeyChain,
} from '@core/trust/keyRotation.js';
import type {
  BTPKeyChainDns,
  BTPKeyChainFacts,
  BTPKeyChainLookup,
  BTPKeyChainRecord,
} from '@core/trust/types.js';

type Verified = { isValid: boolean; error?: BTPErrorException };

/** A signature key: from the resolver when one is given, else from DNS, as without one. */
export const signatureKey = (identity: string, selector: string, keyResolver?: BtpsKeyResolver) =>
  keyResolver
    ? keyResolver.resolvePublicKey(identity, selector, 'verify')
    : resolvePublicKey(identity, selector);

/**
 * Since 1.2: how a verifier checks a signing key against its identity's key
 * chain, when it does: where it gets a chain, how long a key rotated away as
 * planned is still taken, and how far ahead of its clock a record may be dated.
 */
export type BTPKeyChainCheck = {
  resolveKeyChain: (identity: string) => Promise<BTPKeyChainLookup>;
  retiredKeyGraceSeconds: number;
  maxSkewSeconds?: number;
  /**
   * Chains already checked, by identity, each kept for `checkedForSeconds`
   * while its records are the same, so a chain's signatures are checked once
   * per window, not on every arrival.
   */
  checked?: Map<string, { hash: string; chain: BTPCheckedKeyChain; until: number }>;
  checkedForSeconds?: number;
};

// Past this many identities, entries whose time has passed are let go.
const CHECKED_SWEEP_AT = 10_000;

/** A chain checked once per window, while its records are the same. */
const checkedChainOf = (
  identity: string,
  records: BTPKeyChainRecord[],
  keyChains: BTPKeyChainCheck,
): BTPCheckedKeyChain => {
  const { checked, checkedForSeconds = 0 } = keyChains;
  if (!checked || checkedForSeconds <= 0) return checkKeyChain(records, identity);
  const key = identity.toLowerCase();
  const hash = createHash('sha256').update(canonicalizeValue(records), 'utf8').digest('hex');
  const now = Date.now();
  const kept = checked.get(key);
  if (kept && kept.hash === hash && kept.until > now) return kept.chain;
  const chain = checkKeyChain(records, identity);
  if (checked.size >= CHECKED_SWEEP_AT) {
    for (const [name, entry] of checked) if (entry.until <= now) checked.delete(name);
  }
  checked.set(key, { hash, chain, until: now + checkedForSeconds * 1000 });
  return chain;
};

const refused = (error: BTPError, cause: string) => ({
  error: new BTPErrorException(error, { cause }),
});

/**
 * Since 1.2: `identity`'s key chain as a verifier online takes it: asked of its
 * host, checked once, and anchored on what DNS publishes for it.
 *
 * - `none`: no chain to be had (a 1.1 host, an unreachable one) or an empty
 *   one: its keys are DNS's, as in 1.1;
 * - `refused`: an answer that fails its checks, a DNS lookup that fails (never
 *   taken for host-only), or a chain `keyChainProblem` refuses;
 * - `checked`: the chain's facts, anchored online.
 *
 * The chain must end at a key DNS publishes for the identity, at its last
 * selector or the domain's `s=`; only when DNS has neither is it host-only.
 */
export const onlineKeyChain = async (
  identity: string,
  keyChains: BTPKeyChainCheck,
): Promise<
  | { status: 'none' }
  | { status: 'refused'; error: BTPErrorException }
  | { status: 'checked'; facts: BTPKeyChainFacts }
> => {
  const lookup = await keyChains.resolveKeyChain(identity);
  if (lookup.status === 'invalid') {
    return {
      status: 'refused',
      ...refused(BTP_ERROR_RESOLVE_PUBKEY, `${identity}'s key chain is refused: ${lookup.reason}`),
    };
  }
  if (lookup.status === 'unavailable' || lookup.records.length === 0) return { status: 'none' };
  // Checked once: every signature and rule. The facts for each anchor follow from it.
  const chain = checkedChainOf(identity, lookup.records, keyChains);
  let dns: BTPKeyChainDns;
  try {
    const fingerprintAt = async (at: string | undefined) => {
      const pem = at === undefined ? undefined : await getDnsIdentityParts(identity, at, 'pem');
      return typeof pem === 'string' ? getFingerprintFromPem(pem) : undefined;
    };
    const last = keyChainFactsOf(chain, {}).keys.at(-1)?.selector;
    const domain = (await getHostAndSelector(identity))?.selector;
    const fingerprints = [await fingerprintAt(last), await fingerprintAt(domain)].filter(
      (fingerprint): fingerprint is string => fingerprint !== undefined,
    );
    dns = fingerprints.length ? { kind: 'published', fingerprints } : { kind: 'hostOnly' };
  } catch (error) {
    return {
      status: 'refused',
      ...refused(
        BTP_ERROR_RESOLVE_PUBKEY,
        `could not read ${identity}'s keys in DNS: ${error instanceof Error ? error.message : error}`,
      ),
    };
  }
  const problem = keyChainProblemOf(chain, {
    fromOperator: true,
    dns,
    maxSkewSeconds: keyChains.maxSkewSeconds,
  });
  if (problem) {
    return {
      status: 'refused',
      ...refused(BTP_ERROR_RESOLVE_PUBKEY, `${identity}'s key chain is refused: ${problem}`),
    };
  }
  return {
    status: 'checked',
    facts: keyChainFactsOf(chain, { online: { fromOperator: true, dns } }),
  };
};

/**
 * Since 1.2: the key `identity` signs with at `selector`, checked against its
 * key chain when `keyChains` is given. With no chain to be had (a 1.1 host, an
 * unreachable one) or an empty one, it is the DNS key, as in 1.1. Otherwise:
 *
 * - the chain must come checked from the host, and end at a key DNS
 *   publishes for the identity, at the chain's last selector or the domain's
 *   `s=`. Only when DNS has neither is the identity host-only. A DNS lookup
 *   that fails refuses: it is never taken for host-only;
 * - the key is the chain's key at `selector`, or the chain's key DNS
 *   publishes there (the same key under a later selector);
 * - an expired key is `BTP_ERROR_KEY_REVOKED`, and a key rotated away as
 *   planned past the grace `BTP_ERROR_KEY_RETIRED`.
 *
 * No key and no error: none found, refused by the caller as before.
 */
export const checkedSignatureKey = async (
  identity: string,
  selector: string,
  keyResolver?: BtpsKeyResolver,
  keyChains?: BTPKeyChainCheck,
): Promise<{ key?: string; error?: BTPErrorException }> => {
  if (!keyChains) return { key: await signatureKey(identity, selector, keyResolver) };
  const online = await onlineKeyChain(identity, keyChains);
  if (online.status === 'refused') return { error: online.error };
  if (online.status === 'none') return { key: await signatureKey(identity, selector, keyResolver) };
  const { facts } = online;
  let key = keyAt(facts, { selector });
  if (!key) {
    const published = await signatureKey(identity, selector, keyResolver);
    key = published ? keyAt(facts, { fingerprint: getFingerprintFromPem(published) }) : undefined;
    if (!key) {
      return refused(
        BTP_ERROR_RESOLVE_PUBKEY,
        `${selector} names no key of ${identity}'s key chain`,
      );
    }
  }
  const refusal = keyChainSignerProblem(key, {
    retiredKeyGraceSeconds: keyChains.retiredKeyGraceSeconds,
  });
  if (refusal) return refused(refusal, `${identity}'s key at ${selector}`);
  return { key: key.publicKey };
};

/** A delegation's attestation, signed by the attestor over the delegation. */
export const verifyAttestation = async (
  delegation: Omit<BTPDelegation, 'attestation'> & { attestation: BTPAttestation },
  keyResolver?: BtpsKeyResolver,
  keyChains?: BTPKeyChainCheck,
): Promise<Verified> => {
  const { attestation, ...restDelegation } = delegation;
  const { signature, ...restAttestation } = attestation;

  const { key: attestorPubKey, error: keyError } = await checkedSignatureKey(
    attestation.signedBy,
    attestation.selector,
    keyResolver,
    keyChains,
  );
  if (keyError) return { isValid: false, error: keyError };
  if (!attestorPubKey) {
    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
        cause: `Attestor ${attestation.signedBy} public key not found`,
        meta: { attestation },
      }),
    };
  }
  const signedMsg = { ...restDelegation, attestation: restAttestation };
  const { isValid, error } = verifySignature(signedMsg, signature, attestorPubKey);
  return {
    isValid,
    error: error
      ? new BTPErrorException(BTP_ERROR_ATTESTATION_VERIFICATION, {
          cause: `Attestation signature verification failed of attestor ${attestation.signedBy}`,
          meta: { attestation },
        })
      : undefined,
  };
};

/**
 * A delegated artifact: the delegation is allowed (by the sender itself, or its
 * domain's operator), attested by the operator when the sender delegates for
 * itself, signed by its delegator, and the artifact is signed by the agent.
 */
export const verifyDelegation = async (
  artifactWithDelegation: Omit<BTPTransporterArtifact, 'delegation'> & {
    delegation: BTPDelegation;
  },
  keyResolver?: BtpsKeyResolver,
  keyChains?: BTPKeyChainCheck,
): Promise<Verified> => {
  // Only the sender itself or its domain's operator may delegate, and only
  // the operator may attest: the receiver learns who that is from DNS.
  const operator = (await getHostAndSelector(artifactWithDelegation.from))?.operator;

  /* If the artifact is not allowed to be delegated, return an error */
  if (!isDelegationAllowed(artifactWithDelegation, operator)) {
    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_DELEGATION_INVALID, {
        cause: operator
          ? `Delegation is not allowed: ${artifactWithDelegation.delegation.signedBy} is not the operator of ${artifactWithDelegation.from}'s domain`
          : `Delegation is not allowed: ${artifactWithDelegation.from}'s domain declares no operator`,
      }),
    };
  }
  const { delegation, ...restArtifact } = artifactWithDelegation;
  const isAttestationRequired = delegation.signedBy === artifactWithDelegation.from;

  /* If attestation is required, but not provided, return an error */
  if (isAttestationRequired && !delegation.attestation) {
    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_DELEGATION_INVALID, {
        cause:
          'Custom managed domain delegation requires attestation. Either provide attestation or directly send without delegation via transporter',
        meta: {
          delegation,
          from: artifactWithDelegation.from,
        },
      }),
    };
  }

  /* If attestation is provided, verify it */
  if (delegation.attestation) {
    if (delegation.attestation.signedBy !== operator) {
      return {
        isValid: false,
        error: new BTPErrorException(BTP_ERROR_ATTESTATION_VERIFICATION, {
          cause: `${delegation.attestation.signedBy} is not the operator of ${artifactWithDelegation.from}'s domain`,
        }),
      };
    }
    const { isValid, error } = await verifyAttestation(
      delegation as Omit<BTPDelegation, 'attestation'> & { attestation: BTPAttestation },
      keyResolver,
      keyChains,
    );
    if (!isValid) return { isValid, error };
  }

  /* Verify the delegation signature against the delegated artifact which includes the original artifact and signed artifact*/
  const { key: delegatorPubKey, error: keyError } = await checkedSignatureKey(
    delegation.signedBy,
    delegation.selector,
    keyResolver,
    keyChains,
  );
  if (keyError) return { isValid: false, error: keyError };
  if (!delegatorPubKey) {
    return {
      isValid: false,
      error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY, {
        cause: `Delegator ${delegation.signedBy} public key not found`,
        meta: { delegation },
      }),
    };
  }

  // The delegation is signed before it is attested: the attestation, added
  // after and signed over the delegation, is not part of what it signed.
  const { signature, attestation, ...restDelegation } = delegation;
  const signedMsg = { ...artifactWithDelegation, delegation: restDelegation };

  /* Verify the delegation signature against the delegated artifact which includes the original artifact and signed artifact*/
  const { isValid: isValidDelegation } = verifySignature(signedMsg, signature, delegatorPubKey);
  if (!isValidDelegation) {
    return {
      isValid: isValidDelegation,
      error: new BTPErrorException(BTP_ERROR_DELEGATION_SIG_VERIFICATION, {
        cause: `Delegation signature verification failed of delegator ${delegation.signedBy}`,
        meta: {
          delegation,
        },
      }),
    };
  }

  /* Finally verify the original artifact signature using the delegation agent public key */
  const { signature: origSignature, ...origSignedMsg } = restArtifact;
  const { isValid, error } = verifySignature(origSignedMsg, origSignature, delegation.agentPubKey);
  return {
    isValid,
    error: error
      ? new BTPErrorException(BTP_ERROR_DELEGATION_SIG_VERIFICATION, {
          cause: `Delegated artifact's original artifact signature verification failed of agent ${delegation.agentId}`,
          meta: {
            delegation,
          },
        })
      : undefined,
  };
};

/**
 * Since 1.2, exported: a transporter artifact's signature, checked as a server
 * checks it on arrival. Signed by its sender's own key from DNS, or, when it is
 * delegated, through `verifyDelegation`. On success it also gives the key that
 * signed the artifact itself, the one to verify it against when decrypting.
 * Since 1.2, every key is found through `keyResolver` when one is given, and,
 * with `keyChains`, checked against its identity's key chain.
 */
export const verifyTransporterSignature = async (
  artifact: BTPTransporterArtifact,
  keyResolver?: BtpsKeyResolver,
  keyChains?: BTPKeyChainCheck,
): Promise<Verified & { signerKey?: string }> => {
  if (artifact.delegation) {
    const delegated = await verifyDelegation(
      artifact as Omit<BTPTransporterArtifact, 'delegation'> & { delegation: BTPDelegation },
      keyResolver,
      keyChains,
    );
    return delegated.isValid
      ? { ...delegated, signerKey: artifact.delegation.agentPubKey }
      : delegated;
  }

  const { signature, ...signedMsg } = artifact;
  const { key: publicKey, error: keyError } = await checkedSignatureKey(
    artifact.from,
    artifact.selector,
    keyResolver,
    keyChains,
  );
  if (keyError) return { isValid: false, error: keyError };

  if (!publicKey) {
    return { isValid: false, error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY) };
  }

  const verified = verifySignature(signedMsg, signature, publicKey);
  return verified.isValid ? { ...verified, signerKey: publicKey } : verified;
};
