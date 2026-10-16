/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import type { BTPTransporterArtifact, BTPDelegation, BTPAttestation } from '../server/types.js';
import { signBtpPayload } from '../crypto/index.js';
import { attestationSignedMessage, delegationSignedMessage } from './signedMessages.js';
import type { BTPSigningKey, PemKeys } from '@core/crypto/types.js';
import type { Signer } from '../../signer-interface.js';
import { getHostAndSelector, resolvePublicKey } from '@core/utils/index.js';
import { createSign, createVerify, verify } from 'crypto';
import {
  BTP_ERROR_SIG_VERIFICATION,
  BTP_ERROR_VALIDATION,
  BTPErrorException,
} from '@core/error/index.js';

/**
 * Delegator configuration options. The delegator signs through `signer` (a
 * `Signer`, e.g. `KmsSigner`), or `privateKey`, a PEM wrapped in a
 * `PemSigner` once its public key is resolved (tests and the interim only).
 * One of the two is required.
 */
export type BtpsDelegatorOptions = {
  identity: string;
  /**
   * Default true: the first `delegateArtifact` awaits `init()`. False: the
   * caller awaits `init()` itself, and `delegateArtifact` throws until it
   * has. The constructor never does I/O either way.
   */
  autoInit?: boolean;
} & (
  | { signer: Signer; privateKey?: undefined }
  | { privateKey: PemKeys['privateKey']; signer?: undefined }
);

/**
 * Production-grade Delegator for BTPS artifacts
 * Handles delegation and attestation logic for SaaS and user-managed keys
 */
export class BtpsDelegator {
  private readonly identity: string;
  private readonly privateKey?: PemKeys['privateKey'];
  private readonly signer?: Signer;
  /** What signs: the Signer, or once the public key is resolved, the PEM pair. */
  private signingKey?: BTPSigningKey;
  private publicKey?: PemKeys['publicKey'];
  private selector: string = 'btps1';
  private isInitialized = false;

  /**
   * Initialize the delegator
   * @param options - The delegator options
   */
  constructor(options: BtpsDelegatorOptions) {
    this.identity = options.identity;
    if (!options.signer && !options.privateKey) {
      throw new BTPErrorException(BTP_ERROR_VALIDATION, {
        cause: 'BtpsDelegator needs a signer (or a privateKey PEM, for tests and the interim)',
      });
    }
    this.signer = options.signer;
    this.privateKey = options.privateKey;
    // No I/O here: the constructor used to start init()'s DNS
    // lookup and await nothing, so a failure was an unhandled rejection.
    // With autoInit (the default), the first delegateArtifact awaits init().
    this.autoInit = options.autoInit !== false;
  }

  private readonly autoInit: boolean;
  /** The one init() in flight, or done; cleared on failure so the next call retries. */
  private initializing?: Promise<void>;

  /**
   * Initialize the delegator: verifies the delegator identity against its
   * published key and sets the public key. Awaited by the first
   * `delegateArtifact` unless `autoInit` is false; may be called first, to
   * fail at start-up rather than on the first artifact.
   * @throws BTPErrorException if the delegator identity verification fails
   */
  init(): Promise<void> {
    this.initializing ??= this.verifyAndSetKey().catch((err: unknown) => {
      this.initializing = undefined;
      throw err;
    });
    return this.initializing;
  }

  private async verifyAndSetKey(): Promise<void> {
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
    this.signingKey = this.signer ?? { publicKey, privateKey: this.privateKey! };
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
    const isValid = this.signer
      ? await this.isSignerMatching(this.signer, publicKey)
      : this.isKeyPairMatching(this.privateKey!, publicKey);
    return { isValid, publicKey };
  }

  /**
   * Verify that a Signer signs for the published public key
   * @param signer - The signer
   * @param publicKeyPem - The public key in PEM format
   * @returns {Promise<boolean>} - True if a signature made through the signer verifies with the key
   */
  protected async isSignerMatching(signer: Signer, publicKeyPem: string): Promise<boolean> {
    const message = Buffer.from('btps-key-validation', 'utf8');
    try {
      const signature = await signer.sign(new Uint8Array(message));
      return verify('sha256', message, publicKeyPem, Buffer.from(signature));
    } catch {
      return false;
    }
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
      /** The identity's own Signer. */
      signer?: Signer;
      /** The identity's PEM key pair: tests and the interim only. */
      keyPair?: PemKeys;
    },
  ): Promise<BTPTransporterArtifact & { delegation: BTPDelegation }> {
    if (this.autoInit && !this.isInitialized) await this.init();
    if (!this.isInitialized || !this.publicKey || !this.signingKey)
      throw new BTPErrorException({ message: 'Delegator not initialized' });

    // Each signature names its own signer's key: the delegation the
    // delegator's (this identity, or the one acted for), the attestation
    // this identity's.
    let delegatorSelector = this.selector;
    if (onBehalfOf) {
      const dnsHostAndSelector = await getHostAndSelector(onBehalfOf.identity);
      if (!dnsHostAndSelector)
        throw new BTPErrorException(BTP_ERROR_SIG_VERIFICATION, {
          cause: 'Delegator identity verification failed',
        });
      delegatorSelector = dnsHostAndSelector.selector;
    }
    const delegation = await this.createDelegation({
      artifact,
      delegatorIdentity: onBehalfOf?.identity ?? this.identity,
      delegatorKey: onBehalfOf?.signer ?? onBehalfOf?.keyPair ?? this.signingKey,
      agentId,
      agentPubKey,
      selector: delegatorSelector,
    });

    if (onBehalfOf) {
      // User key signs delegation, SaaS attests
      const attestation = await this.createAttestation({
        delegation,
        attestorIdentity: this.identity,
        attestorKey: this.signingKey,
        selector: this.selector,
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
    delegatorKey: BTPSigningKey;
    agentId: string;
    agentPubKey: string;
    selector: string;
  }): Promise<BTPDelegation> {
    const delegation = {
      agentId: params.agentId,
      agentPubKey: params.agentPubKey,
      signedBy: params.delegatorIdentity,
      issuedAt: new Date().toISOString(),
      selector: params.selector,
    };
    const signature = await signBtpPayload(
      delegationSignedMessage(params.artifact, delegation),
      params.delegatorKey,
    );
    return { ...delegation, signature };
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
    const attestation = {
      signedBy: params.attestorIdentity,
      issuedAt: new Date().toISOString(),
      // The attestor's own key: the server resolves it at signedBy + selector.
      selector: params.selector,
    };
    const signature = await signBtpPayload(
      attestationSignedMessage({ ...params.delegation, attestation }),
      params.attestorKey,
    );
    return { ...attestation, signature };
  }
}
