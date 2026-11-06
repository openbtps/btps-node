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
import { verifySignature } from '@core/crypto/index.js';
import { getHostAndSelector, isDelegationAllowed, resolvePublicKey } from '@core/utils/index.js';
import type { BTPAttestation, BTPDelegation, BTPTransporterArtifact } from '@core/server/types.js';
import type { BtpsKeyResolver } from '@core/crypto/keyResolver.js';

type Verified = { isValid: boolean; error?: BTPErrorException };

/** A signature key: from the resolver when one is given, else from DNS, as without one. */
const signatureKey = (identity: string, selector: string, keyResolver?: BtpsKeyResolver) =>
  keyResolver
    ? keyResolver.resolvePublicKey(identity, selector, 'verify')
    : resolvePublicKey(identity, selector);

/** A delegation's attestation, signed by the attestor over the delegation. */
export const verifyAttestation = async (
  delegation: Omit<BTPDelegation, 'attestation'> & { attestation: BTPAttestation },
  keyResolver?: BtpsKeyResolver,
): Promise<Verified> => {
  const { attestation, ...restDelegation } = delegation;
  const { signature, ...restAttestation } = attestation;

  const attestorPubKey = await signatureKey(
    attestation.signedBy,
    attestation.selector,
    keyResolver,
  );
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
    );
    if (!isValid) return { isValid, error };
  }

  /* Verify the delegation signature against the delegated artifact which includes the original artifact and signed artifact*/
  const delegatorPubKey = await signatureKey(delegation.signedBy, delegation.selector, keyResolver);
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
 * Since 1.2, every key is found through `keyResolver` when one is given.
 */
export const verifyTransporterSignature = async (
  artifact: BTPTransporterArtifact,
  keyResolver?: BtpsKeyResolver,
): Promise<Verified & { signerKey?: string }> => {
  if (artifact.delegation) {
    const delegated = await verifyDelegation(
      artifact as Omit<BTPTransporterArtifact, 'delegation'> & { delegation: BTPDelegation },
      keyResolver,
    );
    return delegated.isValid
      ? { ...delegated, signerKey: artifact.delegation.agentPubKey }
      : delegated;
  }

  const { signature, ...signedMsg } = artifact;
  const publicKey = await signatureKey(artifact.from, artifact.selector, keyResolver);

  if (!publicKey) {
    return { isValid: false, error: new BTPErrorException(BTP_ERROR_RESOLVE_PUBKEY) };
  }

  const verified = verifySignature(signedMsg, signature, publicKey);
  return verified.isValid ? { ...verified, signerKey: publicKey } : verified;
};
