/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPAttestation, BTPDelegation, BTPTransporterArtifact } from '../server/types.js';

/*
 * What each signature in a delegated artifact is over. The signer
 * (BtpsDelegator) and the verifier (BtpsServer) both build the message here,
 * so they cannot drift apart. They did: the delegation was signed before
 * the attestation was added, and verified with it in place, so an attested
 * delegation never verified (addendum item 10, EBA-122).
 *
 * Order of signing: the agent signs the artifact; the delegator signs the
 * artifact with the delegation; the attestor, when there is one, signs the
 * signed delegation with the attestation.
 */

type UnsignedDelegation = Omit<BTPDelegation, 'signature' | 'attestation'>;
type UnsignedAttestation = Omit<BTPAttestation, 'signature'>;

/**
 * The delegator's message: the artifact (with the agent's signature, without
 * a delegation) and the delegation without its signature and without any
 * attestation.
 */
export const delegationSignedMessage = (
  artifact: Omit<BTPTransporterArtifact, 'delegation'> & { delegation?: unknown },
  delegation: UnsignedDelegation & Partial<Pick<BTPDelegation, 'signature' | 'attestation'>>,
) => {
  const { delegation: _ignored, ...rest } = artifact;
  const { signature: _signature, attestation: _attestation, ...unsigned } = delegation;
  return { ...rest, delegation: unsigned as UnsignedDelegation };
};

/**
 * The attestor's message: the delegation with the delegator's signature, and
 * the attestation without its own signature.
 */
export const attestationSignedMessage = (
  delegation: Omit<BTPDelegation, 'attestation'> & {
    attestation: UnsignedAttestation & Partial<Pick<BTPAttestation, 'signature'>>;
  },
) => {
  const { attestation, ...signedDelegation } = delegation;
  const { signature: _signature, ...unsigned } = attestation;
  return { ...signedDelegation, attestation: unsigned as UnsignedAttestation };
};
