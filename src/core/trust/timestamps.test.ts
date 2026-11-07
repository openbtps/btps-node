/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: RFC 3161 timestamps on an agreement's statements. A test
 * authority, made here with a self-signed certificate, signs real tokens.
 */

import { describe, expect, it } from 'vitest';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import { statementRecordSha256 } from './agreements.js';
import { timestampFacts, timestampRequest, timestampTokenOf } from './timestamps.js';
import type { BTPStatementRecord } from './types.js';

const record: BTPStatementRecord = {
  statement: {
    agreement: { originator: 'loans$bank.example', id: 'AGR-1', contentSha256: 'a'.repeat(64) },
    terms: [],
    signer: 'alice$client.example',
    decision: 'accepted',
    signedAt: '2026-11-02T00:00:00.000Z',
  },
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
};
const GEN_TIME = new Date('2026-11-02T00:05:00.000Z');

const subtle = globalThis.crypto.subtle;
const keyPair = () =>
  subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
const nameOf = (cn: string) => [
  new pkijs.AttributeTypeAndValue({ type: '2.5.4.3', value: new asn1js.Utf8String({ value: cn }) }),
];
const pemOf = (certificate: pkijs.Certificate) =>
  `-----BEGIN CERTIFICATE-----\n${Buffer.from(certificate.toSchema().toBER()).toString('base64')}\n-----END CERTIFICATE-----`;

/** A certificate for `subject`, issued and signed by `issuer` (itself, for a root). */
const certify = async (
  subject: { cn: string; keys: CryptoKeyPair },
  issuer: { cn: string; keys: CryptoKeyPair },
  serial: number,
  extensions: pkijs.Extension[],
) => {
  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: serial });
  certificate.issuer.typesAndValues = nameOf(issuer.cn);
  certificate.subject.typesAndValues = nameOf(subject.cn);
  certificate.notBefore.value = new Date('2026-01-01T00:00:00.000Z');
  certificate.notAfter.value = new Date('2036-01-01T00:00:00.000Z');
  certificate.extensions = extensions;
  await certificate.subjectPublicKeyInfo.importKey(subject.keys.publicKey);
  await certificate.sign(issuer.keys.privateKey, 'SHA-256');
  return certificate;
};

/**
 * A test authority, as one is run: a root CA, and the authority's own
 * certificate it issues, for time stamping only. Their PEMs, and a way to
 * answer a request.
 */
const authority = async (name: string) => {
  const ca = { cn: `${name} Root`, keys: await keyPair() };
  const tsa = { cn: name, keys: await keyPair() };
  const basicConstraints = new pkijs.BasicConstraints({ cA: true });
  const root = await certify(ca, ca, 1, [
    new pkijs.Extension({
      extnID: '2.5.29.19',
      critical: true,
      extnValue: basicConstraints.toSchema().toBER(false),
      parsedValue: basicConstraints,
    }),
  ]);
  // Extended key usage: timeStamping, critical, as RFC 3161 requires of an authority.
  const usage = new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] });
  const certificate = await certify(tsa, ca, 7, [
    new pkijs.Extension({
      extnID: '2.5.29.37',
      critical: true,
      extnValue: usage.toSchema().toBER(false),
      parsedValue: usage,
    }),
  ]);
  const keys = tsa.keys;
  const pem = pemOf(certificate);
  const rootPem = pemOf(root);

  /** A TimeStampResp granting a token over `sha256Hex`, as an authority answers. */
  const respond = async (sha256Hex: string): Promise<Uint8Array> => {
    const tstInfo = new pkijs.TSTInfo({
      version: 1,
      policy: '1.3.6.1.4.1.99999.1',
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: '2.16.840.1.101.3.4.2.1' }),
        hashedMessage: new asn1js.OctetString({ valueHex: Buffer.from(sha256Hex, 'hex') }),
      }),
      serialNumber: new asn1js.Integer({ value: 1 }),
      genTime: GEN_TIME,
    });
    const eContent = tstInfo.toSchema().toBER();
    const digest = await subtle.digest('SHA-256', eContent);
    const signedData = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: '1.2.840.113549.1.9.16.1.4',
        eContent: new asn1js.OctetString({ valueHex: eContent }),
      }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({
            issuer: certificate.issuer,
            serialNumber: certificate.serialNumber,
          }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({
                type: '1.2.840.113549.1.9.3',
                values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.9.16.1.4' })],
              }),
              new pkijs.Attribute({
                type: '1.2.840.113549.1.9.4',
                values: [new asn1js.OctetString({ valueHex: digest })],
              }),
            ],
          }),
        }),
      ],
      certificates: [certificate],
    });
    await signedData.sign(keys.privateKey, 0, 'SHA-256');
    const token = new pkijs.ContentInfo({
      contentType: '1.2.840.113549.1.7.2',
      content: signedData.toSchema(true),
    });
    const response = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: 0 }),
      timeStampToken: token,
    });
    return new Uint8Array(response.toSchema().toBER());
  };
  return { pem, rootPem, respond };
};

describe('a trusted timestamp on a statement', () => {
  it('is asked for by the SHA-256 of the statement record only', async () => {
    const der = await timestampRequest(record, { nonce: 42 });
    const request = pkijs.TimeStampReq.fromBER(der);
    expect(request.certReq).toBe(true);
    expect(Buffer.from(request.messageImprint.hashedMessage.getValue()).toString('hex')).toBe(
      statementRecordSha256(record),
    );
  });

  it('checks: over this statement, signed, at its time, trusted when its root is given', async () => {
    const tsa = await authority('Test TSA');
    const token = await timestampTokenOf(await tsa.respond(statementRecordSha256(record)));
    const sha256 = statementRecordSha256(record);

    expect(await timestampFacts(token, sha256)).toEqual({
      imprintMatches: true,
      signatureValid: true,
      time: GEN_TIME.toISOString(),
      authority: 'CN=Test TSA',
    });
    const trustedBy = async (pem: string) =>
      (await timestampFacts(token, sha256, { trustedRoots: [pem] })).trusted;
    expect(await trustedBy(tsa.rootPem)).toBe(true);
    // A platform may pin the authority's own certificate instead of its root.
    expect(await trustedBy(tsa.pem)).toBe(true);
  });

  it("is not trusted under another root, and is not this statement's when its imprint differs", async () => {
    const tsa = await authority('Test TSA');
    const other = await authority('Other TSA');
    const token = await timestampTokenOf(await tsa.respond('b'.repeat(64)));
    const facts = await timestampFacts(token, statementRecordSha256(record), {
      trustedRoots: [other.rootPem],
    });
    expect(facts).toMatchObject({ imprintMatches: false, signatureValid: true, trusted: false });
  });

  it('is unreadable, never an error, when the token is not one', async () => {
    expect(await timestampFacts('AAAA', statementRecordSha256(record))).toEqual({
      imprintMatches: false,
      signatureValid: false,
    });
  });

  it('is refused from a reply that grants none', async () => {
    const refusal = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 2 }) });
    await expect(
      timestampTokenOf(new Uint8Array(refusal.toSchema().toBER())),
    ).rejects.toMatchObject({
      code: 'BTP_ERROR_VALIDATION',
    });
  });
});
