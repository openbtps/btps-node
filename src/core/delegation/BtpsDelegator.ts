/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPTransporterArtifact, BTPDelegation, BTPAttestation } from '../server/types.js';
import { signBtpPayload, signBtpPayloadWithSigner } from '../crypto/index.js';
import type { BTPSigningKey, PemKeys } from '@core/crypto/types.js';
import type { Signer } from '@core/crypto/signer-interface.js';
import { getHostAndSelector, resolvePublicKey } from '@core/utils/index.js';
import { createSign, createVerify } from 'crypto';
import { BTP_ERROR_SIG_VERIFICATION, BTPErrorException } from '@core/error/index.js';

/**
 * Delegator configuration options
 */
export type BtpsDelegatorOptions = {
  identity: string;
  autoInit?: boolean; // Optional: disable auto-initialization for testing
} & (
  | { privateKey: PemKeys['privateKey'] }
  // The delegator's private key held elsewhere (a KMS)
  | { signer: Signer }
);

/**
 * Production-grade Delegator for BTPS artifacts
 * Handles delegation and attestation logic for SaaS and user-managed keys
 */
export class BtpsDelegator {
  private readonly identity: string;
  private readonly key: PemKeys['privateKey'] | Signer;
  private publicKey?: PemKeys['publicKey'];
  private selector: string = 'btps1';
  private isInitialized = false;

  /**
   * Initialize the delegator
   * @param options - The delegator options
   */
  constructor(options: BtpsDelegatorOptions) {
    this.identity = options.identity;
    this.key = 'signer' in options ? options.signer : options.privateKey;
    if (options.autoInit !== false) {
      this.init();
    }
  }

  /**
   * Initialize the delegator
   * This method is called automatically when the delegator is created
   * It verifies the delegator identity and sets the public key
   * @throws BTPErrorException if the delegator identity verification fails
   */
  async init() {
    const { publicKey, isValid } = await this.verifyDelegatorIdentity();
    if (!publicKey || !isValid)
      throw new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
        cause: 'Delegator identity verification failed',
        meta: {
          identity: this.identity,
          publicKey,
          isValid,
        },
      });

    this.publicKey = publicKey;
    this.isInitialized = true;
  }

  /**
   * Verify the delegator identity
   * @returns {isValid: boolean, publicKey?: string} - The result of the verification
   */
  protected async verifyDelegatorIdentity(): Promise<{ isValid: boolean; publicKey?: string }> {
    const dnsHostAndSelector = await getHostAndSelector(this.identity);
    if (!dnsHostAndSelector) return { isValid: false, publicKey: undefined };
    this.selector = dnsHostAndSelector.selector;

    const publicKey = await resolvePublicKey(this.identity, this.selector);
    if (!publicKey) return { isValid: false, publicKey: undefined };
    const isValid =
      typeof this.key === 'string'
        ? this.isKeyPairMatching(this.key, publicKey)
        : await this.isSignerMatching(this.key, publicKey);
    return { isValid, publicKey };
  }

  /**
   * Verify that a Signer signs with the private key matching the public key
   * @param signer - The Signer holding the private key
   * @param publicKeyPem - The public key in PEM format
   * @returns {Promise<boolean>} - True if the keys match, false otherwise
   */
  protected async isSignerMatching(signer: Signer, publicKeyPem: string): Promise<boolean> {
    const message = Buffer.from('btps-key-validation');
    const signature = await signer.sign(message);
    return createVerify('sha256').update(message).end().verify(publicKeyPem, signature);
  }

  /**
   * Verify if the private key matches the public key
   * @param privateKeyPem - The private key in PEM format
   * @param publicKeyPem - The public key in PEM format
   * @returns {boolean} - True if the keys match, false otherwise
   */
  protected isKeyPairMatching(privateKeyPem: string, publicKeyPem: string): boolean {
    const message = 'btps-key-validation';
    const sign = createSign('sha256').update(message).end().sign(privateKeyPem);
    return createVerify('sha256').update(message).end().verify(publicKeyPem, sign);
  }

  /**
   * Decorate a BTPTransporterArtifact with delegation and attestation as needed
   * @param artifact The artifact to delegate
   * @param context Delegation context (user type, id, identity)
   * @returns The artifact with delegation (and attestation if required)
   */
  async delegateArtifact(
    agentId: string,
    agentPubKey: string,
    artifact: BTPTransporterArtifact,
    onBehalfOf?: {
      identity: string;
      keyPair: BTPSigningKey;
    },
  ): Promise<BTPTransporterArtifact & { delegation: BTPDelegation }> {
    if (!this.isInitialized || !this.publicKey)
      throw new BTPErrorException({ message: 'Delegator not initialized' });

    let selector = this.selector;
    if (onBehalfOf) {
      const dnsHostAndSelector = await getHostAndSelector(onBehalfOf.identity);
      if (!dnsHostAndSelector)
        throw new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
          cause: 'Delegator identity verification failed',
        });
      selector = dnsHostAndSelector.selector;
    }
    const delegation = await this.createDelegation({
      artifact,
      delegatorIdentity: onBehalfOf?.identity ?? this.identity,
      delegatorKey: onBehalfOf?.keyPair ?? this.ownKey(this.publicKey),
      agentId,
      agentPubKey,
      selector,
    });

    if (onBehalfOf) {
      // User key signs delegation, SaaS attests
      // Signed with the attestor's own key, so it names the attestor's own selector:
      // the receiver finds the attestor's key under it
      const attestation = await this.createAttestation({
        delegation,
        attestorIdentity: this.identity,
        attestorKey: this.ownKey(this.publicKey),
        selector: this.selector,
      });
      delegation.attestation = attestation;
    }

    return { ...artifact, delegation };
  }

  /**
   * The delegator's own signing key, as createDelegation and createAttestation take it
   */
  private ownKey(publicKey: string): BTPSigningKey {
    return typeof this.key === 'string' ? { privateKey: this.key, publicKey } : this.key;
  }

  /**
   * Create and sign a delegation
   */
  protected async createDelegation(params: {
    artifact: BTPTransporterArtifact;
    delegatorIdentity: string;
    delegatorKey: BTPSigningKey;
    agentId: string;
    agentPubKey: string;
    selector: string;
  }): Promise<BTPDelegation> {
    const issuedAt = new Date().toISOString();
    const delegationPayload = {
      ...params.artifact,
      delegation: {
        agentId: params.agentId,
        agentPubKey: params.agentPubKey,
        signedBy: params.delegatorIdentity,
        issuedAt,
        selector: params.selector,
      },
    };
    const signature =
      'sign' in params.delegatorKey
        ? await signBtpPayloadWithSigner(delegationPayload, params.delegatorKey)
        : signBtpPayload(delegationPayload, params.delegatorKey);
    return {
      ...delegationPayload.delegation,
      signature,
    };
  }

  /**
   * Create and sign an attestation
   */
  protected async createAttestation(params: {
    delegation: Omit<BTPDelegation, 'attestation'>;
    attestorIdentity: string;
    attestorKey: BTPSigningKey;
    selector: string;
  }): Promise<BTPAttestation> {
    const issuedAt = new Date().toISOString();
    const attestationPayload = {
      ...params.delegation,
      attestation: {
        signedBy: params.attestorIdentity,
        issuedAt,
        selector: params.selector,
      },
    };
    const signature =
      'sign' in params.attestorKey
        ? await signBtpPayloadWithSigner(attestationPayload, params.attestorKey)
        : signBtpPayload(attestationPayload, params.attestorKey);
    return {
      ...attestationPayload.attestation,
      signature,
    };
  }
}
