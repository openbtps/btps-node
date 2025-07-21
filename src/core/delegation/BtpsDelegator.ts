/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPTransporterArtifact, BTPDelegation, BTPAttestation } from '../server/types.js';
import { signBtpPayload } from '../crypto/index.js';
import type { PemKeys } from '@core/crypto/types.js';
import { getHostAndSelector, resolvePublicKey } from '@core/utils/index.js';
import { createSign, createVerify } from 'crypto';
import { BTP_ERROR_SIG_VERIFICATION, BTPErrorException } from '@core/error/index.js';

/**
 * Delegator configuration options
 */
export interface BtpsDelegatorOptions {
  identity: string;
  privateKey: PemKeys['privateKey'];
  autoInit?: boolean; // Optional: disable auto-initialization for testing
}

/**
 * Production-grade Delegator for BTPS artifacts
 * Handles delegation and attestation logic for SaaS and user-managed keys
 */
export class BtpsDelegator {
  private readonly identity: string;
  private readonly privateKey: PemKeys['privateKey'];
  private publicKey?: PemKeys['publicKey'];
  private selector: string = 'btps1';
  private isInitialized = false;

  /**
   * Initialize the delegator
   * @param options - The delegator options
   */
  constructor(options: BtpsDelegatorOptions) {
    this.identity = options.identity;
    this.privateKey = options.privateKey;
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
    return { isValid: this.isKeyPairMatching(this.privateKey, publicKey), publicKey };
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
      keyPair: PemKeys;
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
      delegatorKey: {
        privateKey: onBehalfOf?.keyPair?.privateKey ?? this.privateKey,
        publicKey: onBehalfOf?.keyPair?.publicKey ?? this.publicKey,
      },
      agentId,
      agentPubKey,
      selector,
    });

    if (onBehalfOf) {
      // User key signs delegation, SaaS attests
      const attestation = await this.createAttestation({
        delegation,
        attestorIdentity: this.identity,
        attestorKey: {
          privateKey: this.privateKey,
          publicKey: this.publicKey,
        },
        selector,
      });
      delegation.attestation = attestation;
    }

    return { ...artifact, delegation };
  }

  /**
   * Create and sign a delegation
   */
  protected async createDelegation(params: {
    artifact: BTPTransporterArtifact;
    delegatorIdentity: string;
    delegatorKey: PemKeys;
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
    const signature = signBtpPayload(delegationPayload, params.delegatorKey);
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
    attestorKey: PemKeys;
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
    const signature = signBtpPayload(attestationPayload, params.attestorKey);
    return {
      ...attestationPayload.attestation,
      signature,
    };
  }
}
