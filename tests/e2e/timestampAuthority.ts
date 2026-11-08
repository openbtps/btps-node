/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// A test RFC 3161 timestamp authority, as one is run: a root CA, and the
// authority's own certificate it issues, for time stamping only (its one
// extended key usage, critical). It answers a request for a SHA-256 with a
// real TimeStampResp.

import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';

const { subtle } = globalThis.crypto;
const TST_INFO = '1.2.840.113549.1.9.16.1.4';

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
const extension = (extnID: string, value: pkijs.BasicConstraints | pkijs.ExtKeyUsage) =>
  new pkijs.Extension({
    extnID,
    critical: true,
    extnValue: value.toSchema().toBER(false),
    parsedValue: value,
  });

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
  certificate.notBefore.value = new Date(Date.now() - 86_400_000);
  certificate.notAfter.value = new Date(Date.now() + 86_400_000);
  certificate.extensions = extensions;
  await certificate.subjectPublicKeyInfo.importKey(subject.keys.publicKey);
  await certificate.sign(issuer.keys.privateKey, 'SHA-256');
  return certificate;
};

/** A timestamp authority: its root's PEM, and a reply to a request over `sha256Hex`. */
export async function startTimestampAuthority(name: string) {
  const ca = { cn: `${name} Root`, keys: await keyPair() };
  const tsa = { cn: name, keys: await keyPair() };
  const root = await certify(ca, ca, 1, [
    extension('2.5.29.19', new pkijs.BasicConstraints({ cA: true })),
  ]);
  const certificate = await certify(tsa, ca, 7, [
    extension('2.5.29.37', new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.8'] })),
  ]);
  const rootPem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(root.toSchema().toBER()).toString('base64')}\n-----END CERTIFICATE-----`;

  const respond = async (sha256Hex: string): Promise<Uint8Array> => {
    const eContent = new pkijs.TSTInfo({
      version: 1,
      policy: '1.3.6.1.4.1.99999.1',
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: '2.16.840.1.101.3.4.2.1' }),
        hashedMessage: new asn1js.OctetString({ valueHex: Buffer.from(sha256Hex, 'hex') }),
      }),
      serialNumber: new asn1js.Integer({ value: 1 }),
      genTime: new Date(),
    })
      .toSchema()
      .toBER();
    const signedData = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: TST_INFO,
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
                values: [new asn1js.ObjectIdentifier({ value: TST_INFO })],
              }),
              new pkijs.Attribute({
                type: '1.2.840.113549.1.9.4',
                values: [
                  new asn1js.OctetString({ valueHex: await subtle.digest('SHA-256', eContent) }),
                ],
              }),
            ],
          }),
        }),
      ],
      certificates: [certificate],
    });
    await signedData.sign(tsa.keys.privateKey, 0, 'SHA-256');
    const token = new pkijs.ContentInfo({
      contentType: '1.2.840.113549.1.7.2',
      content: signedData.toSchema(true),
    });
    const reply = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: 0 }),
      timeStampToken: token,
    });
    return new Uint8Array(reply.toSchema().toBER());
  };
  return { rootPem, respond };
}
