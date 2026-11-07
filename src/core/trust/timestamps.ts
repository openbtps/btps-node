/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * Since 1.2: RFC 3161 trusted timestamps on an agreement's statements. A
 * provider asks a timestamp authority to sign the SHA-256 of a statement
 * record, and only that hash leaves it, never the content. A token proves the
 * statement existed by its time, so it cannot be made later and backdated,
 * and keeps proving it after the signer's key rotates. Which authorities to
 * trust is each platform's choice; BTPS reports facts.
 */

import crypto from 'crypto';
import { BTPErrorException } from '@core/error/index.js';
import { BTP_ERROR_VALIDATION } from '@core/error/constant.js';
import { statementRecordSha256 } from './agreements.js';
import type { BTPStatementRecord } from './types.js';

const SHA256 = '2.16.840.1.101.3.4.2.1';
const TST_INFO = '1.2.840.113549.1.9.16.1.4';
const MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const CONTENT_TYPE = '1.2.840.113549.1.9.3';
const EXT_KEY_USAGE = '2.5.29.37';
const TIME_STAMPING = '1.3.6.1.5.5.7.3.8';
const HASHES: Record<string, string> = {
  [SHA256]: 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512',
};

/** Since 1.2: what a timestamp token shows about the statement it is for. */
export type BTPTimestampFacts = {
  /** The token's message imprint is the SHA-256 of this statement record */
  imprintMatches: boolean;
  /** The token is signed by the certificate it carries */
  signatureValid: boolean;
  /** The time the authority put on it, when the token could be read */
  time?: string;
  /** Who signed it: its certificate's subject */
  authority?: string;
  /**
   * The signer's certificate is a timestamp authority's (RFC 3161 §2.3): its
   * only extended key usage is id-kp-timeStamping, marked critical
   */
  timestampingKeyUsage?: boolean;
  /** With trusted roots given: a timestamp authority's certificate that chains to one of them */
  trusted?: boolean;
};

// Loaded only when a timestamp is used, so code that never needs one does not bundle them.
const libraries = async () => ({ asn1js: await import('asn1js'), pkijs: await import('pkijs') });

const hexOf = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(new Uint8Array(bytes)).toString('hex');
const derOfPem = (pem: string) =>
  Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

/**
 * Since 1.2: an RFC 3161 TimeStampReq, DER encoded, for the SHA-256 of a
 * statement record, asking for the authority's certificate in the reply. A
 * platform sends it to the authority of its choice
 * (`Content-Type: application/timestamp-query`).
 */
export const timestampRequest = async (
  record: BTPStatementRecord,
  options: { nonce?: number } = {},
): Promise<Uint8Array> => {
  const { asn1js, pkijs } = await libraries();
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256 }),
      hashedMessage: new asn1js.OctetString({
        valueHex: Buffer.from(statementRecordSha256(record), 'hex'),
      }),
    }),
    certReq: true,
    ...(options.nonce !== undefined && { nonce: new asn1js.Integer({ value: options.nonce }) }),
  });
  return new Uint8Array(request.toSchema().toBER());
};

/**
 * Since 1.2: the token in an authority's RFC 3161 TimeStampResp, base64, as
 * an evidence bundle holds it. A reply that grants none is refused
 * (`BTP_ERROR_VALIDATION`).
 */
export const timestampTokenOf = async (response: Uint8Array): Promise<string> => {
  const { pkijs } = await libraries();
  const reply = pkijs.TimeStampResp.fromBER(response);
  // 0 granted, 1 granted with modifications.
  if (reply.status.status > 1 || !reply.timeStampToken) {
    throw new BTPErrorException(BTP_ERROR_VALIDATION, {
      cause: `the timestamp authority granted no token (status ${reply.status.status})`,
    });
  }
  return Buffer.from(reply.timeStampToken.toSchema().toBER()).toString('base64');
};

/**
 * Since 1.2: the facts of a timestamp token, base64, for the statement record
 * whose SHA-256 is `statementSha256`. With `trustedRoots` (PEM certificates),
 * it also says whether the authority's certificate chains to one of them;
 * without, `trusted` is left out. It refuses nothing.
 */
export const timestampFacts = async (
  token: string,
  statementSha256: string,
  options: { trustedRoots?: string[] } = {},
): Promise<BTPTimestampFacts> => {
  const { asn1js, pkijs } = await libraries();
  const unread: BTPTimestampFacts = { imprintMatches: false, signatureValid: false };
  try {
    const contentInfo = pkijs.ContentInfo.fromBER(Buffer.from(token, 'base64'));
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    const { eContentType, eContent } = signedData.encapContentInfo;
    if (eContentType !== TST_INFO || !eContent) return unread;
    // What the authority signed: the TSTInfo, whose imprint names the statement.
    const content = Buffer.from(eContent.getValue());
    const tstInfo = pkijs.TSTInfo.fromBER(content);
    const { hashAlgorithm, hashedMessage } = tstInfo.messageImprint;
    const imprintMatches =
      hashAlgorithm.algorithmId === SHA256 &&
      hexOf(hashedMessage.valueBlock.valueHexView) === statementSha256;

    // The signature is checked on its own, so a token over another statement still reports it.
    const [signerInfo] = signedData.signerInfos;
    const certificates = (signedData.certificates ?? []).filter(
      (cert): cert is InstanceType<typeof pkijs.Certificate> => cert instanceof pkijs.Certificate,
    );
    const sid = signerInfo?.sid;
    const signer =
      sid instanceof pkijs.IssuerAndSerialNumber
        ? certificates.find(
            (cert) =>
              cert.issuer.isEqual(sid.issuer) && cert.serialNumber.isEqual(sid.serialNumber),
          )
        : undefined;
    const authority = signer?.subject.typesAndValues
      .map(({ type, value }) => `${type === '2.5.4.3' ? 'CN' : type}=${value.valueBlock.value}`)
      .join(', ');
    // RFC 3161 §2.3: an authority's certificate has one extended key usage, id-kp-timeStamping, critical.
    const usages = signer?.extensions?.filter(({ extnID }) => extnID === EXT_KEY_USAGE) ?? [];
    const [usage] = usages;
    const timestampingKeyUsage =
      usages.length === 1 &&
      usage?.critical === true &&
      usage.parsedValue instanceof pkijs.ExtKeyUsage &&
      usage.parsedValue.keyPurposes.length === 1 &&
      usage.parsedValue.keyPurposes[0] === TIME_STAMPING;
    const hash = signerInfo && HASHES[signerInfo.digestAlgorithm.algorithmId];
    const attributes = signerInfo?.signedAttrs;
    const attribute = (type: string) =>
      attributes?.attributes.find((attr) => attr.type === type)?.values[0];
    const digest = attribute(MESSAGE_DIGEST);
    // RFC 5652 §5.3: the content type it signs is the one it carries, a TSTInfo.
    const contentType = attribute(CONTENT_TYPE);
    const contentTypeMatches =
      contentType instanceof asn1js.ObjectIdentifier && contentType.getValue() === TST_INFO;
    let signatureValid = false;
    if (
      signer &&
      hash &&
      attributes?.encodedValue &&
      digest instanceof Object &&
      contentTypeMatches
    ) {
      const digestMatches =
        hexOf(digest.valueBlock.valueHexView) ===
        crypto.createHash(hash).update(content).digest('hex');
      // The signed attributes are signed as a SET, not under the [0] tag they travel in.
      const signed = Buffer.from(attributes.encodedValue);
      signed[0] = 0x31;
      const key = crypto.createPublicKey({
        key: Buffer.from(signer.subjectPublicKeyInfo.toSchema().toBER()),
        format: 'der',
        type: 'spki',
      });
      signatureValid =
        digestMatches &&
        crypto.verify(hash, signed, key, Buffer.from(signerInfo.signature.valueBlock.valueHexView));
    }
    const roots = options.trustedRoots?.map((pem) => pkijs.Certificate.fromBER(derOfPem(pem)));
    const signerDer = signer && hexOf(signer.toSchema().toBER());
    // Trusted when it is an authority's certificate, and a root is that certificate (pinned) or its chain reaches one.
    const trusted =
      roots === undefined
        ? undefined
        : signatureValid &&
          timestampingKeyUsage &&
          signer !== undefined &&
          (roots.some((root) => hexOf(root.toSchema().toBER()) === signerDer) ||
            (
              await new pkijs.CertificateChainValidationEngine({
                certs: [...certificates.filter((cert) => cert !== signer), signer],
                trustedCerts: roots,
                checkDate: tstInfo.genTime,
              })
                .verify()
                .catch(() => ({ result: false }))
            ).result);
    return {
      imprintMatches,
      signatureValid,
      time: tstInfo.genTime.toISOString(),
      ...(authority && { authority }),
      ...(signer && { timestampingKeyUsage }),
      ...(trusted !== undefined && { trusted }),
    };
  } catch {
    return unread;
  }
};
