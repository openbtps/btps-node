---
title: SDK API References
sidebar_label: API References
slug: api-references
---

# BTPS SDK API Reference

This reference documents all public functions exported by the BTPS SDK, except for classes (see [Class API Reference](./classApiReference.md)). For types and interfaces, see [Types & Interfaces](./typesAndInterfaces.md).

---

## Utilities (`@btps/sdk`)

### parseIdentity

```ts
parseIdentity(identity: string): ParsedIdentity | null
```

**Description:**
Parses a BTPS identity string (e.g., `billing$company.com`) into its account and domain parts.

**Arguments:**

- `identity` (`string`, required): The identity string to parse.

**Returns:**

- `ParsedIdentity` object `{ accountName: string, domainName: string }` if valid, otherwise `null`.

**Example:**

```js
import { parseIdentity } from '@btps/sdk';
const parsed = parseIdentity('billing$company.com');
// parsed = { accountName: 'billing', domainName: 'company.com' }
```

---

### isValidIdentity

```ts
isValidIdentity(identity?: string): boolean
```

**Description:**
Checks if a string is a valid BTPS identity (must be in the format `account$domain`).

**Arguments:**

- `identity` (`string`, optional): The identity string to validate.

**Returns:**

- `boolean`: `true` if valid, `false` otherwise.

**Example:**

```js
import { isValidIdentity } from '@btps/sdk';
isValidIdentity('billing$company.com'); // true
isValidIdentity('not-an-identity'); // false
```

---

### pemToBase64

```ts
pemToBase64(pem: string): string
```

**Description:**
Converts a PEM-encoded public key to a base64 string (removes header/footer and newlines).

**Arguments:**

- `pem` (`string`, required): The PEM-formatted public key.

**Returns:**

- `string`: The base64-encoded key.

**Example:**

```js
import { pemToBase64 } from '@btps/sdk';
const base64 = pemToBase64(pemString);
```

---

### base64ToPem

```ts
base64ToPem(base64: string): string
```

**Description:**
Converts a base64-encoded public key to PEM format (adds header/footer and line breaks).

**Arguments:**

- `base64` (`string`, required): The base64-encoded key.

**Returns:**

- `string`: The PEM-formatted public key.

**Example:**

```js
import { base64ToPem } from '@btps/sdk';
const pem = base64ToPem(base64String);
```

---

### getHostAndSelector

```ts
getHostAndSelector(identity: string): Promise<{ host: string; selector: string; version: string; operator?: string } | undefined>
```

**Description:**
Resolves the BTPS host, selector and operator for a given identity by querying the `_btps.host.<domain>` DNS TXT record. The selector supports key rotation, allowing multiple public keys to be published under different selectors. The operator (`op`) is the identity that may delegate, attest and answer identity lookups for the domain ([The Domain Operator](../protocol/specifications/overview.md#the-domain-operator)).

**Arguments:**

- `identity` (`string`, required): The BTPS identity to resolve.

**Returns:**

- `Promise<{ host: string; selector: string; version: string; operator?: string } | undefined>`: Object containing the host URL, current selector, version and, when the record declares a valid one, the operator. `undefined` if there is no record: a name DNS does not have is no record, not an error.

**Example:**

```js
import { getHostAndSelector } from '@btps/sdk';
const result = await getHostAndSelector('billing$company.com');
// result = { host: 'btps://btps.company.com:3443', selector: 'btps1', version: '1.2.0', operator: 'admin$company.com' }
```

---

### getDnsIdentityParts

```ts
getDnsIdentityParts(
  identity: string,
  selector: string,
  type?: 'key' | 'pem' | 'version'
): Promise<{ key: string; version: string; pem: string } | string | undefined>
```

**Description:**
Resolves DNS TXT records for a specific selector of a BTPS identity and extracts key, version, or PEM information. This function supports key rotation by allowing resolution of public keys for specific selectors.

**Arguments:**

- `identity` (`string`, required): The BTPS identity to resolve.
- `selector` (`string`, required): The selector to use for DNS resolution (e.g., 'btps1', 'btps2').
- `type` (`'key' | 'pem' | 'version'`, optional): The specific part to extract. If omitted, returns all parts.

**Returns:**

- `Promise<{ key: string; version: string; pem: string } | string | undefined>`: The requested DNS part, or an object with all parts if `type` is omitted.

**Example:**

```js
import { getDnsIdentityParts } from '@btps/sdk';
const allParts = await getDnsIdentityParts('billing$company.com', 'btps1');
// Returns: { key: 'rsa', version: '1.2.0', pem: '-----BEGIN PUBLIC KEY-----...' }

const justPem = await getDnsIdentityParts('billing$company.com', 'btps1', 'pem');
// Returns: '-----BEGIN PUBLIC KEY-----...'

const justKey = await getDnsIdentityParts('billing$company.com', 'btps1', 'key');
// Returns: 'abc123'
```

---

### getBtpAddressParts

```ts
getBtpAddressParts(input: string): URL | null
```

**Description:**
Parses a BTPS address string (e.g., `btps://server.example.com:3443`) into a URL object.

**Arguments:**

- `input` (`string`, required): The BTPS address string.

**Returns:**

- `URL` object if valid, otherwise `null`.

**Example:**

```js
import { getBtpAddressParts } from '@btps/sdk';
const url = getBtpAddressParts('btps://server.example.com:3443');
// url.hostname === 'server.example.com'
```

---

### resolvePublicKey

```ts
resolvePublicKey(identity: string, selector: string): Promise<string | undefined>
```

**Description:**
Resolves the public key PEM for a BTPS identity using DNS with a specific selector. This function supports key rotation by allowing resolution of public keys for different selectors.

**Arguments:**

- `identity` (`string`, required): The BTPS identity to resolve.
- `selector` (`string`, required): The selector to use for DNS resolution (e.g., 'btps1', 'btps2').

**Returns:**

- `Promise<string | undefined>`: The PEM-formatted public key, or `undefined` if not found.

**Example:**

```js
import { resolvePublicKey } from '@btps/sdk';
const pubKey = await resolvePublicKey('billing$company.com', 'btps1');
```

---

### isBtpsTransportArtifact

```ts
isBtpsTransportArtifact(artifact: unknown): artifact is BTPTransporterArtifact
```

**Description:**
Type guard function that checks if an object is a valid BTPS transport artifact.

**Arguments:**

- `artifact` (`unknown`, required): The object to check.

**Returns:**

- `boolean`: `true` if the object is a valid BTPS transport artifact.

**Example:**

```js
import { isBtpsTransportArtifact } from '@btps/sdk';
if (isBtpsTransportArtifact(data)) {
  // data is now typed as BTPTransporterArtifact
  console.log(data.from, data.type);
}
```

---

### isBtpsAgentArtifact

```ts
isBtpsAgentArtifact(artifact: unknown): artifact is BTPAgentArtifact
```

**Description:**
Type guard function that checks if an object is a valid BTPS agent artifact.

**Arguments:**

- `artifact` (`unknown`, required): The object to check.

**Returns:**

- `boolean`: `true` if the object is a valid BTPS agent artifact.

**Example:**

```js
import { isBtpsAgentArtifact } from '@btps/sdk';
if (isBtpsAgentArtifact(data)) {
  // data is now typed as BTPAgentArtifact
  console.log(data.agentId, data.action);
}
```

---

### isBtpsControlArtifact

```ts
isBtpsControlArtifact(artifact: unknown): artifact is BTPControlArtifact
```

**Description:**
Type guard function that checks if an object is a valid BTPS control artifact.

**Arguments:**

- `artifact` (`unknown`, required): The object to check.

**Returns:**

- `boolean`: `true` if the object is a valid BTPS control artifact.

**Example:**

```js
import { isBtpsControlArtifact } from '@btps/sdk';
if (isBtpsControlArtifact(data)) {
  // data is now typed as BTPControlArtifact
  console.log(data.action);
}
```

---

### isBtpsIdentityRequest

```ts
isBtpsIdentityRequest(artifact: unknown): artifact is BTPIdentityLookupRequest
```

**Description:**
Type guard function that checks if an object is a valid BTPS identity lookup request.

**Arguments:**

- `artifact` (`unknown`, required): The object to check.

**Returns:**

- `boolean`: `true` if the object is a valid BTPS identity lookup request.

**Example:**

```js
import { isBtpsIdentityRequest } from '@btps/sdk';
if (isBtpsIdentityRequest(data)) {
  // data is now typed as BTPIdentityLookupRequest
  console.log(data.identity, data.hostSelector);
}
```

---

### computeId

```ts
computeId(identity: string): string
```

**Description:**
Computes a globally unique, deterministic ID for a given identity using SHA-256. This ID is collision-resistant and suitable for billions of records.

**Arguments:**

- `identity` (`string`, required): The identity to compute ID for.

**Returns:**

- `string`: 64-character hexadecimal SHA-256 hash of the identity.

**Example:**

```js
import { computeId } from '@btps/sdk';
const id = computeId('billing$company.com');
// Returns: "a1b2c3d4e5f6..."
```

---

### isDelegationAllowed

```ts
isDelegationAllowed(artifact: BTPTransporterArtifact, operator?: string): boolean
```

**Description:**
Checks whether an artifact's delegator may delegate for its sender: the delegator is the sender itself (`delegation.signedBy === from`), or the operator of the sender's domain. Being on the same domain is not enough. Without an operator, only the sender itself may delegate.

**Arguments:**

- `artifact` (`BTPTransporterArtifact`, required): The artifact to check.
- `operator` (`string`, optional): The operator of the sender's domain, as `getHostAndSelector(artifact.from)` returns it.

**Returns:**

- `boolean`: `true` if delegation is allowed, `false` otherwise.

**Example:**

```js
import { getHostAndSelector, isDelegationAllowed } from '@btps/sdk';
const { operator } = (await getHostAndSelector(artifact.from)) ?? {};
const canDelegate = isDelegationAllowed(artifact, operator);
```

---

## Cryptography (`@btps/sdk/crypto`)

### signEncrypt

```ts
signEncrypt<T>(
  to: string | undefined,
  sender: ParsedIdentity & ({ pemFiles: PemKeys } | { signer: Signer }),
  payload: {
    document: T;
    selector?: string;
    [key: string]: unknown;
  },
  options?: BTPCryptoOptions,
  lookup?: ReceiverKeyLookup
): Promise<BTPCryptoResponse<T>>
```

**Description:**
Signs and (optionally) encrypts a BTPS document for secure transmission. Handles key lookup, encryption, and signature in one step. With encryption, the document is checked against its type's schema first, since no server can read it once encrypted. `id` and `issuedAt` are filled in when left out. Since 1.2, that check is exported as [checkDocumentToSend](#checkdecrypteddocument--checkdocumenttosend), for a platform that encrypts a piece at a time.

`signEncrypt` signs the `version` it is given; it never stamps one, except that a trust request it shapes for a 1.1 receiver goes as `1.1.0`. Stamp the payload with `artifactVersion` (`@btps/sdk/server`): `1.1.0` unless it uses something 1.2 adds, then `1.2.0`. Since 1.2, a payload with `documentType` whose document is another type is refused with `BTP_ERROR_DOCUMENT_TYPE_MISMATCH` before anything is encrypted.

Since 1.2, a `TRUST_REQ` payload carrying `permissions` is composed for its receiver's version: one `PING` asks the receiver's server, and to a 1.1 server it is sent as 1.1 allows, reported in the result's `shaped`, or refused with `options.versionFallback: false`. If the receiver's server cannot be asked, that error is returned. A payload without permissions is never asked about. See [To a receiver whose server speaks 1.1](../protocol/specifications/transporter-artifact.md#trust-permissions).

**Arguments:**

- `to` (`string | undefined`, required): Recipient BTPS identity. If undefined, no encryption is performed.
- `sender` (`ParsedIdentity & ({ pemFiles: PemKeys } | { signer: Signer })`, required): Sender identity, with its PEM key pair or a [Signer](./typesAndInterfaces.md#signer) holding its key elsewhere.
- `payload` (object, required): Document and metadata to send.
  - `document` (`T`, required): The document payload.
  - `selector` (`string`, optional): The sender's own selector, the one its signing key is published at (e.g., 'btps2' after a rotation). The receiver uses it to find the key that verifies the signature. The receiver's key for encryption is found at the selector the receiver's own host record names: in DNS first, then, when DNS has none, from the receiver's host, in an answer its domain's operator signed.
  - `[key: string]` (`unknown`): Additional metadata fields.
- `options` (`BTPCryptoOptions`, optional): Signature and encryption options. Since 1.2, `maxAttachments` ([BTPAttachmentLimits](./typesAndInterfaces.md#btpattachmentlimits-and-btpattachingdocumenttype)): how many attachments a document this sender encrypts may carry, one number or one for each type, 0 to 1000; 20 of each when not given. A document past it is not encrypted: `BTP_ERROR_VALIDATION`. Sending more than 20 risks a refusal by a receiver that takes only the 20 every receiver takes ([Attachments](../protocol/specifications/limits.md#attachments)).
- `lookup` (`ReceiverKeyLookup`, optional): `{ btpMtsOptions, keyResolver }`. `btpMtsOptions` is the TLS options for the connection to the receiver's host, used only when DNS has no key. Since 1.2, `keyResolver` ([BtpsKeyResolver](./typesAndInterfaces.md#btpskeyresolver)) is asked for the receiver's key (`encrypt`) in place of DNS, and the host is still asked when it has none.

**Returns:**

- `Promise<BTPCryptoResponse<T>>`: Signed (and encrypted) artifact and error (if any).

**Example:**

```js
import { signEncrypt } from '@btps/sdk/crypto';
import { artifactVersion } from '@btps/sdk/server';
const { payload, error } = await signEncrypt(
  'pay$client.com',
  { accountName: 'billing', domainName: 'vendorcorp.com', pemFiles: { publicKey, privateKey } },
  {
    version: artifactVersion({ type: 'BTPS_DOC', document: invoice }),
    type: 'BTPS_DOC',
    from: 'billing$vendorcorp.com',
    to: 'pay$client.com',
    selector: 'btps1', // the selector your own key is published under
    document: invoice,
  },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
```

---

### decryptVerify

```ts
decryptVerify<T>(
  senderPubPem: string,
  encryptedPayload: VerifyEncryptedPayload<T>,
  receiverKey?: BTPDecryptionKey,
  contentKey?: string,
  cosignatureKeys?: (string | null)[],
  options?: Pick<BTPDocumentCheckOptions, 'maxAttachments'> // since 1.2
): Promise<BTPCryptoResponse<T>>
```

**Description:**
Verifies the signature and (optionally) decrypts a received BTPS artifact. Ensures authenticity and privacy.

It checks an opened document against its type's schema under the artifact's version. Since 1.2 it also checks that the document is the `documentType` its envelope names (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`), an opened trust request's or answer's values against the names on its envelope, and a details response's values; and it returns `boundView`, whether an opened document's BoundView may be shown, when it carries one. Since 1.2, the checks it runs once it has decrypted are exported as [checkDecryptedDocument](#checkdecrypteddocument--checkdocumenttosend), for a platform that decrypts a piece at a time.

When it decrypts a `BTPS_EVENT`, it also checks the event as the server checks an unencrypted one: a valid lifecycle event, carried under its own `id`, about an invoice between the artifact's `from` and `to`. If not, it returns a `BTP_ERROR_VALIDATION` error and no payload.

Since 1.2, when the artifact carries `cosignatures`, it holds each to the document the opened event is about, opens each one the receiver (the artifact's `to`) is a recipient of (`openCosignature`), and returns their statements in `cosigned`, by position: the statement, or `null` where the receiver is not a recipient. A cosignature that names another document, or one for the receiver that does not open or is not exactly what was signed, is a `BTP_ERROR_SIG_VERIFICATION` error, with no payload. A statement addressed to the receiver is never skipped: without `receiverKey` (left out, or `''`), an artifact with a cosignature for the receiver is refused the same way ("a cosignature for you is opened with your key: give receiverKey"). With no cosignature for the receiver, no key is needed. It does not check the cosignatures' signatures: the receiving server did, on receipt. See [Cosignatures](../protocol/specifications/transporter-artifact.md#cosignatures).

**Arguments:**

- `senderPubPem` (`string`, required): Sender's public key (PEM).
- `encryptedPayload` (`VerifyEncryptedPayload<T>`, required): The received artifact.
- `receiverKey` (`string | Decrypter`, optional): Receiver's private key (PEM) for decryption, or a [Decrypter](./typesAndInterfaces.md#decrypter) holding it elsewhere.
- `contentKey` (`string`, optional, since 1.2): the document's content key wrapped to `receiverKey`, in place of the envelope's `encryptedKey`: a device's `agentKey.key`. The signature is still checked over the artifact as sent. `BtpsAgent.openResult` passes it.
- `cosignatureKeys` (`(string | null)[]`, optional, since 1.2): each cosignature's content key wrapped to `receiverKey`, by position, in place of the recipient's own `wrappedKey`: a device's `agentKey.cosignatureKeys`. There must be one for each cosignature, and a cosignature addressed to the receiver with `null` is refused (`BTP_ERROR_SIG_VERIFICATION`). `BtpsAgent.openResult` passes it.
- `options` (`{ maxAttachments?: BTPAttachmentLimits }`, optional, since 1.2, the 6th argument): `maxAttachments` is how many attachments this provider takes in a document it opens, one number or one for each type, 20 to 1000 ([BTPAttachmentLimits](./typesAndInterfaces.md#btpattachmentlimits-and-btpattachingdocumenttype)). Without it, 20 of each. An opened document past it returns `BTP_ERROR_VALIDATION`, for example `a letter may carry at most 20 attachments here; it carries 21`. Give it the same number as your server's `maxAttachments`: the server cannot count an encrypted document's attachments, so they are counted here ([Attachments](../protocol/specifications/limits.md#attachments)).

**Returns:**

- `Promise<BTPCryptoResponse<T>>`: Decrypted and verified artifact and error (if any); since 1.2, `boundView`, and since 1.2, `cosigned`.

**Example:**

```js
import { decryptVerify } from '@btps/sdk/crypto';
const { payload, error } = await decryptVerify(
  senderPublicKeyPem,
  encryptedPayload,
  receiverPrivateKeyPem,
);
```

---

### checkDecryptedDocument / checkDocumentToSend

```ts
checkDecryptedDocument(
  document: unknown,
  envelope: BTPDocumentEnvelope,
  options?: BTPDocumentCheckOptions
): Promise<BTPErrorException | undefined>

checkDocumentToSend(
  document: unknown,
  envelope: BTPDocumentEnvelope,
  options?: BTPDocumentCheckOptions
): BTPErrorException | undefined
```

**Description:**
Since 1.2. The checks `decryptVerify` and `signEncrypt` run on an encrypted artifact's document, exported for a platform that decrypts or encrypts a piece at a time. `decryptVerify` and `signEncrypt` call these same functions, so the rules never differ. Each returns `undefined` when the document passes, otherwise the error `decryptVerify` or `signEncrypt` answers with.

| Function                 | Runs what                                                                                                                                                                                                                                                     | When                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `checkDecryptedDocument` | `decryptVerify`'s checks: the type's schema and the rules between the document and its envelope (`BTP_ERROR_VALIDATION`), the type `envelope.documentType` names (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`), and, for a trust request, that its verifier may verify | after decrypting (async) |
| `checkDocumentToSend`    | `signEncrypt`'s checks: the type `envelope.documentType` names (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`), then the type's schema (`BTP_ERROR_VALIDATION`)                                                                                                          | before encrypting        |

A document with its files held apart, each attachment's `content` empty (`''`) with its `size` and `sha256` as sent, is checked as it is: the schema checks nothing of an attachment's content. So a platform that writes each file somewhere private as it decrypts checks the rest of the document without reading the files back.

With `{ boundView: 'whereDrawn' }`, the document's BoundView is not checked here. Use it only when the BoundView is drawn with `@btps/boundview`'s `renderBoundView`, which checks it before it draws and draws none that fails. Otherwise leave the option out, and the BoundView is checked here.

With `{ maxAttachments }` ([BTPAttachmentLimits](./typesAndInterfaces.md#btpattachmentlimits-and-btpattachingdocumenttype)), a `BTPS_DOC` document is held to that many attachments: what this provider takes, 20 to 1000, for `checkDecryptedDocument`, and what it sends, 0 to 1000, for `checkDocumentToSend`. Give each the number you give `decryptVerify` and `signEncrypt`. Left out, 20 of each. Past it: `BTP_ERROR_VALIDATION` ([Attachments](../protocol/specifications/limits.md#attachments)).

See [Opening a large artifact, start to finish](../protocol/security/decryption.md#opening-a-large-artifact-start-to-finish).

**Arguments:**

- `document` (`unknown`, required): The opened document, or the document to send. Its files may be held apart, as above.
- `envelope` (`BTPDocumentEnvelope`, required): The artifact without its `document`: at least its `type`, `version` and, when it has one, `documentType`. For `checkDecryptedDocument`, the whole envelope as it arrived, since some rules compare the document with other fields (`id`, `from`, `to`, `given`, `granted`, `details`). See [BTPDocumentEnvelope](./typesAndInterfaces.md#btpdocumentcheckoptions-and-btpdocumentenvelope).
- `options` (`BTPDocumentCheckOptions`, optional): `{ boundView: 'whereDrawn' }` and, since 1.2, `{ maxAttachments }`, as above.

**Returns:**

- `checkDecryptedDocument`: `Promise<BTPErrorException | undefined>`.
- `checkDocumentToSend`: `BTPErrorException | undefined`.

**Example:**

```ts check
import { checkDecryptedDocument, type BTPDocumentEnvelope } from '@btps/sdk/crypto';

export async function checkOpened(
  document: unknown, // decrypted a piece at a time, its files held apart
  envelope: BTPDocumentEnvelope, // the artifact as it arrived, without its document
): Promise<void> {
  const problem = await checkDecryptedDocument(document, envelope);
  if (problem) throw problem; // what decryptVerify would answer with
}
```

---

### generateKeys

```ts
generateKeys(accountName: string): Promise<void>
```

**Description:**
Generates a new public/private key pair and writes them to disk for a given account.

**Arguments:**

- `accountName` (`string`, required): Account name for key file output.

**Returns:**

- `Promise<void>`

**Example:**

```js
import { generateKeys } from '@btps/sdk/crypto';
await generateKeys('billing');
// Creates keys/billing/billing-private.pem and keys/billing/billing-public.pem
```

---

### getBTPKeyPair

```ts
getBTPKeyPair(keyConfig?: BTPKeyConfig): BTPKeyPair
```

**Description:**
Generates a new public/private key pair in memory with optional configuration.

**Arguments:**

- `keyConfig` (`BTPKeyConfig`, optional): Key generation configuration.

**Returns:**

- `BTPKeyPair`: Object containing public key, private key, and fingerprint.

**Example:**

```js
import { getBTPKeyPair } from '@btps/sdk/crypto';
const { publicKey, privateKey, fingerprint } = getBTPKeyPair({
  keySize: 2048,
  format: 'pem',
});
```

---

### encryptBtpPayload

```ts
encryptBtpPayload(
  payload: unknown = '',
  receiverPubPem: string,
  options?: BTPCryptoOptions['encryption'],
  documentType?: BTPArtifactType
): { data: string; encryption: BTPEncryption }
```

**Description:**
Encrypts a payload using AES-256-GCM and the recipient's public key. Returns the encrypted data and encryption metadata.

**Arguments:**

- `payload` (`unknown`, required): The data to encrypt (defaults to empty string).
- `receiverPubPem` (`string`, required): Recipient's public key (PEM).
- `options` (`BTPCryptoOptions['encryption']`, optional): Encryption algorithm and mode.
- `documentType` (`BTPArtifactType`, optional, since 1.1.3): The artifact type the document travels as, for example `'BTPS_DOC'`. Given one, the document is checked against that type first, [limits](../protocol/specifications/limits.md) included, and an invalid one throws `BTP_ERROR_VALIDATION`. Without one, nothing is checked, and a direct caller checks the document itself; `signEncrypt` and the clients always check.

**Returns:**

- `object`: `{ data, encryption }` with encrypted payload and metadata.

**Example:**

```js
import { encryptBtpPayload } from '@btps/sdk/crypto';
const encrypted = encryptBtpPayload({ foo: 'bar' }, receiverPublicKeyPem, {
  algorithm: 'aes-256-gcm',
  mode: 'standardEncrypt',
});
```

---

### decryptBtpPayload

```ts
decryptBtpPayload<T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  receiverPrivPem: string,
  documentType?: BTPArtifactType
): { data?: T; error?: BTPErrorException }
```

**Description:**
Decrypts an AES-256-GCM encrypted payload using the receiver's private key and the provided encryption metadata. The plaintext must be strict JSON (`assertStrictJson`), or `BTP_ERROR_CANONICAL_JSON` is returned. Since 1.2, it checks that with a tokenizer first, which builds nothing, and asks `assertStrictJson` only of text the tokenizer refuses: the same results and errors, in less time. `decryptBtpPayloadWithDecrypter` does the same.

**Arguments:**

- `payload` (`unknown`, required): The encrypted data to decrypt (base64 string or object, defaults to empty string).
- `encryption` (`BTPEncryption`, required): Encryption metadata (algorithm, key, iv, type).
- `receiverPrivPem` (`string`, required): Receiver's private key (PEM).
- `documentType` (`BTPArtifactType`, optional, since 1.1.3): The artifact type the document travelled as. Given one, the decrypted document is checked against that type, [limits](../protocol/specifications/limits.md) included, and an invalid one is returned as a `BTP_ERROR_VALIDATION` error. Without one, nothing is checked, and a direct caller checks the document itself; `decryptVerify` always checks.

**Returns:**

- `object`: `{ data, error }` with decrypted payload (if successful) and error (if any).

**Example:**

```js
import { decryptBtpPayload } from '@btps/sdk/crypto';
const { data, error } = decryptBtpPayload(encryptedData, encryptionMeta, receiverPrivateKeyPem);
```

---

### decryptBtpPayloadWithDecrypter

```ts
decryptBtpPayloadWithDecrypter<T = unknown>(
  payload: unknown = '',
  encryption: BTPEncryption,
  decrypter: Decrypter,
  documentType?: BTPArtifactType
): Promise<{ data?: T; error?: BTPErrorException }>
```

**Description:**
Decrypts like `decryptBtpPayload`, through a [Decrypter](./typesAndInterfaces.md#decrypter) that holds the receiver's private key elsewhere (a KMS, a device) instead of a PEM key, and checks the document against `documentType` the same way when given one. A failure inside the Decrypter is returned as the error. See [Keys Held Elsewhere](../protocol/security/keyManagement.md#keys-held-elsewhere-signer-and-decrypter).

**Example:**

```js
import { decryptBtpPayloadWithDecrypter } from '@btps/sdk/crypto';
const { data, error } = await decryptBtpPayloadWithDecrypter(
  encryptedData,
  encryptionMeta,
  decrypter,
);
```

---

### decryptBtpPayloadStream

```ts
decryptBtpPayloadStream(
  payload: BTPPayloadPieces<string>,
  encryption: BTPEncryption,
  receiverPrivPem: string,
  options?: BTPDecryptStreamOptions
): AsyncGenerator<Uint8Array>
```

**Description:**
Since 1.2. Decrypts like `decryptBtpPayload`, a piece at a time, so a large payload is never held whole. It reads the artifact's base64 payload in pieces of any length and yields the plaintext bytes in pieces. It reads the same artifacts `decryptBtpPayload` reads: nothing on the wire changes. See [Large payloads, a piece at a time](../protocol/security/decryption.md#large-payloads-a-piece-at-a-time).

AES-GCM proves a payload only at its end. **A piece is not trusted until the loop finishes without throwing**: do not send, show, store as final or act on any piece before then. Finishing proves only that the AES-GCM tag checked out, not the artifact's signature, its sender or a trust: check those as before, with `decryptVerify` or `verifySignature`.

It does not parse the plaintext and checks no document type: the caller parses and checks it, with [checkDecryptedDocument](#checkdecrypteddocument--checkdocumenttosend) for the checks `decryptVerify` runs. `decryptBtpPayload` also refuses text that is not strict JSON. With `{ strictJson: true }`, this holds the plaintext to the same strict JSON as it is read ([Holding the plaintext to strict JSON](../protocol/security/decryption.md#holding-the-plaintext-to-strict-json)).

**Arguments:**

- `payload` (`BTPPayloadPieces<string>`, required): The artifact's base64 `document`, in pieces of any length, from an `AsyncIterable` or an `Iterable` ([BTPPayloadPieces](./typesAndInterfaces.md#btppayloadpieces)). Characters that are not base64 are passed over, as `decryptBtpPayload` passes them over.
- `encryption` (`BTPEncryption`, required): The artifact's `encryption`.
- `receiverPrivPem` (`string`, required): Receiver's private key (PEM).
- `options` (`BTPDecryptStreamOptions`, optional, since 1.2): `{ strictJson: true }` holds the plaintext to the strict JSON `decryptBtpPayload` holds it to: JSON, with no member named twice in any object. It is stricter in two ways: a raw control character inside a string is refused, and objects and arrays nested more than 1024 deep are refused. See [BTPDecryptStreamOptions](./typesAndInterfaces.md#btpdecryptstreamoptions).

**Returns:**

- `AsyncGenerator<Uint8Array>`: The plaintext, a piece at a time. There is no separate result or promise: the generator ends normally when the payload is proven, or throws.

**Throws:**

`BTPErrorException`, out of the loop. Nothing runs until the first piece is asked for.

- At the start: `BTP_ERROR_UNSUPPORTED_ENCRYPT` for an algorithm other than `aes-256-gcm` or an `authTag` that is not 16 bytes; `BTP_ERROR_DECRYPTION_UNINTENDED` for a payload encrypted to another key.
- When the last piece is read: for a payload changed or cut short, or a wrong tag, the same code `decryptBtpPayload` answers with.
- With `{ strictJson: true }`, after the last piece is read and the payload is proven: `BTP_ERROR_CANONICAL_JSON` for plaintext that is not strict JSON. A changed payload throws its decryption error, never this.
- When the source throws: that error, unchanged if it is a `BTPErrorException`, otherwise with its message, and its `name` as the code.

The full table is in [What decrypting does](../protocol/security/decryption.md#what-decrypting-does).

**Example:**

```ts check
import { decryptBtpPayloadStream, type BTPEncryption } from '@btps/sdk/crypto';

export async function openPayload(
  payload: AsyncIterable<string>, // the stored base64 payload, in slices
  encryption: BTPEncryption,
  receiverPrivateKeyPem: string,
): Promise<Buffer> {
  const pieces: Uint8Array[] = []; // private until the loop ends
  for await (const piece of decryptBtpPayloadStream(payload, encryption, receiverPrivateKeyPem, {
    strictJson: true,
  })) {
    pieces.push(piece);
  }
  // The loop ended without throwing: only now may the plaintext be used.
  return Buffer.concat(pieces);
}
```

---

### decryptBtpPayloadStreamWithDecrypter

```ts
decryptBtpPayloadStreamWithDecrypter(
  payload: BTPPayloadPieces<string>,
  encryption: BTPEncryption,
  decrypter: Decrypter,
  options?: BTPDecryptStreamOptions
): AsyncGenerator<Uint8Array>
```

**Description:**
Since 1.2. Decrypts like `decryptBtpPayloadStream`, through a [Decrypter](./typesAndInterfaces.md#decrypter) that holds the receiver's private key elsewhere (a KMS, an HSM, a device). A `Decrypter`'s `decrypt` takes a payload whole, so this asks the key holder only to unwrap the content key (`unwrapKey`), and does the AES-GCM step locally. `PemDecrypter` has `unwrapKey`. The same rule applies: a piece is not trusted until the loop finishes without throwing.

**Arguments:**

- `payload` (`BTPPayloadPieces<string>`, required): The artifact's base64 `document`, in pieces of any length.
- `encryption` (`BTPEncryption`, required): The artifact's `encryption`.
- `decrypter` (`Decrypter`, required): A `Decrypter` with `unwrapKey`.
- `options` (`BTPDecryptStreamOptions`, optional, since 1.2): `{ strictJson: true }`, as for `decryptBtpPayloadStream`.

**Returns:**

- `AsyncGenerator<Uint8Array>`: The plaintext, a piece at a time, as `decryptBtpPayloadStream` gives it.

**Throws:**

- `BTP_ERROR_UNSUPPORTED_ENCRYPT`, at the start, for a `Decrypter` without `unwrapKey`.
- Otherwise what `decryptBtpPayloadStream` throws. A failure inside `unwrapKey` comes out of the loop at the start.

**Example:**

```ts check
import {
  decryptBtpPayloadStreamWithDecrypter,
  type BTPEncryption,
  type Decrypter,
} from '@btps/sdk/crypto';

export async function openPayloadWithDecrypter(
  payload: AsyncIterable<string>,
  encryption: BTPEncryption,
  decrypter: Decrypter, // must have unwrapKey
): Promise<Buffer> {
  const pieces: Uint8Array[] = [];
  for await (const piece of decryptBtpPayloadStreamWithDecrypter(payload, encryption, decrypter)) {
    pieces.push(piece);
  }
  return Buffer.concat(pieces);
}
```

---

### encryptBtpPayloadStream

```ts
encryptBtpPayloadStream(
  document: BTPPayloadPieces<string | Uint8Array>,
  receiverPubPem: string,
  options?: BTPCryptoOptions['encryption']
): { payload: AsyncGenerator<string>; encryption: Promise<BTPEncryption> }
```

**Description:**
Since 1.2. Encrypts like `encryptBtpPayload`, a piece at a time, so a large document is never held whole. It writes the same artifacts `encryptBtpPayload` writes: nothing on the wire changes, and a receiver cannot tell which one wrote a payload. See [Encrypting a large document](../protocol/security/decryption.md#encrypting-a-large-document).

Read `payload` to its end, writing each piece as it comes, and only then `await encryption`. `encryption` settles only once `payload` has been read to its end, because the tag is known only then. Awaiting `encryption` first waits forever.

Given the same content key and IV, the joined pieces and the tag are exactly the payload and tag `encryptBtpPayload` writes. In normal use the key, the IV and the RSA-OAEP wrap are random, so two calls never give the same output; what matters is that either function's output opens with either decrypt function.

No document type is checked, because the whole document is never held here: check the document before you encrypt it, with [checkDocumentToSend](#checkdecrypteddocument--checkdocumenttosend), the check `signEncrypt` runs. Sign the artifact once `encryption` has settled, with [signBtpPayloadStream](#signbtppayloadstream) over the stored payload.

**Arguments:**

- `document` (`BTPPayloadPieces<string | Uint8Array>`, required): The document's JSON text, as `JSON.stringify` writes it, in pieces of text or bytes. A character split between two text pieces is kept whole.
- `receiverPubPem` (`string`, required): Recipient's public key (PEM), at least 2048 bits.
- `options` (`BTPCryptoOptions['encryption']`, optional): Encryption algorithm and mode. Defaults to `{ algorithm: 'aes-256-gcm', mode: 'standardEncrypt' }`.

**Returns:**

- `payload` (`AsyncGenerator<string>`): The base64 payload, a piece at a time, to write as it comes. Joined, the pieces are the artifact's `document`.
- `encryption` (`Promise<BTPEncryption>`): The artifact's `encryption`, settled once `payload` has been read to its end. If `payload` is never read, it never settles.

**Throws:**

Nothing runs until the first piece of `payload` is asked for. A failure then comes out of the loop over `payload` as a `BTPErrorException`, and `encryption` rejects with the same error:

- `BTP_ERROR_UNSUPPORTED_ENCRYPT` for a receiver key under 2048 bits.
- Any other failure, including one the source throws, unchanged if it is a `BTPErrorException`, otherwise with its message, and its `name` as the code.

**Example:**

```ts check
import { encryptBtpPayloadStream, type BTPEncryption } from '@btps/sdk/crypto';

export async function sealDocument(
  documentJson: AsyncIterable<string | Uint8Array>, // JSON.stringify of the document, in pieces
  receiverPublicKeyPem: string,
  write: (piece: string) => Promise<void>,
): Promise<BTPEncryption> {
  const { payload, encryption } = encryptBtpPayloadStream(documentJson, receiverPublicKeyPem, {
    algorithm: 'aes-256-gcm',
    mode: 'standardEncrypt',
  });
  for await (const piece of payload) await write(piece); // 1. read payload to its end
  return await encryption; // 2. only then: it is settled now
}
```

---

### encryptRSA

```ts
encryptRSA(publicKeyPem: string, data: Buffer): Buffer
```

**Description:**
Encrypts a buffer using the recipient's RSA public key (OAEP, SHA-256).

**Arguments:**

- `publicKeyPem` (`string`, required): Recipient's public key (PEM).
- `data` (`Buffer`, required): Data to encrypt.

**Returns:**

- `Buffer`: The RSA-encrypted data.

**Example:**

```js
import { encryptRSA } from '@btps/sdk/crypto';
const encrypted = encryptRSA(publicKeyPem, Buffer.from('secret data'));
```

---

### decryptRSA

```ts
decryptRSA(privateKeyPem: string, encrypted: Buffer): Buffer
```

**Description:**
Decrypts an RSA-encrypted buffer using the receiver's private key (OAEP, SHA-256).

**Arguments:**

- `privateKeyPem` (`string`, required): Receiver's private key (PEM).
- `encrypted` (`Buffer`, required): Encrypted data buffer.

**Returns:**

- `Buffer`: The decrypted data.

**Example:**

```js
import { decryptRSA } from '@btps/sdk/crypto';
const decrypted = decryptRSA(privateKeyPem, encryptedBuffer);
```

---

### getFingerprintFromPem

```ts
getFingerprintFromPem(
  pem: string,
  hashAlgorithm?: string
): string
```

**Description:**
Computes a fingerprint (hash) of a PEM public key using the specified algorithm (default: `sha256`).

**Arguments:**

- `pem` (`string`, required): The PEM-formatted public key.
- `hashAlgorithm` (`string`, optional, default: `'sha256'`): Hash algorithm.

**Returns:**

- `string`: The base64-encoded fingerprint.

**Example:**

```js
import { getFingerprintFromPem } from '@btps/sdk/crypto';
const fingerprint = getFingerprintFromPem(publicKeyPem);
```

---

### signBtpPayload

```ts
signBtpPayload(payload: unknown = '', senderPemFiles: PemKeys): BTPSignature
```

**Description:**
Signs a payload using the sender's private key and returns a signature object (algorithmHash, value, fingerprint). Since 1.2, a payload whose `document` is text, as an encrypted artifact's is, is hashed a piece at a time instead of through a whole copy of its canonical form: the same signature, with less memory. To sign a document that is never held whole, see [signBtpPayloadStream](#signbtppayloadstream).

**Arguments:**

- `payload` (`unknown`, required): The data to sign (object or string, defaults to empty string).
- `senderPemFiles` (`PemKeys`, required): Sender's PEM key pair.

**Returns:**

- `BTPSignature`: Signature object with algorithmHash, value, and fingerprint.

**Example:**

```js
import { signBtpPayload } from '@btps/sdk/crypto';
const signature = signBtpPayload({ foo: 'bar' }, { publicKey, privateKey });
```

---

### signBtpPayloadWithSigner

```ts
signBtpPayloadWithSigner(payload: unknown = '', signer: Signer): Promise<BTPSignature>
```

**Description:**
Signs like `signBtpPayload`, through a [Signer](./typesAndInterfaces.md#signer) that holds the sender's private key elsewhere (a KMS, a device) instead of a PEM key pair. With the same key, the signature is identical to `signBtpPayload`'s. See [Keys Held Elsewhere](../protocol/security/keyManagement.md#keys-held-elsewhere-signer-and-decrypter).

**Example:**

```js
import { signBtpPayloadWithSigner } from '@btps/sdk/crypto';
const signature = await signBtpPayloadWithSigner({ foo: 'bar' }, signer);
```

---

### signBtpPayloadStream

```ts
signBtpPayloadStream(
  artifact: Record<string, unknown>,
  payload: BTPPayloadPieces<string>,
  senderPemFiles: PemKeys
): Promise<BTPSignature>
```

**Description:**
Since 1.2. Signs like `signBtpPayload`, a piece at a time, so a large document is never held whole. The signature bytes are exactly those `signBtpPayload({ ...artifact, document }, senderPemFiles)` gives, where `document` is the text the pieces join to. Nothing about the artifact or the wire changes: a signature made either way verifies with `verifySignature` and with `verifySignatureStream`. See [Signing and verifying a piece at a time](../protocol/security/decryption.md#signing-and-verifying-a-piece-at-a-time).

For an encrypted artifact, `encryption` is part of what is signed, so sign once `encryptBtpPayloadStream`'s `encryption` has settled, reading the stored payload again.

**Arguments:**

- `artifact` (`Record<string, unknown>`, required): The artifact to sign, without its `document` (and without `signature`, as for `signBtpPayload`).
- `payload` (`BTPPayloadPieces<string>`, required): The document's text in pieces of any length: for an encrypted artifact, its base64 payload, as `encryptBtpPayloadStream` gives it.
- `senderPemFiles` (`PemKeys`, required): Sender's PEM key pair.

**Returns:**

- `Promise<BTPSignature>`: Signature object with algorithmHash, value, and fingerprint.

**Throws:**

What `signBtpPayload` throws for the same artifact, and an error the source of pieces throws.

**Example:**

```ts check
import { signBtpPayloadStream, type BTPSignature, type PemKeys } from '@btps/sdk/crypto';

export async function signStored(
  artifact: Record<string, unknown>, // the artifact without its document, its encryption settled
  storedPayload: AsyncIterable<string>, // the stored base64 payload, read from its start
  keys: PemKeys,
): Promise<BTPSignature> {
  return signBtpPayloadStream(artifact, storedPayload, keys);
}
```

---

### signBtpPayloadStreamWithSigner

```ts
signBtpPayloadStreamWithSigner(
  artifact: Record<string, unknown>,
  payload: BTPPayloadPieces<string>,
  signer: Signer
): Promise<BTPSignature>
```

**Description:**
Since 1.2. Signs like `signBtpPayloadStream`, through a [Signer](./typesAndInterfaces.md#signer) that holds the sender's private key elsewhere (a KMS, an HSM, a device). It hashes what is signed a piece at a time and asks the Signer to sign the SHA-256 digest, with its optional `signDigest`. With the same key, the signature is identical to `signBtpPayloadStream`'s and `signBtpPayload`'s. `PemSigner` has `signDigest`.

**Arguments:**

- `artifact` (`Record<string, unknown>`, required): The artifact to sign, without its `document`.
- `payload` (`BTPPayloadPieces<string>`, required): The document's text in pieces of any length.
- `signer` (`Signer`, required): A `Signer` with `signDigest`.

**Returns:**

- `Promise<BTPSignature>`: Signature object with algorithmHash, value, and fingerprint.

**Throws:**

- `BTP_ERROR_UNSUPPORTED_ENCRYPT` for a `Signer` without `signDigest`, before any piece is read.
- Otherwise what `signBtpPayloadStream` throws, and a failure inside the Signer.

**Example:**

```ts check
import { signBtpPayloadStreamWithSigner, type BTPSignature, type Signer } from '@btps/sdk/crypto';

export async function signStoredWithSigner(
  artifact: Record<string, unknown>,
  storedPayload: AsyncIterable<string>,
  signer: Signer, // must have signDigest
): Promise<BTPSignature> {
  return signBtpPayloadStreamWithSigner(artifact, storedPayload, signer);
}
```

---

### syncOfArtifact

```ts
syncOfArtifact(artifact: { id: string }): { id: string; sha256: string }
```

**Description:**
Since 1.2. What a sync names of the send it copies (`syncOf`): the sent artifact's `id`, and the lowercase hex SHA-256 of its RFC 8785 canonical form, signature included. See [Sync](../protocol/specifications/transporter-artifact.md#sync).

**Example:**

```js
import { syncOfArtifact } from '@btps/sdk/crypto';
const syncOf = syncOfArtifact(sentArtifact);
```

---

### trustRequestProblem / trustResponseProblem

```ts
trustRequestProblem(artifact: { given?: string[]; document?: unknown }): string | undefined
trustResponseProblem(artifact: { granted?: string[]; document?: unknown }): string | undefined
```

**Description:**
Since 1.2. Why an opened trust request's or answer's values do not match the names on its envelope, or `undefined` when they do. A request gives each name in `given` a value, in the 1.1 field it has or else in `own`; an answer holds the value of every granted `detail:` name in `details`; each value has its name's shape. `decryptVerify` runs the same check. See [Trust permissions](../protocol/specifications/transporter-artifact.md#the-values-checked-when-opened).

**Example:**

```js
import { trustRequestProblem } from '@btps/sdk/trust';
const problem = trustRequestProblem({ given: artifact.given, document: openedDocument });
```

---

### verifySignature

```ts
verifySignature(
  payload: unknown = '',
  signature: BTPSignature,
  senderPubKey: string
): { isValid: boolean; error?: BTPErrorException }
```

**Description:**
Verifies a payload's signature using the sender's public key and returns validity and error (if any). Since 1.2, a payload whose `document` is text, as an encrypted artifact's is, is hashed a piece at a time instead of through a whole copy of its canonical form: the same answer, with less memory. To check a document that is never held whole, see [verifySignatureStream](#verifysignaturestream).

**Arguments:**

- `payload` (`unknown`, required): The data to verify (object or string, defaults to empty string).
- `signature` (`BTPSignature`, required): Signature object.
- `senderPubKey` (`string`, required): Sender's public key (PEM).

**Returns:**

- `object`: `{ isValid, error }` with signature validity and error (if any).

**Example:**

```js
import { verifySignature } from '@btps/sdk/crypto';
const { isValid, error } = verifySignature({ foo: 'bar' }, signature, senderPublicKeyPem);
```

---

### verifySignatureStream

```ts
verifySignatureStream(
  artifact: Record<string, unknown>,
  payload: BTPPayloadPieces<string>,
  signature: BTPSignature,
  senderPubKey: string
): Promise<{ isValid: boolean; error?: BTPErrorException }>
```

**Description:**
Since 1.2. Checks a signature like `verifySignature`, a piece at a time, so a large document is never held whole. The answer is exactly that of `verifySignature({ ...artifact, document }, signature, senderPubKey)`, where `document` is the text the pieces join to, errors included: `BTP_ERROR_SIG_MISMATCH` when the signature's fingerprint is not the key's, and `BTP_ERROR_SIG_VERIFICATION` when the signature does not verify. It checks a signature made by `signBtpPayload`, `signBtpPayloadWithSigner` or either stream function. See [Signing and verifying a piece at a time](../protocol/security/decryption.md#signing-and-verifying-a-piece-at-a-time).

**Arguments:**

- `artifact` (`Record<string, unknown>`, required): The artifact as it arrived, without its `document`, and without `signature` and `delegation`, as `decryptVerify` gives `verifySignature` the artifact.
- `payload` (`BTPPayloadPieces<string>`, required): The document's text in pieces of any length: for an encrypted artifact, its stored base64 payload.
- `signature` (`BTPSignature`, required): The artifact's `signature`.
- `senderPubKey` (`string`, required): Sender's public key (PEM).

**Returns:**

- `Promise<{ isValid: boolean; error?: BTPErrorException }>`: as `verifySignature` returns. An error the source of pieces throws is returned as `error`, with `isValid: false`, unchanged if it is a `BTPErrorException`, otherwise as `BTP_ERROR_SIG_VERIFICATION` with it as the cause.

**Example:**

```ts check
import { verifySignatureStream, type BTPSignature } from '@btps/sdk/crypto';

export async function signatureHolds(
  artifact: Record<string, unknown>, // as it arrived, without document, signature and delegation
  storedPayload: AsyncIterable<string>,
  signature: BTPSignature,
  senderPublicKeyPem: string,
): Promise<boolean> {
  const { isValid } = await verifySignatureStream(
    artifact,
    storedPayload,
    signature,
    senderPublicKeyPem,
  );
  return isValid;
}
```

---

### generateUserToken

```ts
generateUserToken(
  userIdentity: string,
  length?: number,
  charactersFrom?: string
): string
```

**Description:**
Generate a short, high-entropy, user-specific onboarding token. Suitable for copy-paste flows where the SaaS platform validates the token against a short-lived, user-scoped record.

**Arguments:**

- `userIdentity` (`string`, required): Unique user identity string (e.g., "alice$btps.com").
- `length` (`number`, optional, default: `12`): Number of characters in the token (8–24).
- `charactersFrom` (`string`, optional, default: CrockFord Base32): Character set to generate the token from.

**Returns:**

- `string`: A short, human-friendly, high-entropy token string.

**Throws:**

- `BTPErrorException` if length is out of bounds.

**Example:**

```js
import { generateUserToken } from '@btps/sdk/crypto';
const token = generateUserToken('alice$btps.com', 12);
// Returns: "ABC123DEF456"
```

---

### canonicalize / canonicalizeValue / assertStrictJson

```ts
canonicalize(text: string): string
canonicalizeValue(value: unknown): string
assertStrictJson(text: string): void
```

**Description:**
The RFC 8785 (JCS) canonical form every BTPS signature covers. `canonicalize` takes a JSON text and refuses one that names a member twice in any object. `canonicalizeValue` takes an in-memory value, as `JSON.stringify` would send it: `undefined` members are dropped and `toJSON` applies. `assertStrictJson` only checks: it throws for a text that is not JSON or that names a member twice, so two parsers cannot read different values from the same signed bytes. Each throws `BTP_ERROR_CANONICAL_JSON`. The signing functions above call these for you.

**Example:**

```js
import { canonicalizeValue } from '@btps/sdk/crypto';
const bytes = canonicalizeValue({ b: 1, a: 2 }); // '{"a":2,"b":1}'
```

---

### wrapContentKeyFor / contentKeyOpens

```ts
wrapContentKeyFor(
  artifact: Pick<BTPTransporterArtifact, 'encryption' | 'document'>,
  oldKey: BTPDecryptionKey,
  newPublicKey: string,
): Promise<BTPContentKeySidecar>

contentKeyOpens(
  artifact: Pick<BTPTransporterArtifact, 'encryption' | 'document'>,
  sidecar: BTPContentKeySidecar,
  newKey: BTPDecryptionKey,
): Promise<boolean>
```

**Description:**
Since 1.2, for deleting an old private key after a key rotation. `wrapContentKeyFor` unwraps an encrypted artifact's content key with the key it was wrapped to (`oldKey`: a PEM private key, or a `Decrypter` with `unwrapKey`), checks that it opens the document, and wraps it to `newPublicKey` (SPKI PEM). The artifact is not changed: keep the side-car beside it. `contentKeyOpens` says whether a side-car opens its artifact with `newKey`; given a PEM private key, the side-car must also name that key (`recipientFingerprint`). Delete the old private key only once every side-car opens. See [Key rotation](../features/keyRotation.md#delete-an-old-private-key).

---

### assertFullLengthAuthTag / decryptAesGcm

```ts
assertFullLengthAuthTag(authTag: Uint8Array): void
decryptAesGcm(aesKey: Buffer, request: DecryptRequest): Uint8Array
```

**Description:**
Building blocks for a custom `Decrypter`. `assertFullLengthAuthTag` throws `BTP_ERROR_UNSUPPORTED_ENCRYPT` for an AES-GCM tag that is not exactly 16 bytes. `decryptAesGcm` is the local AES-256-GCM step once the content key is unwrapped, so a `Decrypter` whose key holder only unwraps the key (as a KMS does) can finish with it; it also refuses a short tag. Exported for `Decrypter` implementations; platforms rarely need them otherwise.

---

### Crypto constants

| Constant                              | Value                                | What it is                                                                                                                                   |
| ------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_RSA_KEY_BITS`                    | `2048`                               | The smallest RSA key the SDK encrypts to. `encryptRSA` refuses a smaller one with `BTP_ERROR_UNSUPPORTED_ENCRYPT`                            |
| `DEFAULT_ALPHABET`                    | `'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'` | The characters `generateUserToken` draws from: Crockford Base32, without look-alike characters                                               |
| `DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS` | `300`                                | Since 1.2: the longest a key chain is trusted from a cache unless a server sets `keyChainMaxCacheSeconds`. Also from `@btps/sdk/server/core` |

---

## Server helpers (`@btps/sdk/server`)

### wrapForAgent

```ts
wrapForAgent(
  artifact: Pick<BTPTransporterArtifact, 'encryption' | 'to'> & { cosignatures?: BTPCosignature[] },
  identityKey: BTPDecryptionKey,
  device: Pick<BTPTrustRecord, 'publicKeyBase64' | 'publicKeyFingerprint'>,
  identity?: string // since 1.2; artifact.to by default
): Promise<BTPAgentKey>
```

**Description:**
Since 1.2. Builds a query result's `agentKey`. It unwraps an encrypted artifact's AES content key with the identity's key, and wraps it again with RSA-OAEP / SHA-256 to the key the device's record holds now, naming that key's fingerprint. Since 1.2, it does the same for each cosignature's content key (`cosignatureKeys`, by position): the key wrapped to `identity`, or `null` where `identity` is not a recipient. `identity` is whose keys to wrap: the artifact's `to` by default, or its `from` for an artifact the identity sent. An unencrypted artifact with cosignatures gets `cosignatureKeys` alone. The artifact is untouched. It throws `BTP_ERROR_UNSUPPORTED_ENCRYPT` for an artifact with neither encryption nor cosignatures, or for a `Decrypter` without `unwrapKey`. See [A device's own key to an encrypted document](../protocol/security/keyManagement.md#a-devices-own-key-to-an-encrypted-document).

Wrap only to a device record of the identity whose key unwraps: the device that asked, as the server's agent authentication identified it. `wrapForAgent` cannot check that pairing. Given another identity's device record, it would hand that device this identity's document.

**Example:**

```js
import { wrapForAgent } from '@btps/sdk/server';
// In the provider's inbox.fetch handler, for the device that asked:
const results = await Promise.all(
  entries.map(async (entry) =>
    entry.artifact.encryption || entry.artifact.cosignatures
      ? { ...entry, agentKey: await wrapForAgent(entry.artifact, identityDecrypter, deviceRecord) }
      : entry,
  ),
);
```

---

### verifyTransporterSignature

```ts
verifyTransporterSignature(
  artifact: BTPTransporterArtifact,
  keyResolver?: BtpsKeyResolver,
  keyChains?: BTPKeyChainCheck,
): Promise<{ isValid: boolean; error?: BTPErrorException; signerKey?: string }>
```

**Description:**
Since 1.2. Who signed a transporter artifact, checked exactly as a `BtpsServer` checks it on arrival:

- **Not delegated:** against the sender's own key, at the artifact's selector.
- **Delegated:** the delegation must be allowed, by the sender itself or its domain's operator. It must be attested by the operator when the sender delegates for itself, and signed by its delegator, each against their own keys. Then the artifact must be signed by the delegated agent's key.

`keyResolver` finds each key in place of DNS. Without one, each key is looked up in DNS only; pass `createDefaultKeyResolver({ from })` to find a key that is not in DNS from its identity's host, as a server does ([Finding a signature key](../protocol/specifications/key-rotation.md#finding-a-signature-key)). With `keyChains` (`resolveKeyChain`, `retiredKeyGraceSeconds`), each key is also checked against its identity's key chain, as a server does, and one rotated away past its grace or revoked is refused (`BTP_ERROR_KEY_RETIRED`, `BTP_ERROR_KEY_REVOKED`).

On success `signerKey` is the key that signed the artifact itself, the one to pass to `decryptVerify`. `BtpsAgent.openResult` uses it, so a device runs a server's signature steps and finds the sender's key as a server does. It passes no `keyChains`, so unlike a server, a device checks no key chain.

---

### lifecycleEventChainReference / lifecycleEventSenderProblem

```ts
lifecycleEventChainReference(event: BTPLifecycleEvent): string | undefined
lifecycleEventSenderProblem(event: BTPLifecycleEvent, envelope: { from: string }): string | undefined
```

**Description:**
Since 1.2. `lifecycleEventChainReference` gives the id of the earlier event an event names in its chain: a `withdrawn`'s proposal (`inReplyTo`), or the `withdrawn` a proposal `follows`; `undefined` for any other event. `lifecycleEventSenderProblem` checks the one chain rule that needs nothing but the event: only the payer withdraws or proposes again, never the invoice's issuer. It returns what is wrong, or `undefined`. `eventChainCheck` runs both in flight; a platform runs them on an encrypted event once it has opened it, with `lifecycleEventChainProblem`. See [Withdrawing proposals](../features/withdrawingProposals.md).

---

### Protocol versions

| Export                  | Signature or value                           | What it is                                                                                                                         |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `BTP_PROTOCOL_VERSION`  | `'1.2.0'`                                    | The newest version this SDK speaks. It does not decide what an artifact is stamped with: `artifactVersion` does                    |
| `MIN_SUPPORTED_VERSION` | `'1.1.0'`                                    | The oldest version this SDK takes. Control artifacts (`PING`, `QUIT`) are stamped with it                                          |
| `MAX_SUPPORTED_VERSION` | `'1.2.0'`                                    | The newest version this SDK takes                                                                                                  |
| `isSupportedVersion`    | `(version: unknown) => boolean`              | Whether a `version` is one this SDK speaks, 1.1 or 1.2, by major and minor. It refuses 1.0                                         |
| `isVersionBelow`        | `(version: string, than: string) => boolean` | Whether `version` is older than `than`, by major and minor. One that is not a version is older                                     |
| `artifactVersion`       | `(artifact: BTPVersionedArtifact) => string` | Since 1.2: `'1.1.0'` when everything in the artifact can be said in 1.1, else `'1.2.0'`. Call it on the document before encryption |

See [Protocol versions](../features/versions.md).

---

### Action and artifact type lists

Each is a `readonly` array (or record) of the names a server and agent take.

| Export                             | What it lists                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_ACTIONS`                    | Every agent action (`AgentAction`): trust, inbox, outbox, sentbox, draft, trash, system, auth, artifact, event and, since 1.2, details actions                                                                                                                                  |
| `AUTH_ACTIONS`                     | `'auth.request'`, `'auth.refresh'`                                                                                                                                                                                                                                              |
| `IMMEDIATE_ACTIONS`                | The actions a server answers at once (`respondNow: true`): system, auth, inbox, outbox, draft, sentbox, trash, and `trust.update`, `trust.delete`, `trust.fetch`                                                                                                                |
| `AGENT_ACTIONS_REQUIRING_DOCUMENT` | The actions that must carry a `document`                                                                                                                                                                                                                                        |
| `AGENT_TRANSPORTER_ACTIONS`        | Each agent action that carries a transporter artifact the device built, and that artifact's type: `trust.request` → `TRUST_REQ`, ..., `details.respond` → `DETAILS_RES`                                                                                                         |
| `TRANSPORTER_ACTIONS`              | The transporter artifact types: `TRUST_REQ`, `TRUST_RES`, `BTPS_DOC`, `BTPS_EVENT` and, since 1.2, `DETAILS_CHANGED`, `DETAILS_REQ`, `DETAILS_RES`                                                                                                                              |
| `CONTROL_ACTIONS`                  | `'QUIT'`, `'PING'`                                                                                                                                                                                                                                                              |
| `DETAILS_ARTIFACT_TYPES`           | Since 1.2: `'DETAILS_CHANGED'`, `'DETAILS_REQ'`, `'DETAILS_RES'`. Also from `@btps/sdk/trust`                                                                                                                                                                                   |
| `PERMISSION_ENVELOPE_FIELDS`       | Since 1.2: each envelope field of trust permissions and the artifact types it is on: `permissions`, `given`, `change` on `TRUST_REQ`; `granted` on `TRUST_RES`; `entityType` on both; `documentType` on `BTPS_DOC`; `details` on the details types. Also from `@btps/sdk/trust` |
| `IDENTITY_DETAIL`                  | Since 1.2: the one detail each kind gives that the other never does: `person` → `'detail:dob'`, `organisation` → `'detail:registrationNumber'`. Also from `@btps/sdk/trust`                                                                                                     |

---

### Other protocol constants

| Export                             | Value                                       | What it is                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_MAX_ARTIFACT_AGE_SECONDS` | `300`                                       | How far an artifact's `issuedAt` may be from a server's clock unless it sets `maxArtifactAgeSeconds`. Also from `@btps/sdk/server/core`                                     |
| `BTPS_DNS_HOST_NAME_SPACE`         | `'_btps.host'`                              | The DNS name a domain's host record is published under: `_btps.host.<domain>`                                                                                               |
| `BTPS_DNS_IDENTITY_NAME_SPACE`     | `'_btps.identity'`                          | The DNS name an identity's key is published under: `<selector>._btps.identity.<account>.<domain>`                                                                           |
| `CURRENCY_CODES`                   | ISO 4217 codes                              | Every currency code a money field takes (`CurrencyCode`)                                                                                                                    |
| `CURRENCY_DECIMALS`                | `{ JPY: 0, KWD: 3, ... }`                   | The decimal places of each currency whose minor unit is not two hundredths; every other code has 2. Fixed here so every receiver writes an amount the same way              |
| `BTPS_FIELD_LIMITS`                | `{ trustRequest: { name: 200, ... }, ... }` | The longest each field may be: a text in characters, a list in entries, a record in keys. Every provider takes the same; see [Limits](../protocol/specifications/limits.md) |

Since 1.2, one value of `BTPS_FIELD_LIMITS` is not the same at every provider: `documentAttachments`, `{ standard: 20, ceiling: 1000 }`, how many attachments a `1.2.0` document carries. Every receiver takes the standard, and a provider may take more, up to the ceiling, with `maxAttachments` ([Attachments](../protocol/specifications/limits.md#attachments)).

---

## Server building blocks (`@btps/sdk/server/core`)

The middleware checks above (`agreementOrderCheck`, `eventChainCheck`, `detailsResponseCheck`, `detailsRequestLimit`) also come from this subpath. The classes here (factories, registry, rate limiter, metrics tracker) are in the [Class API Reference](./classApiReference.md#server-factories-and-registry-btpssdkservercore).

### createDefaultMiddleware

```ts
createDefaultMiddleware(): MiddlewareDefinitionArray
```

**Description:**
A ready middleware set for development: an IP rate limit before parsing (50 a second), an identity rate limit after signature verification (30 a second, counted only once the signature proves the sender), and metrics logging after parsing, trust verification and `onArtifact`. It answers a limit with `BTP_ERROR_RATE_LIMITER`. Its limiter (`BtpsSimpleRateLimiter`) and tracker (`BtpsSimpleMetricsTracker`) keep everything in one process and write to the console, so production limits belong in your own middleware over a shared store. See [Middleware](../server/middlewares.md).

**Example:**

```js
// btps.middleware.mjs
import { createDefaultMiddleware } from '@btps/sdk/server/core';
export default () => createDefaultMiddleware();
```

---

### Server defaults and minimums

Each is the value a `BtpsServerOptions` setting takes when it is not set, or the lowest it may be set to.

| Constant                               | Value   | Setting                                                                              |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| `DEFAULT_MAX_ARTIFACT_SIZE_KB`         | `65536` | Since 1.2: `maxArtifactSizeKb` default: 64 MB (5 MB in 1.1)                          |
| `MIN_MAX_ARTIFACT_SIZE_KB`             | `65536` | Since 1.2: `maxArtifactSizeKb` minimum: 64 MB, what every server takes (1 MB in 1.1) |
| `DEFAULT_MAX_ARTIFACT_AGE_SECONDS`     | `300`   | `maxArtifactAgeSeconds` default: 5 minutes                                           |
| `MIN_MAX_ARTIFACT_AGE_SECONDS`         | `60`    | `maxArtifactAgeSeconds` minimum: 1 minute                                            |
| `DEFAULT_CONNECTION_TIMEOUT_MS`        | `30000` | `connectionTimeoutMs` default: 30 seconds                                            |
| `DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION` | `32`    | `maxInFlightPerConnection` default                                                   |
| `MIN_MAX_IN_FLIGHT_PER_CONNECTION`     | `1`     | `maxInFlightPerConnection` minimum: one request at a time                            |
| `DEFAULT_MAX_ARTIFACTS_IN_FLIGHT`      | `2`     | Since 1.2: `maxArtifactsInFlight` default                                            |
| `DEFAULT_MAX_ARTIFACTS_WAITING`        | `100`   | Since 1.2: `maxArtifactsWaiting` default                                             |
| `DEFAULT_RETIRED_KEY_GRACE_SECONDS`    | `86400` | Since 1.2: `retiredKeyGraceSeconds` default: 1 day                                   |
| `DEFAULT_KEY_CHAIN_MAX_CACHE_SECONDS`  | `300`   | Since 1.2: `keyChainMaxCacheSeconds` default                                         |

Every server setting and field limit: [Limits](../protocol/specifications/limits.md).

---

## Client constants (`@btps/sdk/client`)

| Constant                                          | Value                                            | What it is                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MIN_CONNECT_TIMEOUT_MS`                          | `5000`                                           | The least `connectTimeoutMs` may be; a lower value is raised to it, with a warning                                                                                               |
| `DEFAULT_CONNECT_TIMEOUT_MS`                      | `5000`                                           | `connectTimeoutMs` when not set                                                                                                                                                  |
| `MIN_REPLY_TIMEOUT_MS`                            | `10000`                                          | The least `replyTimeoutMs` (and `send`'s `timeoutMs`) may be, so every receiver can count on that long to answer                                                                 |
| `DEFAULT_REPLY_TIMEOUT_MS`                        | `20000`                                          | `replyTimeoutMs` when not set                                                                                                                                                    |
| `KEY_CHAIN_REPLY_TIMEOUT_MS`                      | `5000`                                           | Since 1.2: how long `lookupKeyChain` waits for its answer once connected, unless given `replyTimeoutMs`. A host that cannot answer is given up on soon, and its keys left to DNS |
| `BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS`         | `10`                                             | `maxConnections` of a `BtpsTransporter` when not set                                                                                                                             |
| `BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS`  | `300`                                            | `connectionTTLSeconds` of a `BtpsTransporter` when not set                                                                                                                       |
| `BTP_TRANSPORTER_ERROR_CONNECTION_ALREADY_EXISTS` | `{ code, message: 'Connection already exists' }` | Thrown by `registerConnection` for a recipient that already has a connection, unless `override` is `true`                                                                        |
| `BTP_TRANSPORTER_ERROR_MAX_CONNECTIONS_REACHED`   | `{ code, message: 'Max connections reached' }`   | A new connection when every connection in a full pool has a send waiting                                                                                                         |

---

## Trust Store (`@btps/sdk/trust`)

### isTrustActive

```ts
isTrustActive(trust?: BTPTrustRecord): boolean
```

**Description:**
Checks if a trust record is active (status is 'accepted' and not expired).

**Arguments:**

- `trust` (`BTPTrustRecord`, optional): The trust record to check.

**Returns:**

- `boolean`: `true` if active, `false` otherwise.

**Example:**

```js
import { isTrustActive } from '@btps/sdk/trust';
const active = isTrustActive(trustRecord);
```

---

### validateTrustRequest

```ts
validateTrustRequest(trust?: BTPTrustRecord): { isValid: boolean; error?: BTPErrorException }
```

**Description:**
Validates whether a new trust request can be sent, considering current trust status, blocks, and retry timers.

**Arguments:**

- `trust` (`BTPTrustRecord`, optional): The trust record to check.

**Returns:**

- `object`: `{ isValid, error }` with validity and error (if any).

**Example:**

```js
import { validateTrustRequest } from '@btps/sdk/trust';
const { isValid, error } = validateTrustRequest(trustRecord);
```

---

### computeTrustId

```ts
computeTrustId(senderId: string, receiverId: string): string
```

**Description:**
Computes a globally unique, deterministic trust ID for a given sender and receiver identity pair using SHA-256. The ID is directional and collision-resistant.

**Arguments:**

- `senderId` (`string`, required): Sender identity (e.g., `finance$company.com`).
- `receiverId` (`string`, required): Receiver identity (e.g., `billing$vendor.org`).

**Returns:**

- `string`: 64-character hexadecimal SHA-256 hash of `from:to`.

**Example:**

```js
import { computeTrustId } from '@btps/sdk/trust';
const trustId = computeTrustId('finance$company.com', 'billing$vendor.org');
```

---

### computeAgentTrustId

```ts
computeAgentTrustId(agentId: string, identity: string): string
```

**Description:**
Computes the trust record id of a device (agent) registered for an identity: `computeTrustId('agent:' + agentId, identity)`. Device records live in the same trust store as the trust between two identities, and this prefix keeps their ids apart. An identity has no `:`, so no trust id between two identities can ever equal a device's. `BtpsAuthentication` stores and finds device records with it; a trust store needs no change.

**Example:**

```js
import { computeAgentTrustId } from '@btps/sdk/trust';
const deviceRecordId = computeAgentTrustId(
  'btps_ag_f1e29dbd-bebe-482a-b4ac-ba4508960b28',
  'alice$saas.com',
);
```

---

### validateTrustResponse

```ts
validateTrustResponse(
  senderId: string,
  receiverId: string,
  trustStore: AbstractTrustStore<BTPTrustRecord>,
  response?: { granted?: BTPPermissionName[] }
): Promise<{ isValid: boolean; error?: BTPErrorException }>
```

**Description:**
Validates a `TRUST_RES` by checking if the response is authorized (only the original receiver of a trust request can respond). Since 1.2, with `response`, its `granted` is checked against the requester's record (`trustGrantProblem`), and an accepted trust also takes an answer to the change it has pending (`permissions.pendingChange`).

**Arguments:**

- `senderId` (`string`, required): The identity sending the trust response (responder).
- `receiverId` (`string`, required): The identity receiving the trust response (original requester).
- `trustStore` (`AbstractTrustStore<BTPTrustRecord>`, required): The trust store instance.
- `response` (`object`, optional, since 1.2): The answer's envelope. A `granted` that leaves out a required name, or that the record has no permissions to check against, is refused with `BTP_ERROR_PERMISSION_REQUIRED`; a name the request did not ask for, with `BTP_ERROR_PERMISSION`.

**Returns:**

- `Promise<object>`: `{ isValid, error }` with validity and error (if any).

**Example:**

```js
import { validateTrustResponse } from '@btps/sdk/trust';
const { isValid, error } = await validateTrustResponse('userB$domain', 'userA$domain', trustStore);
```

---

### trustGrantProblem

```ts
trustGrantProblem(
  response: { granted?: BTPPermissionName[] },
  record: { status: BTPTrustStatus; permissions?: BTPTrustRecordPermissions }
): string | undefined
```

**Description:**
Since 1.2. Why an answer's `granted` does not meet the requester's trust record, or `undefined`: every required name it asked for is granted, and nothing it did not ask for. A pending trust is checked against `permissions.requested`; an accepted trust takes an answer only while a change is pending, and is checked against `permissions.pendingChange.requested`. A record without `permissions` cannot be checked, so `granted` is refused there. An answer without `granted` (a rejection, or a 1.1 answer) is not checked. The server runs it on every `TRUST_RES` through `validateTrustResponse`.

---

### documentTypeProblem

```ts
documentTypeProblem(
  artifact: { type: string; documentType?: string; encryption?: unknown; document?: unknown },
  record: { permissions?: BTPTrustRecordPermissions }
): string | undefined
```

**Description:**
Since 1.2. Why a send does not meet the receiver's trust record, or `undefined`. Under a trust with permissions, a `BTPS_DOC` names its `documentType`, `send:<documentType>` is granted, and a readable document is that type. A trust without permissions (a 1.1 trust) takes any type, and other artifact types are not checked. The server runs it on every send it receives. See [A send's document type](../protocol/specifications/transporter-artifact.md#a-sends-document-type).

---

### shapeTrustRequestFor11 / composeTrustRequestFor

```ts
shapeTrustRequestFor11<T>(payload: T): { payload: T; shaped: BTPShaped }

composeTrustRequestFor<T>(
  to: string,
  payload: T,
  options?: { versionFallback?: boolean; btpMtsOptions?: ConnectionOptions }
): Promise<{ payload: T; shaped?: BTPShaped } | { error: BTPErrorException }>
```

**Description:**
Since 1.2. `shapeTrustRequestFor11` returns a trust request as a 1.1 receiver allows: without `permissions`, `given`, `entityType` and `change`, and without `own` and `verification` in its document, restamped, with what it left out. `composeTrustRequestFor` asks the receiver's server its version (one `PING`) for a `TRUST_REQ` carrying permissions only, and shapes it for a 1.1 server, refuses it with `versionFallback: false`, or returns the error when the server cannot be asked. `signEncrypt` and `BtpsAgent` call it themselves; a platform that builds artifacts another way calls it before it signs. See [To a receiver whose server speaks 1.1](../protocol/specifications/transporter-artifact.md#trust-permissions).

---

### signVerification

```ts
signVerification(
  statement: { subject: string; claims: BTPVerificationClaims; verifiedAt: string; expiresAt: string },
  verifier: { verifiedBy: string; selector: string } & ({ pemFiles: PemKeys } | { signer: Signer })
): Promise<BTPVerification>
```

**Description:**
Since 1.2. A provider signs a statement that it checked `subject`, the address that will send the trust request carrying it, as `verifiedBy` at `selector`. The result goes in the request's document as `verification`. `claims` are the protocol's names only: `entityType`, and `detail:` names with their values. See [Verification](../protocol/specifications/transporter-artifact.md#verification).

---

### verificationFacts

```ts
verificationFacts(
  request: { from: string; document?: unknown },
  options?: { keyResolver?: BtpsKeyResolver; now?: number }
): Promise<BTPVerificationFacts | undefined>
```

**Description:**
Since 1.2. The facts about an opened trust request's verification, or `undefined` when it carries none: `{ signatureValid, expired, verifierServesSender, verifierIsOperator }`. It refuses nothing and labels no one verified: whose verifications to trust, and which facts to require, are each provider's to decide. `verifiedBy`'s key is looked up in DNS, or through `keyResolver`, and the operator from the sender's `_btps.host`. See [Verification](../protocol/specifications/transporter-artifact.md#verification).

---

### verifierRefusal

```ts
verifierRefusal(verifiedBy: string): Promise<{ error: BTPError; problem: string } | undefined>
```

**Description:**
Since 1.2. Why `verifiedBy` may not verify, or `undefined`: only the operator (`op`) named in `_btps.host` of its own domain, one who runs a BTPS server, may. Anyone else is `BTP_ERROR_VALIDATION`. A lookup that fails (a DNS error or timeout, not a domain without the record) judges no one: it is `BTP_ERROR_RESOLVE_DNS`, to try again. `decryptVerify` runs it on every opened trust request that carries a verification. It only makes a verifier an operator: whose verifications to trust stays each provider's to decide. See [Verification](../protocol/specifications/transporter-artifact.md#verification).

---

### agreementContentSha256, agreementRef

```ts
agreementContentSha256(agreement: object): string
agreementRef(agreement: { id: string }, originator: string): BTPAgreementRef
```

**Description:**
Since 1.2. The SHA-256, in lowercase hex, of an agreement's RFC 8785 form without `originatorSignature`, and what names the agreement: `{ originator, id, contentSha256 }`. Every signer's copy has the same, whatever its encryption. See [Agreement](../protocol/specifications/transporter-artifact.md#agreement).

---

### signAgreement, originatorSignatureValid

```ts
signAgreement(
  content: Omit<BTPAgreementDoc, 'originatorSignature'>,
  by: { originator: string; selector: string } & ({ pemFiles: PemKeys } | { signer: Signer })
): Promise<BTPAgreementDoc>
originatorSignatureValid(agreement: BTPAgreementDoc, originator: string, keyOf: BTPKeyOf): boolean
```

**Description:**
Since 1.2. The originator signs an agreement once, over `agreementRef`, and sends each signer its own copy. `originatorSignatureValid` checks the signature against the originator's key at its `selector`, from `keyOf(identity, selector)`: a key from DNS, from a store, or from an evidence bundle.

---

### cosign, cosignatureSha256, cosignatureSignedPart, cosignedStatementText

```ts
cosign(input: {
  statement: BTPAgreementStatement;
  recipients: { identity: string; publicKey: string }[];
  by: { selector?: string } & ({ pemFiles: PemKeys } | { signer: Signer });
}): Promise<BTPCosignature>
cosignatureSha256(cosignature: BTPCosignature): string
cosignatureSignedPart(cosignature: BTPCosignature): { [field: string]: unknown }
cosignedStatementText(statement: BTPAgreementStatement): string
```

**Description:**
Since 1.2. A signer's answer to an agreement, as a cosignature. `cosign` writes the statement as `cosignedStatementText` gives it, encrypts it once with AES-256-GCM, wraps the content key with RSA-OAEP (SHA-256) to each of `recipients` (the originator and every signer, the signer included, by their public keys, PEM), and signs the cosignature over that ciphertext and the text's SHA-256. With `selector`, it signs with the signer's identity key, which may be a managed key its provider holds (`signer`). On a device, leave `selector` out and give the device's key (`pemFiles`, or a keystore's `signer`): the cosignature then travels in the device's delegated artifact (`BtpsAgent`'s `event.send` with `cosignatures`), and the originator adds `delegatedArtifact` when it forwards it. The statement's `artifactId` is the id of the artifact that first delivers it, and its `previous`, in a sequential agreement, the `cosignatureSha256` of the cosignature before it. `cosign` writes the identities on the cosignature in lower case; nothing refuses another case, as addresses are compared without case. It does not check the statement: one that breaks its rules, such as a `consent` on a decline, still signs, and its recipients' `decryptVerify` refuses it (`BTP_ERROR_SIG_VERIFICATION`).

`cosignatureSha256` is the SHA-256, in lowercase hex, of a cosignature's RFC 8785 form, signature included, without `delegatedArtifact`: what the next statement names as `previous`, and what timestamps and arrivals are over. `cosignatureSignedPart` is what the signer's signature is over: the cosignature without `signature` and `delegatedArtifact`. `cosignedStatementText` is the exact text a cosignature encrypts: the RFC 8785 form of `{ statement, padding }`, `padding` being `0`s up to the next multiple of `BTPS_FIELD_LIMITS.agreement.statementPaddingBucket` (4,096) characters. The same statement always gives the same text, which is how an evidence bundle keeps it. See [Cosignatures](../protocol/specifications/transporter-artifact.md#cosignatures).

---

### cosignaturesProblem

```ts
cosignaturesProblem(
  artifact: BTPTransporterArtifact,
  keyOf: BTPCosignatureKeyOf
): Promise<string | undefined>
type BTPCosignatureKeyOf = (
  identity: string,
  selector: string,
  fingerprint: string,
  forwarded: boolean
) => Promise<string | undefined>
```

**Description:**
Since 1.2. Why the cosignatures an artifact carries are not what they say, or `undefined`, checked as a BTPS server checks them on receipt, without decrypting: every server runs it in its signature step, and refuses with `BTP_ERROR_SIG_VERIFICATION`. Only a `BTPS_EVENT` carries them, at least one. Each is signed by its signer's key at its `selector`, or by a device its delegation vouches for; all name one document; a signer cosigns once; one that names `previous` follows the one before it. The document's originator may carry any of them, its own among them; anyone else carries only its own, whose `artifactId` is the artifact's `id`. A device's must have its delegation signed by its delegator, an attestation on a self-delegation, any attestation signed by its attestor, and its delegated artifact sent by the signer, signed by the device, and with the cosignature's `artifactId` as its `id`. `keyOf` gives the public key (PEM) of `identity` at `selector` whose fingerprint is `fingerprint`, or `undefined`: from DNS or a key chain. `forwarded` is `true` when an earlier artifact first delivered the cosignature (its `artifactId` is not the carrying artifact's `id`); the lookup then takes the key by its history, as a BTPS server does: a key since rotated away as planned still holds, and a compromised one never does. A cosignature made now (`forwarded` is `false`) is held to the live rules, the retired-key grace included. It checks no order between answers: that is `agreementOrderCheck`'s.

---

### openCosignature, statementOfText, cosignedStatementProblem

```ts
openCosignature(
  cosignature: BTPCosignature,
  receiver: { identity: string; key: BTPDecryptionKey; wrappedKey?: string }
): Promise<{ statement: BTPAgreementStatement } | { problem: string } | undefined>
statementOfText(
  cosignature: BTPCosignature,
  text: string
): { statement: BTPAgreementStatement } | { problem: string }
cosignedStatementProblem(value: unknown): string | undefined
```

**Description:**
Since 1.2. `openCosignature` opens a cosignature's statement with the receiver's key (a private key, PEM, or a [Decrypter](./typesAndInterfaces.md#decrypter) with `unwrapKey`). It gives `undefined` when the receiver is not one of its recipients, and a `problem` when it is and the content key does not open, or the statement does not open. Otherwise it is `statementOfText` on what it opened. `wrappedKey` (since 1.2) replaces the recipient's own wrapped key: on a device, the content key its provider wrapped again to the device key (`agentKey.cosignatureKeys`), which `key`, the device's key, opens. `decryptVerify` runs it for each cosignature its receiver is a recipient of.

`statementOfText` gives the statement in `text`, a cosignature's opened statement as exact text (as an evidence bundle keeps it), or the problem: its SHA-256 is not the cosignature's `statementSha256`, it is not in its one RFC 8785 form, its padding is not exactly what `cosignedStatementText` writes, or its statement's agreement, signer, `artifactId` or `previous` is not the cosignature's. `cosignedStatementProblem` gives why `value` is not an opened statement, `{ statement, padding }`, as the protocol holds one (the statement's own rules, and the padding's length), or `undefined`.

---

### agreementStatementProblem, agreementOrderProblem

```ts
agreementStatementProblem(
  envelope: { from: string; to: string },
  answer: {
    eventType: string;
    agreement: BTPAgreementRef;
    cosignature: BTPCosignature;
    statement: BTPAgreementStatement;
  },
  agreement: BTPAgreementDoc,
  earlier: readonly { cosignature: BTPCosignature; statement: BTPAgreementStatement }[]
): string | undefined
agreementOrderProblem(
  answer: { from: string; previous?: string },
  held: BTPAgreementAnswers
): string | undefined
agreementTurnProblem(from: string, held: BTPAgreementAnswers): string | undefined
```

**Description:**
Since 1.2. Why an agreement's answer does not answer it, or `undefined`: the originator's platform's checks, never the server's. `agreementTurnProblem` needs only the sender: a listed signer who has not answered, and in a sequential agreement the next one, with nothing after a decline. `agreementOrderCheck` runs it in flight. `agreementOrderProblem` adds the statement's `previous`: the SHA-256 of the answer before it in a sequential agreement (its `cosignatureSha256`), and absent in an `any` one. `agreementStatementProblem` is the full check of an opened answer: `envelope` is the answer's own `from` and `to`; `answer` is the event's `eventType` and `agreement`, with its cosignature and the statement `decryptVerify` opened from it (`cosigned`); `agreement` is the receiver's copy; and `earlier` holds the cosignatures already taken, in order, each with its opened statement. The statement's `decision` is the event's `eventType`, it names this agreement (its originator, id and `contentSha256`) and its terms exactly, is its sender's own, is signed no later than `acceptance.by`, and follows the order. Signatures are not part of it: the server checked each cosignature on receipt (`cosignaturesProblem`). See [Agreement events](../protocol/specifications/transporter-artifact.md#agreement-events).

---

### agreementOrderCheck

```ts
agreementOrderCheck(lookups: {
  answers: (query: { relatesTo: string; signer: string; originator: string }) =>
    Promise<BTPAgreementAnswers | undefined>;
}): MiddlewareDefinition<'after', 'trustVerification'>
```

**Description:**
Since 1.2, from `@btps/sdk/server/core`. Middleware a platform adds to check an agreement's answers in flight, after the server's trust check. From the envelope alone (who sent it, and the copy `relatesTo` names), with the platform's own record of the agreement from `answers`, it refuses an answer that is not its sender's turn (`agreementTurnProblem`) with `BTP_ERROR_AGREEMENT_ORDER`, the broken rule in its message. It needs no decryption. An event whose `relatesTo` is no agreement copy (`answers` gives `undefined`), and an untrusted artifact, pass on. Off until added; the server never checks the order itself. See [Agreement events](../protocol/specifications/transporter-artifact.md#agreement-events).

---

### eventChainCheck

```ts
eventChainCheck(lookups?: {
  getEvent?: (query: { id: string; from: string; to: string }) =>
    Promise<BTPEventFacts | undefined>;
}): MiddlewareDefinition<'after', 'trustVerification'>
```

**Description:**
Since 1.2, from `@btps/sdk/server/core`. Middleware a platform adds to check a lifecycle event's chain in flight, after the server's trust check, with `lifecycleEventChainProblem`. It refuses with `BTP_ERROR_EVENT_CHAIN`, the broken rule in its message. With `getEvent`, the platform's own lookup of the earlier event a `withdrawn` or `follows` names, it checks every rule; without it, only that the payer, never the invoice's issuer, sent it. It reads the event, so an encrypted one passes on, for the platform to check once opened. Off until added; the server never checks a chain itself. See [Lifecycle Event](../protocol/specifications/transporter-artifact.md#4-lifecycle-event-btps_event).

---

### detailsResponseCheck

```ts
detailsResponseCheck(lookups: {
  getArtifact: (query: { artifactId: string; from: string; to: string }) =>
    Promise<BTPDetailsEnvelope | undefined>;
}): MiddlewareDefinition<'after', 'trustVerification'>
```

**Description:**
Since 1.2, from `@btps/sdk/server/core`. Middleware a platform adds to check a `DETAILS_RES` in flight, after the server's trust check: it answers a `DETAILS_REQ` its receiver sent to its sender, and names only what that request asked for (`detailsRequestRefusal`). It refuses with `BTP_ERROR_PERMISSION`, the reason in its message. `getArtifact` is the platform's own record of the request the response names: `artifactId` is its `relatesTo`, `from` the response's receiver and `to` its sender. It reads only envelopes, so it works the same for an encrypted response, arriving or sent by one of this provider's devices. Off until added; the server checks only that the request is known (`isKnownArtifact`). See [Details refresh](../protocol/specifications/transporter-artifact.md#details-refresh).

---

### detailsRequestLimit

```ts
detailsRequestLimit(
  allow: (request: { from: string; to: string; names: string[] }) =>
    true | { retryAfter: number } | Promise<true | { retryAfter: number }>
): MiddlewareDefinition<'after', 'trustVerification'>
```

**Description:**
Since 1.2, from `@btps/sdk/server/core`. Middleware a provider adds for its own limit on details requests, for example requests per trust per month: `allow` is asked once for each trusted `DETAILS_REQ`. `true` takes it, and `{ retryAfter }`, in whole seconds, refuses it with `BTP_ERROR_DETAILS_RATE_LIMITED`, whose `status.retryAfter` tells the asker how long to wait. Add it after every other check, so the provider counts only requests that are taken. Off until added: the protocol sets no limit. See [Details refresh](../protocol/specifications/transporter-artifact.md#details-refresh).

---

### verifyEvidenceBundle, buildEvidenceBundle, describeEvidenceFacts

```ts
verifyEvidenceBundle(
  bundle: unknown,
  options?: {
    trustedTimestampRoots?: string[];
    anchors?: string[];
    operators?: Record<string, string>;
    online?: BTPKeyChainCheck & { keyResolver?: BtpsKeyResolver };
  }
): Promise<BTPEvidenceFacts>
buildEvidenceBundle(
  parts: {
    originator: string;
    agreement: BTPAgreementDoc;
    cosignatures: BTPCosignature[];
    statements: BTPAgreementStatement[];
    keyChains?: BTPEvidenceKeyChain[];
    arrivals?: BTPEvidenceArrival[];
  },
  keyOf: BTPKeyOf
): BTPEvidenceBundle
describeEvidenceFacts(facts: BTPEvidenceFacts): string
```

**Description:**
Since 1.2. An agreement's evidence bundle, checked offline. `verifyEvidenceBundle` refuses a file that is not a bundle (`BTP_ERROR_VALIDATION`) and otherwise reports facts, never a verdict: the content's SHA-256, the originator's signature, the terms as attached, and for each statement its cosignature's signature and key kind, whether its text is the one signed (`statementMatches`), its decision, agreement, terms, deadline and order, and whether the agreement is `complete`. A statement whose text is not the one signed has no `decision`, and its terms and deadline do not hold. It uses only the keys in the bundle, each counted only when its fingerprint is its own, and names each key it checked a signature with (`originatorKey`, each statement's `key` and, for a device, `delegationKey`); `keysConfirmedOnline` is `false` unless it is checked `online` (below), so `complete` means the bundle is consistent with its own keys, not that each key was its identity's. `buildEvidenceBundle` makes one from the opened agreement, its cosignatures in the order taken, as they travelled, each one's statement as `decryptVerify` opened it (`cosigned`), which it writes as the exact text its cosignature signed (`cosignedStatementText`), and the keys `keyOf` gives; it refuses one whose key it cannot find (`BTP_ERROR_RESOLVE_PUBKEY`), and a device's cosignature without its delegated artifact (`BTP_ERROR_VALIDATION`). `describeEvidenceFacts` gives the facts as plain text, as the `btps-verify-evidence` command prints them. A statement with an RFC 3161 token in the bundle's `timestamps` gets a `timestamp` fact (see `timestampFacts`); `trustedTimestampRoots` are the PEM certificates whose timestamps the reader trusts. The deadline fact (`withinDeadline`) is judged by the statement's own `signedAt`, the signer's claim; a trusted timestamp's `time` against `acceptance.by` is independent time, which `describeEvidenceFacts` prints on the line after the statement's, as a fact and which never changes `complete`. See [The evidence bundle](../protocol/specifications/transporter-artifact.md#the-evidence-bundle).

The options, each optional:

| Option                  | What it does                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trustedTimestampRoots` | the PEM certificates whose timestamps the reader trusts                                                                                                                                                                                                                                                        |
| `anchors`               | signing-key fingerprints the reader kept, which anchor a key chain offline                                                                                                                                                                                                                                     |
| `operators`             | operator fingerprints the reader kept, by domain, so an operator's answer can confirm a lost key's rotation                                                                                                                                                                                                    |
| `online`                | checks each signing key now as its identity's, by its key chain (`resolveKeyChain`, `retiredKeyGraceSeconds`), or, with no chain, by its key at the signature's selector. Since 1.2, with `keyResolver`, that key is asked of it (`verify`): `createDefaultKeyResolver({ from })` finds it as a server does, so a key not in DNS is confirmed through its host. Without it, in DNS only. `keysConfirmedOnline` reports the result |

See [In an evidence bundle](../protocol/specifications/key-rotation.md#in-an-evidence-bundle).

---

### timestampRequest, timestampTokenOf, timestampFacts

```ts
timestampRequest(cosignature: BTPCosignature, options?: { nonce?: number }): Promise<Uint8Array>
timestampTokenOf(response: Uint8Array): Promise<string>
timestampFacts(
  token: string,
  statementSha256: string,
  options?: { trustedRoots?: string[] }
): Promise<BTPTimestampFacts>
```

**Description:**
Since 1.2. RFC 3161 trusted timestamps on an agreement's statements. `timestampRequest` builds a DER TimeStampReq over a cosignature's `cosignatureSha256`, asking for the authority's certificate; only that hash leaves the provider. `timestampFacts`' second argument, `statementSha256`, is that same `cosignatureSha256`. The platform sends it to the authority of its choice (`Content-Type: application/timestamp-query`) and gives the reply to `timestampTokenOf`, which returns the token, base64, as a bundle holds it, and refuses a reply that grants none (`BTP_ERROR_VALIDATION`). `timestampFacts` reports facts, never refusing: `imprintMatches` (the token is over this statement), `signatureValid` (signed by the certificate it carries, over a TSTInfo, as its signed content type says), `time`, `authority`, `timestampingKeyUsage` (that certificate's one extended key usage is `id-kp-timeStamping`, critical, as RFC 3161 §2.3 requires of an authority), and, with `trustedRoots`, `trusted` (an authority's certificate, with `timestampingKeyUsage`, that is one of them or chains to one). An unreadable token reports both checks false. `pkijs` and `asn1js` read the tokens, loaded only when a timestamp is used.

---

### detailsProblem

```ts
detailsProblem(
  artifact: BTPDetailsEnvelope,
  record: { permissions?: BTPTrustRecordPermissions },
  sentRequest?: BTPDetailsEnvelope
): string | undefined
```

**Description:**
Since 1.2. Why a details refresh artifact cannot be taken, or `undefined`. A `DETAILS_CHANGED` or `DETAILS_RES` names only details the receiver holds (`record.permissions.detailsHeld`), a `DETAILS_REQ` only details the answerer shares (`detailsShared`); a record without permissions holds none. A `DETAILS_RES` answers `sentRequest`, the `DETAILS_REQ` it names as its receiver sent it, and names only what it asked for; once opened (its `document` an object), its values match its names. `record` is the receiver's own record of the trust, in either direction. The server checks the names on arrival, and `detailsResponseCheck` the request; a platform without that middleware runs this one with its own sent request. See [Details refresh](../protocol/specifications/transporter-artifact.md#details-refresh).

---

### trustPermissionsFromRequest / trustPermissionsFromResponse

```ts
trustPermissionsFromRequest(
  request: { permissions?: BTPTrustPermissions; change?: true; issuedAt: string },
  current?: BTPTrustRecordPermissions
): BTPTrustRecordPermissions | undefined

trustPermissionsFromResponse(
  response: { granted?: BTPPermissionName[] },
  request: { permissions?: BTPTrustPermissions; given?: BTPDetailPermission[] }
): { requester: BTPTrustRecordPermissions; responder: BTPTrustRecordPermissions } | undefined
```

**Description:**
Since 1.2. What a platform saves on its trust records. The BTPS server only reads records; the platform writes them, so it must save what these return.

- `trustPermissionsFromRequest`: the requester's record, when it sends a request with permissions. For a change (`change: true`), pass the trust's `current` permissions: the change is added as `pendingChange`, and the trust keeps running on its old grant until it is answered. `undefined` for a request without permissions, a 1.1 trust.
- `trustPermissionsFromResponse`: both records once a request is accepted. The requester holds the details granted to it (`detailsHeld`) and shares the details it gave (`detailsShared`); the responder holds the reverse. Each side saves its own. `undefined` when the answer grants nothing by name.

**On any answer to a pending change, clear `pendingChange`.** If the change is accepted, save the record `trustPermissionsFromResponse` returns: it has no `pendingChange`. If it is rejected, keep the current permissions and remove `pendingChange`, so the trust runs on its old grant. A `pendingChange` left in place lets the accepted trust keep taking answers to a change already decided.

**Example:**

```js
import { trustPermissionsFromResponse } from '@btps/sdk/trust';
const saved = trustPermissionsFromResponse(response, request);
if (saved) await trustStore.update(trustId, { permissions: saved.requester });
```

---

### canRetryTrust

```ts
canRetryTrust(trust?: BTPTrustRecord): boolean
```

**Description:**
Determines whether a trust request can be retried (applies to previously rejected, revoked, or pending trusts).

**Arguments:**

- `trust` (`BTPTrustRecord`, optional): The trust record to check.

**Returns:**

- `boolean`: `true` if retry is allowed, `false` otherwise.

**Example:**

```js
import { canRetryTrust } from '@btps/sdk/trust';
const canRetry = canRetryTrust(trustRecord);
```

---

### trustGrantRefusal / documentTypeRefusal / detailsNamesRefusal

```ts
trustGrantRefusal(
  response: { granted?: readonly BTPPermissionName[] },
  record: { permissions?: BTPTrustRecordPermissions },
): { error: BTPError; problem: string } | undefined

documentTypeRefusal(
  artifact: { type: string; documentType?: string; encryption?: unknown; document?: unknown },
  record: { permissions?: BTPTrustRecordPermissions },
): { error: BTPError; problem: string } | undefined

detailsNamesRefusal(
  artifact: BTPDetailsEnvelope,
  record: { permissions?: BTPTrustRecordPermissions },
): { error: BTPError; problem: string } | undefined
```

**Description:**
Since 1.2. The arrival checks a server runs against the receiver's trust record, each returning the error an artifact is refused with and why, or `undefined` when it is taken. `trustGrantProblem` and `documentTypeProblem` give the first two's `problem` alone; `detailsProblem` runs the third, then the request and value checks. `trustGrantRefusal`: an answer's `granted` against the requester's record. `documentTypeRefusal`: a `BTPS_DOC` under a trust with permissions names its `documentType`, `send:<documentType>` is granted, and a readable document is that type. `detailsNamesRefusal`: a details notice or response names only details the receiver holds of the sender (`detailsHeld`), a request only details the answerer shares (`detailsShared`). A trust without permissions (a 1.1 trust) refuses none of these by name. Exported for a platform that checks before it decides anything; the server already runs them.

---

### Key chains

```ts
signKeyRotation(
  rotation: {
    identity: string;
    from: { selector: string; publicKey?: string };
    to: { selector: string };
    at: string;
    prev: string | null;
  } & ({ expiry?: 'planned' } | { expiry: 'immediate'; compromisedSince: string; reason: 'compromised' | 'lost' }),
  keys: { from?: BTPKeyHolder; to: BTPKeyHolder },
): Promise<BTPKeyChainRecord>
signKeyExpiry(expiry: Omit<BTPKeyExpiry, 'type'>, current: BTPKeyHolder): Promise<BTPKeyChainRecord>
keyChainRecordHash(record: BTPKeyChainRecord): string
checkKeyChain(records: unknown[], identity: string): BTPCheckedKeyChain
verifyKeyChain(
  records: unknown[],
  options: { identity: string; anchors?: string[]; online?: { fromOperator: boolean; dns: BTPKeyChainDns } },
): BTPKeyChainFacts
keyChainFactsOf(checked: BTPCheckedKeyChain, options: { anchors?: string[]; online?: { fromOperator: boolean; dns: BTPKeyChainDns } }): BTPKeyChainFacts
keyChainProblem(
  records: unknown[],
  options: { identity: string; fromOperator: boolean; dns: BTPKeyChainDns; now?: number; maxSkewSeconds?: number },
): string | undefined
keyChainProblemOf(checked: BTPCheckedKeyChain, options: { fromOperator: boolean; dns: BTPKeyChainDns; now?: number; maxSkewSeconds?: number }): string | undefined
keyAt(facts: BTPKeyChainFacts, ref: { selector?: string; fingerprint?: string }): BTPKeyChainKey | undefined
keyChainSignerProblem(key: BTPKeyChainKey, options: { now?: number; retiredKeyGraceSeconds: number }): BTPError | undefined
```

**Description:**
Since 1.2. An identity's keys form a signed chain its host serves; see [Key rotation](../features/keyRotation.md).

- `signKeyRotation`: the record of key `from` handing over to `to`. Both keys sign. A rotation with immediate expiry (the old key compromised or lost) may go without `from`'s signature; then `from.publicKey` names the lost key, and the record counts only where an anchor confirms its authority. `prev` is the previous record's `keyChainRecordHash`, `null` for the first.
- `signKeyExpiry`: a key the identity already rotated away from turns out to have been compromised. The current key signs it; nothing rotates.
- `keyChainRecordHash`: what the next record names as `prev`: the lowercase hex SHA-256 of this record's signed object.
- `checkKeyChain`: checks a chain once (its shape, every signature, the chain rules) along every path. Keep the result to get facts for any anchor with `keyChainFactsOf` or `keyChainProblemOf`, without checking a signature again.
- `verifyKeyChain`: the facts about a chain, refusing nothing. `anchors` are fingerprints the reader kept; `online` says the chain came in the operator's signed answer and what DNS says (`BTPKeyChainDns`).
- `keyChainProblem`: why a verifier online refuses a chain, or `undefined`: a chain that forks, or does not end at a key DNS publishes for an identity that publishes one, is refused.
- `keyAt`: a key of a verified chain and its window, by fingerprint when given, else by selector.
- `keyChainSignerProblem`: why a live artifact signed by this key is refused now: `BTP_ERROR_KEY_REVOKED` for an expired key, `BTP_ERROR_KEY_RETIRED` for one rotated away as planned more than `retiredKeyGraceSeconds` ago. A server runs this on every arrival.

---

### signArrival

```ts
signArrival(
  arrival: { cosignatureSha256: string; arrivedAt: string; receivedBy: string; selector: string },
  holder: BTPKeyHolder,
): Promise<BTPEvidenceArrival>
```

**Description:**
Since 1.2. A platform's signed record that it received an agreement statement at `arrivedAt`, signed by `receivedBy` (the party that received it) under `selector`. It names the statement's cosignature by its `cosignatureSha256`. Sign one when each cosignature arrives and keep it for the evidence bundle's `arrivals`: it is the receiver's own record, independent of the signer. See [Evidence bundles](../features/evidenceBundles.md).

---

## Authentication helpers (`@btps/sdk/authentication`)

### keyProofPayload

```ts
keyProofPayload(agentId: string, identity: string, publicKey: string): {
  type: 'btps_key_proof';
  agentId: string;
  identity: string;
  publicKey: string;
}
```

**Description:**
What a device's new key signs when the device moves to it on an `auth.refresh`: the agent, its identity and the new key. The refresh itself is signed by the current key, so the two signatures together show one device holds both. `BtpsAuthentication.rotateKey` builds and signs it, and the server checks it; exported for a device that signs with its own code. See [Refresh tokens](../features/refreshTokens.md).

---

## BoundView (`@btps/sdk/boundview`)

The schema, bindings and checks of a document's BoundView, without the rest of the SDK, for a browser or app. `checkBoundView` and `writtenValue` are documented with [the BoundView pages](../protocol/specifications/boundview/overview.md); they also come from `@btps/sdk/server` and `@btps/sdk/client`.

| Export                | Signature or value                                       | What it does                                                                                                                                                                               |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BtpBoundViewSchema`  | zod schema                                               | A well-formed BoundView: its page, fonts as glyph outlines, images as pixels, and what is drawn, in order, within the BoundView limits                                                     |
| `boundViewResultOf`   | `(document: unknown) => BTPBoundViewResult \| undefined` | Whether an opened document's BoundView may be shown, or `undefined` when it carries none. A BoundView that is not well formed is never shown. A server hands this to transporter handlers  |
| `boundValue`          | `(document, field: string) => BoundValue \| undefined`   | What a binding's `field` names in the document, or `undefined` when a BoundView may not bind it or the document lacks it                                                                   |
| `bindingProblem`      | `(document, bind) => string \| undefined`                | Why a binding cannot be drawn from the document (its format or range), or `undefined`                                                                                                      |
| `markdownHidden`      | `(text: string) => (0 \| 1 \| 2)[]`                      | For each character of markdown text: `0` drawn, `1` a mark that may not be drawn as formatting, `2` never drawn (an escaping backslash, a link's brackets and destination, a list number)  |
| `isPathData`          | `(d: string) => boolean`                                 | Whether an outline is BoundView path data: absolute `M L H V Q C Z` commands with their numbers, starting with `M`                                                                         |
| `CONTRAST_WORK_LIMIT` | `20_000_000`                                             | The most edge and point tests the contrast check makes on one BoundView; one that needs more fails, so a crafted one cannot make a receiver work without end. Also from `@btps/sdk/server` |

The types `BoundValue` and `BTPBoundViewCheck` are in [Types & Interfaces](./typesAndInterfaces.md#boundvalue).

---

## Error Handling (`@btps/sdk/error`)

### transformToBTPErrorException

```ts
transformToBTPErrorException(
  err: unknown,
  options?: {
    cause?: unknown;
    meta?: Record<string, unknown>;
  }
): BTPErrorException
```

**Description:**
Converts any error (native, string, or unknown) into a `BTPErrorException` for consistent error handling.

**Arguments:**

- `err` (`unknown`, required): The error to transform.
- `options` (`object`, optional): Additional error context.
  - `cause` (`unknown`, optional): Original cause of the error.
  - `meta` (`Record<string, unknown>`, optional): Additional metadata.

**Returns:**

- `BTPErrorException`: The wrapped error.

**Example:**

```js
import { transformToBTPErrorException } from '@btps/sdk/error';
try {
  // Some operation that might fail
} catch (error) {
  const btpError = transformToBTPErrorException(error, {
    cause: 'DNS resolution failed',
    meta: { domain: 'example.com' },
  });
  console.error('BTPS Error:', btpError.message);
  console.log('Error code:', btpError.code);
  console.log('Error cause:', btpError.cause);
  console.log('Error meta:', btpError.meta);
}
```

## Error Constants (`@btps/sdk/error`)

A constant a server sends carries a `status`: the numeric `status.code` it is answered with, while its `code` goes out as `status.error`. See [Status Codes](../protocol/specifications/responses.md#status-codes) for each status and whether a sender should send again. Middleware can send its own error with a numeric `code` (for example `{ code: 402, message: 'Payment required' }`) with `res.sendError`, which goes out as given. A plain object middleware sends with `res.sendError` is the platform's own answer and goes out as given, its own string `code` and `status` included. Anything thrown, and any `Error` passed to `res.sendError` as caught, is told only by a BTPS constant's code, with that constant's status and its message (or that message followed by `: ` and a detail); any other (a database's duplicate-key error, an SDK's error with `status: 403` and `code: 'AccessDenied'`) goes out as the generic `500` below, its code and message kept with the server. Since 1.2, a 429 sent as a `BTPErrorException` whose `meta.retryAfter` is whole seconds, zero or more, also goes out with it as `status.retryAfter`, for example `res.sendError(new BTPErrorException(BTP_ERROR_RATE_LIMITER, { meta: { retryAfter: 30 } }))`. Nothing else from `meta` reaches the wire, and `cause` never does. Since 1.2, an answer after which the server ends the connection carries `status.closing: true`, so a `BtpsClient` sends its next artifact on a new connection. Any other error is treated as internal and answered `500` with `BTP_UNKNOWN_ERROR`, so its detail never reaches the wire.

### BTP_ERROR_IDENTITY

```ts
const BTP_ERROR_IDENTITY: BTPError;
```

**Description:**
Error constant for invalid BTPS identity format (must be `username$domain`).

**Properties:**

- `code`: `'BTP_ERROR_IDENTITY'`
- `message`: `'BTPS identity is expected in the format username$domain.'`

**Example:**

```js
import { BTP_ERROR_IDENTITY } from '@btps/sdk/error';
throw new BTPErrorException(BTP_ERROR_IDENTITY);
```

---

### BTP_ERROR_TRUST_NON_EXISTENT

```ts
const BTP_ERROR_TRUST_NON_EXISTENT: BTPError;
```

**Description:**
Error constant for a never-trusted sender: no trust record exists between sender and receiver. On the wire this is reported as `BTP_ERROR_TRUST_NOT_ALLOWED` (see below); a receiver's server-side context keeps this more precise code.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_NON_EXISTENT'`
- `message`: `'BTPS trust record does not exist'`

---

### BTP_ERROR_TRUST_BLOCKED

```ts
const BTP_ERROR_TRUST_BLOCKED: BTPError;
```

**Description:**
Error constant for blocked trust requests.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_BLOCKED'`
- `message`: `'BTPS trust request is not allowed. Contact receiver'`

---

### BTP_ERROR_TRUST_NOT_ALLOWED

```ts
const BTP_ERROR_TRUST_NOT_ALLOWED: BTPError;
```

**Description:**
Error constant for trust requests not allowed at this time.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_NOT_ALLOWED'`
- `message`: `'BTPS trust request is not allowed at this time. Contact receiver'`

This is also the response a sender receives for a **revoked** trust record: on the wire, revoked and never-trusted produce an identical response body (the same `message`), so a sender who was removed cannot tell their refusal apart from one who was never trusted. The server's own context keeps the precise reason (see `BTP_ERROR_TRUST_REVOKED` below).

On the wire it is `status.code` `403` with `status.error` `'BTP_ERROR_TRUST_NOT_ALLOWED'`.

---

### BTP_ERROR_TRUST_EXPIRED

```ts
const BTP_ERROR_TRUST_EXPIRED: BTPError;
```

**Description:**
Error constant for a trust record that was `accepted` and whose `expiresAt` has since passed. A `blocked`, `rejected`, or `pending` record with a past `expiresAt` is reported under its own status instead — it is not "expired". Unlike a revoked or never-existent trust, an expired trust produces its own `status.error` and `message` on the wire, so a sender can tell the difference and know a request may re-establish trust. An un-upgraded peer that does not recognize it must still treat it as a refusal (not-allowed), which is why `status.ok` and `status.code` (`403`) stay identical to a plain not-allowed refusal.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_EXPIRED'`
- `message`: `'BTPS trust record has expired'`

---

### BTP_ERROR_TRUST_REVOKED

```ts
const BTP_ERROR_TRUST_REVOKED: BTPError;
```

**Description:**
Server-side-only error constant for a trust record with `status: 'revoked'`. This code never reaches the wire — a receiver reports `BTP_ERROR_TRUST_NOT_ALLOWED` to the sender instead, so revocation cannot be distinguished from a sender who was never trusted.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_REVOKED'`
- `message`: `'BTPS trust record has been revoked'`

---

### BTP_ERROR_EVENT_UNRELATED

```ts
const BTP_ERROR_EVENT_UNRELATED: BTPError;
```

**Description:**
Server-side-only error constant for a `BTPS_EVENT` whose `relatesTo` the trust store does not know as an artifact between the event's two parties (see `isKnownArtifact` on [AbstractTrustStore](./classApiReference.md#isknownartifact)). Like a revoked trust, it never reaches the wire: the sender receives `BTP_ERROR_TRUST_NOT_ALLOWED`.

**Properties:**

- `code`: `'BTP_ERROR_EVENT_UNRELATED'`
- `message`: `'Event does not relate to an artifact exchanged between its parties'`

---

### BTP_ERROR_EVENT_CHAIN

```ts
const BTP_ERROR_EVENT_CHAIN: BTPError;
```

**Description:**
Since 1.2. Error constant for a lifecycle event whose chain is wrong: a `withdrawn` or `follows` from the invoice's issuer rather than the payer, a `withdrawn` that does not take back the payer's own open proposal about the same invoice, or a proposal whose `follows` names no `withdrawn` about the same invoice. It concerns the sender's own events, so unlike `BTP_ERROR_EVENT_UNRELATED` it reaches the wire, with the broken rule appended to the message. The `eventChainCheck` middleware raises it in flight; a platform raises it itself from `lifecycleEventChainProblem` (`@btps/sdk/server`) for an encrypted event once opened. The server never raises it.

**Properties:**

- `code`: `'BTP_ERROR_EVENT_CHAIN'`
- `message`: `'Event names an earlier event it cannot follow or withdraw'`
- `status`: `400`

---

### BTP_ERROR_AGREEMENT_ORDER

```ts
const BTP_ERROR_AGREEMENT_ORDER: BTPError;
```

**Description:**
Since 1.2. Error constant for an agreement's answer that is not its sender's turn: from someone who is not a signer, a signer's second answer, out of turn in a sequential agreement, or after a decline. The platform's own `agreementOrderCheck` middleware raises it in flight, with the broken rule in its message; the server itself never does.

**Properties:**

- `code`: `'BTP_ERROR_AGREEMENT_ORDER'`
- `message`: `"Answer is not its sender's turn"`
- `status`: `400`

---

### BTP_ERROR_TRUST_ALREADY_ACTIVE

```ts
const BTP_ERROR_TRUST_ALREADY_ACTIVE: BTPError;
```

**Description:**
Error constant for already active trust records. Since 1.2, an active trust still takes a change (`change: true`) while none is pending; on the wire, every trust request refusal reads `BTP_ERROR_TRUST_NOT_ALLOWED`.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_ALREADY_ACTIVE'`
- `message`: `'BTPS trust record already exist. Request invalid'`

---

### BTP_ERROR_RESOLVE_PUBKEY

```ts
const BTP_ERROR_RESOLVE_PUBKEY: BTPError;
```

**Description:**
Error constant for missing or invalid public key resolution.

**Properties:**

- `code`: `'BTP_ERROR_RESOLVE_PUBKEY'`
- `message`: `'No valid public-key found'`

---

### BTP_ERROR_RATE_LIMITER

```ts
const BTP_ERROR_RATE_LIMITER: BTPError;
```

**Description:**
Error constant for exceeding allowed request rate.

**Properties:**

- `code`: `'BTP_ERROR_RATE_LIMITER'`
- `message`: `'Too many request than its allowed'`

---

### BTP_ERROR_INVALID_JSON

```ts
const BTP_ERROR_INVALID_JSON: BTPError;
```

**Description:**
Error constant for invalid JSON format.

**Properties:**

- `code`: `'BTP_ERROR_INVALID_JSON'`
- `message`: `'Invalid JSON format'`

---

### BTP_ERROR_CANONICAL_JSON

```ts
const BTP_ERROR_CANONICAL_JSON: BTPError;
```

**Description:**
A payload has no RFC 8785 canonical form: it is not JSON, or it names a member twice. `canonicalize`, `canonicalizeValue` and `assertStrictJson` throw it, so signing or verifying such a payload fails. A server answers a line it cannot read this way with `BTP_ERROR_INVALID_JSON`.

**Properties:**

- `code`: `'BTP_ERROR_CANONICAL_JSON'`
- `message`: `'Payload cannot be canonicalized (RFC 8785)'`
- `status`: `400`

---

### BTP_ERROR_VALIDATION

```ts
const BTP_ERROR_VALIDATION: BTPError;
```

**Description:**
Error constant for BTPS artifact validation failures.

**Properties:**

- `code`: `'BTP_ERROR_VALIDATION'`
- `message`: `'BTPS artifact validation failed'`

---

### BTP_ERROR_SIG_MISMATCH

```ts
const BTP_ERROR_SIG_MISMATCH: BTPError;
```

**Description:**
Error constant for signature fingerprint mismatches.

**Properties:**

- `code`: `'BTP_ERROR_SIG_MISMATCH'`
- `message`: `'fingerprint mis-match'`

---

### BTP_ERROR_SIG_VERIFICATION

```ts
const BTP_ERROR_SIG_VERIFICATION: BTPError;
```

**Description:**
Error constant for signature verification failures. Since 1.2, also a server's refusal of an artifact whose cosignatures do not hold (`cosignaturesProblem`), and `decryptVerify`'s of a cosignature for its receiver that does not open to exactly what was signed; `meta.reason` says which rule broke.

**Properties:**

- `code`: `'BTP_ERROR_SIG_VERIFICATION'`
- `message`: `' Signature verification failed'`

---

### BTP_ERROR_DELEGATION_SIG_VERIFICATION

```ts
const BTP_ERROR_DELEGATION_SIG_VERIFICATION: BTPError;
```

**Description:**
Error constant for delegation signature verification failures.

**Properties:**

- `code`: `'BTP_ERROR_DELEGATION_SIG_VERIFICATION'`
- `message`: `'Delegation signature verification failed'`

---

### BTP_ERROR_ATTESTATION_VERIFICATION

```ts
const BTP_ERROR_ATTESTATION_VERIFICATION: BTPError;
```

**Description:**
Error constant for attestation verification failures.

**Properties:**

- `code`: `'BTP_ERROR_ATTESTATION_VERIFICATION'`
- `message`: `'Attestation verification failed'`

---

### BTP_ERROR_DELEGATION_INVALID

```ts
const BTP_ERROR_DELEGATION_INVALID: BTPError;
```

**Description:**
Error constant for invalid delegations.

**Properties:**

- `code`: `'BTP_ERROR_DELEGATION_INVALID'`
- `message`: `'Delegation is invalid'`

---

### BTP_ERROR_UNSUPPORTED_ENCRYPT

```ts
const BTP_ERROR_UNSUPPORTED_ENCRYPT: BTPError;
```

**Description:**
Error constant for unsupported encryption algorithms.

**Properties:**

- `code`: `'BTP_ERROR_UNSUPPORTED_ENCRYPT'`
- `message`: `'Unsupported encryption algorithm'`

---

### BTP_ERROR_DECRYPTION_UNINTENDED

```ts
const BTP_ERROR_DECRYPTION_UNINTENDED: BTPError;
```

**Description:**
Error constant for decryption failures when message was not intended for this receiver.

**Properties:**

- `code`: `'BTP_ERROR_DECRYPTION_UNINTENDED'`
- `message`: `'Decryption failed: Message was not intended for this receiver.'`

---

### BTP_ERROR_UNKNOWN

```ts
const BTP_ERROR_UNKNOWN: BTPError;
```

**Description:**
Error constant for unknown errors.

**Properties:**

- `code`: `'BTP_UNKNOWN_ERROR'`
- `message`: `'Unknown error'`

---

### BTP_ERROR_SOCKET_TIMEOUT

```ts
const BTP_ERROR_SOCKET_TIMEOUT: BTPError;
```

**Description:**
Error constant for socket timeouts.

**Properties:**

- `code`: `'BTP_ERROR_SOCKET_TIMEOUT'`
- `message`: `'Socket timeout. Connection closed'`

---

### BTP_ERROR_AGENT_ID

```ts
const BTP_ERROR_AGENT_ID: BTPError;
```

**Description:**
Error constant for an agent artifact, other than `auth.request`, whose `agentId` is an identity rather than a device id the server issued. It is refused before any key is looked up, so a trusted business cannot sign with its own key and act as one of the receiver's devices.

**Properties:**

- `code`: `'BTP_ERROR_AGENT_ID'`
- `message`: `'An agent id names a registered device, not an identity'`

---

### BTP_ERROR_KEY_ROTATION_PROOF

```ts
const BTP_ERROR_KEY_ROTATION_PROOF: BTPError;
```

**Description:**
Error constant for an `auth.refresh` that names a new device key without a `keyProof` signed by that key, or with one that does not verify. The refresh is refused before the platform's handler runs (see `BtpsAuthentication.rotateKey`).

**Properties:**

- `code`: `'BTP_ERROR_KEY_ROTATION_PROOF'`
- `message`: `'A new device key needs a proof signed by that key'`

---

### BTP_ERROR_SYNC_NOT_ALLOWED

```ts
const BTP_ERROR_SYNC_NOT_ALLOWED: BTPError;
```

**Description:**
Since 1.2. Error constant for a transporter artifact with `syncOf` sent to a server directly. A sync comes only inside an `artifact.send` from a live device of its own address, so a server refuses one sent any other way before its signature is checked.

**Properties:**

- `code`: `'BTP_ERROR_SYNC_NOT_ALLOWED'`
- `message`: `"A sync comes only from a device of its own address, inside that device's artifact.send"`

---

### BTP_ERROR_PERMISSION

```ts
const BTP_ERROR_PERMISSION: BTPError;
```

**Description:**
Since 1.2. Error constant for something a trust's permissions do not cover: a trust answer granting a name its request never asked for, or answering an accepted trust with no change pending. Status 403.

**Properties:**

- `code`: `'BTP_ERROR_PERMISSION'`
- `message`: `'This trust does not permit it'`

---

### BTP_ERROR_PERMISSION_REQUIRED

```ts
const BTP_ERROR_PERMISSION_REQUIRED: BTPError;
```

**Description:**
Since 1.2. Error constant for a trust answer that leaves out a permission its request requires, or whose `granted` cannot be checked because the requester's trust record has no permissions. Status 403.

**Properties:**

- `code`: `'BTP_ERROR_PERMISSION_REQUIRED'`
- `message`: `'The answer does not grant every permission the request requires'`

---

### BTP_ERROR_DOCUMENT_TYPE_MISMATCH

```ts
const BTP_ERROR_DOCUMENT_TYPE_MISMATCH: BTPError;
```

**Description:**
Since 1.2. Error constant for a document whose `type` is not the `documentType` its envelope names: refused on arrival when the document is readable, by `decryptVerify` when it is opened, and by `signEncrypt` before it is sent. Status 400.

**Properties:**

- `code`: `'BTP_ERROR_DOCUMENT_TYPE_MISMATCH'`
- `message`: `'The document is not the type its envelope names'`

---

### BTP_ERROR_DETAILS_NOT_HELD

```ts
const BTP_ERROR_DETAILS_NOT_HELD: BTPError;
```

**Description:**
Since 1.2. Error constant for a details refresh naming a detail the receiver (of a notice or response) or the answerer (of a request) does not hold by the trust, or arriving over a trust without permissions. Status 403.

**Properties:**

- `code`: `'BTP_ERROR_DETAILS_NOT_HELD'`
- `message`: `'That detail is not held by this trust'`

---

### BTP_ERROR_DETAILS_RATE_LIMITED

```ts
const BTP_ERROR_DETAILS_RATE_LIMITED: BTPError;
```

**Description:**
Since 1.2. Error constant for a details request over the limit its provider sets (`detailsRequestLimit`). Status 429. Its `meta.retryAfter` is the whole seconds the provider gave, and goes out as `status.retryAfter`, so the asker knows how long to wait before asking again.

**Properties:**

- `code`: `'BTP_ERROR_DETAILS_RATE_LIMITED'`
- `message`: `'Too many details requests on this trust. Ask again later'`

---

### BTP_ERROR_KEY_TOO_OLD

```ts
const BTP_ERROR_KEY_TOO_OLD: BTPError;
```

**Description:**
Since 1.2. Error constant for a refresh signed by a device key older than the server's `maxKeyAgeMs`. The refresh token stays usable, so the device moves to a new key with it (`BtpsAuthentication.rotateKey`).

**Properties:**

- `code`: `'BTP_ERROR_KEY_TOO_OLD'`
- `message`: `'This device key is older than the server allows. Move to a new key first'`

---

### BTP_ERROR_KEY_RETIRED

```ts
const BTP_ERROR_KEY_RETIRED: BTPError;
```

**Description:**
Since 1.2. An artifact signed by a key its identity rotated away from as planned, longer ago than the receiver's `retiredKeyGraceSeconds`. A stale key: sign again with the current one. See [Key Rotation](../protocol/specifications/key-rotation.md).

**Properties:**

- `code`: `'BTP_ERROR_KEY_RETIRED'`
- `message`: `'The key that signed this is retired. Sign with the current key'`
- `status`: `401`

---

### BTP_ERROR_KEY_REVOKED

```ts
const BTP_ERROR_KEY_REVOKED: BTPError;
```

**Description:**
Since 1.2. An artifact signed by a key its identity rotated away from with immediate expiry, or expired with an expiry record: compromised or lost. Refused whatever the artifact's own time says. A security incident, not a stale key. See [Key Rotation](../protocol/specifications/key-rotation.md).

**Properties:**

- `code`: `'BTP_ERROR_KEY_REVOKED'`
- `message`: `'The key that signed this is revoked: it may be in other hands'`
- `status`: `401`

---

### BTP_ERROR_ARTIFACT_TIME_WINDOW

```ts
const BTP_ERROR_ARTIFACT_TIME_WINDOW: BTPError;
```

**Description:**
Error constant for a signed artifact whose `issuedAt` is outside the receiving server's time window (`maxArtifactAgeSeconds`, see [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions)). The server sends it with its window appended to the message and keeps the connection open. A genuine sender signs the artifact again, with a new `issuedAt`.

**Properties:**

- `code`: `'BTP_ERROR_ARTIFACT_TIME_WINDOW'`
- `message`: `'Artifact was not issued within the time window of this server'`, sent as for example `'Artifact was not issued within the time window of this server: 300 seconds'`

---

### BTP_ERROR_ARTIFACT_TOO_LARGE

```ts
const BTP_ERROR_ARTIFACT_TOO_LARGE: BTPError;
```

**Description:**
Error constant for an artifact larger than the receiving server's limit (`maxArtifactSizeKb`, see [BtpsServerOptions](./typesAndInterfaces.md#btpsserveroptions)). The server refuses it before reading it in full, sends this error with its limit appended to the message, and closes the connection. A sender that sees it can split its files across further documents that reference the first.

**Properties:**

- `code`: `'BTP_ERROR_ARTIFACT_TOO_LARGE'`
- `message`: `'Artifact exceeds the size limit of this server'`, sent as for example `'Artifact exceeds the size limit of this server: 65536 KB'`

---

### BTP_ERROR_ARTIFACT_NOT_ACCEPTED

```ts
const BTP_ERROR_ARTIFACT_NOT_ACCEPTED: BTPError;
```

**Description:**
Error constant for an artifact the receiving server has nothing to take: no handler registered with `onIncomingArtifact` for its type, no `forwardTo` handler and no `before` `onArtifact` middleware (an `after` step, such as metrics, runs once delivery is done and takes nothing). The server refuses it instead of answering success, and logs a warning, as it also does when it starts without one.

**Properties:**

- `code`: `'BTP_ERROR_ARTIFACT_NOT_ACCEPTED'`
- `message`: `'This server does not accept this kind of artifact'`

---

### BTP_ERROR_TEMPORARILY_UNAVAILABLE

```ts
const BTP_ERROR_TEMPORARILY_UNAVAILABLE: BTPError;
```

**Description:**
Error constant for a trust or identity store to throw when it is briefly unreachable, such as a database failing over. The server answers it as `503`, so the sender sends the same artifact again later, instead of the `500` an unexpected error gets. Like every error on one artifact, it leaves the connection open for the others.

**Properties:**

- `code`: `'BTP_ERROR_TEMPORARILY_UNAVAILABLE'`
- `message`: `'The server cannot take this artifact right now. Send it again later'`
- `status`: `503`

---

### BTP_ERROR_VERSION_UNSUPPORTED

```ts
const BTP_ERROR_VERSION_UNSUPPORTED: BTPError;
```

**Description:**
Error constant for an artifact whose `version` the receiving server does not support. A 1.2 server accepts any 1.1.x and 1.2.x, and a 1.1 server only 1.1.x; both refuse 1.0. It is checked before any signature work, and the supported versions are appended to the message.

A 1.2 client turns such a refusal into this error, with `meta.receiverVersion` set to the version of the receiver's answer: the version the receiver speaks. `send` then returns the error and the answer together. A `PING` is always stamped `1.1.0`, so every 1.1 and 1.2 server answers it. An identity lookup goes out as `1.2.0`, and when a 1.1 host refuses that version with this error, the client asks again as `1.1.0`.

**Properties:**

- `code`: `'BTP_ERROR_VERSION_UNSUPPORTED'`
- `message`: `'This server does not support the artifact protocol version'`, sent as for example `'This server does not support the artifact protocol version: supports 1.1.0 to 1.2.0'` (a 1.1 server says `supports 1.1.0 to 1.1.0`)
- `status`: `400`

---

### BTP_ERROR_PRIVACY_TYPE

```ts
const BTP_ERROR_PRIVACY_TYPE: BTPError;
```

**Description:**
Error constant for an artifact that does not use the encryption its trust agreed on (`privacyType` on the trust record). An `encrypted` trust refuses an artifact sent in the clear, an `unencrypted` trust refuses an encrypted one, and `mixed` allows either. The required type is appended to the message. Only a sender with an active trust gets this answer.

**Properties:**

- `code`: `'BTP_ERROR_PRIVACY_TYPE'`
- `message`: `'Artifact does not use the encryption its trust requires'`, sent as for example `'Artifact does not use the encryption its trust requires: encrypted'`
- `status`: `400`

---

### BTP_ERROR_AUTHENTICATION_INVALID

```ts
const BTP_ERROR_AUTHENTICATION_INVALID: BTPError;
```

**Description:**
Error constant for authentication failures.

**Properties:**

- `code`: `'BTP_ERROR_AUTHENTICATION_INVALID'`
- `message`: `'Authentication failed'`

---

### BTP_ERROR_TIMEOUT

```ts
const BTP_ERROR_TIMEOUT: BTPError;
```

**Description:**
Error constant for general timeouts.

**Properties:**

- `code`: `'BTP_ERROR_TIMEOUT'`
- `message`: `'Timeout'`

---

### BTP_ERROR_CONNECTION_CLOSED

```ts
const BTP_ERROR_CONNECTION_CLOSED: BTPError;
```

**Description:**
Error constant for closed connections.

**Properties:**

- `code`: `'BTP_ERROR_CONNECTION_CLOSED'`
- `message`: `'Connection closed'`

---

### BTP_ERROR_CONNECTION_ENDED

```ts
const BTP_ERROR_CONNECTION_ENDED: BTPError;
```

**Description:**
Error constant for ended connections.

**Properties:**

- `code`: `'BTP_ERROR_CONNECTION_ENDED'`
- `message`: `'Connection ended'`

---

### BTP_ERROR_SOCKET_CLOSED

```ts
const BTP_ERROR_SOCKET_CLOSED: BTPError;
```

**Description:**
Error constant for already closed sockets.

**Properties:**

- `code`: `'BTP_ERROR_SOCKET_CLOSED'`
- `message`: `'Socket already closed'`

---

### BTP_ERROR_IDENTITY_NOT_FOUND

```ts
const BTP_ERROR_IDENTITY_NOT_FOUND: BTPError;
```

**Description:**
Error constant for identity not found.

**Properties:**

- `code`: `'BTP_ERROR_IDENTITY_NOT_FOUND'`
- `message`: `'Identity not found'`

---

### BTPS_ERROR_ACTION_TYPE

```ts
const BTPS_ERROR_ACTION_TYPE: BTPError;
```

**Description:**
Error constant for invalid BTPS action types.

**Properties:**

- `code`: `'BTPS_ERROR_ACTION_TYPE'`
- `message`: `'BTPS action type is not valid'`

---

### BTP_ERROR_RESOLVE_DNS

```ts
const BTP_ERROR_RESOLVE_DNS: BTPError;
```

**Description:**
Error constant for DNS resolution failures.

**Properties:**

- `code`: `'BTP_ERROR_RESOLVE_DNS'`
- `message`: `'No valid DNS record found'`

---

### BTP_ERROR_INVALID_ACTION

```ts
const BTP_ERROR_INVALID_ACTION: BTPError;
```

**Description:**
Error constant for invalid actions.

**Properties:**

- `code`: `'BTP_ERROR_INVALID_ACTION'`
- `message`: `'Invalid action'`
