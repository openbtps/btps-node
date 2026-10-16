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
getHostAndSelector(identity: string): Promise<{ host: string; selector: string; version: string } | undefined>
```

**Description:**
Resolves the BTPS host and selector for a given identity by querying DNS TXT records. This function is used for key rotation support, allowing multiple public keys to be published under different selectors.

**Arguments:**

- `identity` (`string`, required): The BTPS identity to resolve.

**Returns:**

- `Promise<{ host: string; selector: string; version: string } | undefined>`: Object containing the host URL, current selector, and version, or `undefined` if not found.

**Example:**

```js
import { getHostAndSelector } from '@btps/sdk';
const result = await getHostAndSelector('billing$company.com');
// result = { host: 'btps.company.com:3443', selector: 'btps1', version: '1.0.0' }
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
// Returns: { key: 'abc123', version: '1.0.0', pem: '-----BEGIN PUBLIC KEY-----...' }

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
isDelegationAllowed(artifact: BTPTransporterArtifact): boolean
```

**Description:**
Checks if an artifact can be delegated based on delegation rules and domain validation.

**Arguments:**

- `artifact` (`BTPTransporterArtifact`, required): The artifact to check.

**Returns:**

- `boolean`: `true` if delegation is allowed, `false` otherwise.

**Example:**

```js
import { isDelegationAllowed } from '@btps/sdk';
const canDelegate = isDelegationAllowed(artifact);
```

---

## Cryptography (`@btps/sdk/crypto`)

### Signer and Decrypter

The SDK signs through a `Signer` and decrypts through a `Decrypter` (BTPS 1.1). Every signing path takes one (`signBtpPayload`, `signEncrypt`, `BtpsAgent`, `BtpsDelegator` and the server's own responses), and so does every decryption path (`decryptBtpPayload`, `decryptVerify`, and the client's `resolveIdentity` and `decryptVerifyArtifact`).

```ts
interface Signer {
  readonly algorithm: 'RSASSA_PKCS1_V1_5_SHA_256';
  sign(data: Uint8Array): Promise<Uint8Array>;
  getPublicKey(): Promise<{ publicKey: string; fingerprint: string }>;
}

interface Decrypter {
  readonly algorithm: 'aes-256-gcm';
  decrypt(request: DecryptRequest): Promise<Uint8Array>;
}
```

| Class | Holds the key | Use it for |
| --- | --- | --- |
| `KmsSigner`, `KmsDecrypter` | in KMS. The key never leaves it: the SDK only sends KMS the bytes to sign, or the wrapped content key to unwrap | production |
| `PemSigner`, `PemDecrypter` | as a PEM string in the process | **tests and the interim only** |

Where an API used to take a PEM key it still does, and wraps it in a `PemSigner` or `PemDecrypter`. Pass a `Signer` or `Decrypter` instead for managed custody.

```js
import { KmsSigner, KmsDecrypter, signEncrypt, decryptVerify } from '@btps/sdk/crypto';

// `kms` is your adapter over your KMS client, e.g. @aws-sdk/client-kms:
// sign({ keyId, message }) => { signature }, getPublicKey({ keyId }) => { publicKeyPem },
// decrypt({ keyId, encryptedKey }) => { plaintextKey }.
const signer = new KmsSigner({ client: kms, keyId: 'alias/btps-sign' });
const decrypter = new KmsDecrypter({ client: kms, keyId: 'alias/btps-decrypt' });

await signEncrypt(to, { accountName, domainName, selector: 'btps1', signer }, payload, options);
await decryptVerify(senderPubPem, artifact, decrypter);
```

- A KMS failure reaches the caller as a `BTPErrorException` whose `meta.retryable` says whether retrying can help.
- Every decryption path refuses an AES-GCM tag that is not exactly 16 bytes (`BTP_ERROR_VALIDATION`), before any key is used.
- A `Decrypter` passes additional authenticated data through to the tag check unchanged.
- `toSigner(key)` and `toDecrypter(key)` turn a PEM key, or a `Signer` / `Decrypter`, into a `Signer` / `Decrypter`; `isSigner` and `isDecrypter` tell them apart.

---

### signEncrypt

```ts
signEncrypt<T>(
  to: string | undefined,
  sender: ParsedIdentity & ({ signer: Signer } | { pemFiles: PemKeys }) & { selector: string },
  payload: {
    document: T;
    encryptionSelector?: string;
    [key: string]: unknown;
  },
  options?: BTPCryptoOptions
): Promise<BTPCryptoResponse<T>>
```

**Description:**
Signs and (optionally) encrypts a BTPS document for secure transmission. The artifact names the two keys apart (BTPS 1.1): `signatureSelector` is the sender's key that signed it, and `encryptionSelector` the receiver's key it was encrypted to, so each side rotates its key on its own.

**Arguments:**

- `to` (`string | undefined`, required): Recipient BTPS identity. If undefined, no encryption is performed.
- `sender` (`ParsedIdentity & ({ signer: Signer } | { pemFiles: PemKeys }) & { selector: string }`, required): Sender identity, what signs for it, and the selector its key is published at. The selector becomes the artifact's `signatureSelector`. `signer` is a `Signer` such as `KmsSigner`; `pemFiles` is a PEM key pair, wrapped in a `PemSigner`, for tests and the interim only.
- `payload` (object, required): Document and metadata to send.
  - `document` (`T`, required): The document payload.
  - `encryptionSelector` (`string`, optional): The receiver's selector to encrypt to (e.g. from its `_btps.host` record). Required for encryption when `to` is provided; it is on the artifact only when the document is encrypted.
  - `[key: string]` (`unknown`): Additional metadata fields. The 1.0 field `selector` is refused with `BTP_ERROR_VALIDATION`.
- `options` (`BTPCryptoOptions`, optional): Signature and encryption options.

**Returns:**

- `Promise<BTPCryptoResponse<T>>`: Signed (and encrypted) artifact and error (if any).

**Example:**

```js
import { signEncrypt } from '@btps/sdk/crypto';
const { payload, error } = await signEncrypt(
  'pay$client.com',
  {
    accountName: 'billing',
    domainName: 'vendorcorp.com',
    selector: 'btps2', // where the signer's public key is published
    signer, // e.g. new KmsSigner({ client, keyId }); or pemFiles: { publicKey, privateKey } in tests
  },
  {
    type: 'BTPS_DOC',
    document: {
      /* ... */
    },
    encryptionSelector: 'btps1', // the receiver key to encrypt to
  },
  {
    signature: { algorithmHash: 'sha256' },
    encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
  },
);
// payload.signatureSelector === 'btps2', payload.encryptionSelector === 'btps1'
```

---

### decryptVerify

```ts
decryptVerify<T>(
  senderPubPem: string,
  encryptedPayload: VerifyEncryptedPayload<T>,
  receiverKeys?: BTPDecryptionKeys
): Promise<BTPCryptoResponse<T>>
```

**Description:**
Verifies the signature and (optionally) decrypts a received BTPS artifact. Ensures authenticity and privacy.

**Arguments:**

- `senderPubPem` (`string`, required): Sender's public key (PEM) at the artifact's `signatureSelector`; `resolveSignatureKey(artifact)` resolves it.
- `encryptedPayload` (`VerifyEncryptedPayload<T>`, required): The received artifact.
- `receiverKeys` (`BTPDecryptionKeys`, optional): The receiver's `Decrypter` (or private key PEM, for tests and the interim), or a lookup asked for the `Decrypter` or PEM at the artifact's `encryptionSelector`. With a lookup, a receiver that rotated keeps decrypting documents encrypted to its old key; an encrypted artifact with no `encryptionSelector` is refused (`BTP_ERROR_VALIDATION`), and a selector the lookup has no key for gives `BTP_ERROR_DECRYPTION_UNINTENDED`.

**Returns:**

- `Promise<BTPCryptoResponse<T>>`: Decrypted and verified artifact and error (if any).

**Example:**

```js
import { decryptVerify, resolveSignatureKey } from '@btps/sdk/crypto';
const receiverKeys = { btps1: oldKeyDecrypter, btps2: currentKeyDecrypter }; // e.g. KmsDecrypter
const { payload, error } = await decryptVerify(
  await resolveSignatureKey(artifact),
  artifact,
  (encryptionSelector) => receiverKeys[encryptionSelector],
);
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
  options?: BTPCryptoOptions['encryption']
): { data: string; encryption: BTPEncryption }
```

**Description:**
Encrypts a payload using AES-256-GCM and the recipient's public key. Returns the encrypted data and encryption metadata.

**Arguments:**

- `payload` (`unknown`, required): The data to encrypt (defaults to empty string).
- `receiverPubPem` (`string`, required): Recipient's public key (PEM).
- `options` (`BTPCryptoOptions['encryption']`, optional): Encryption algorithm and mode.

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
  receiverKey: Decrypter | string
): Promise<{ data?: T; error?: BTPErrorException }>
```

**Description:**
Decrypts an AES-256-GCM encrypted payload through the receiver's `Decrypter`, using the provided encryption metadata. A tag that is not exactly 16 bytes is refused with `BTP_ERROR_VALIDATION` before any key is used. Async since BTPS 1.1.

**Arguments:**

- `payload` (`unknown`, required): The encrypted data to decrypt (base64 string or object, defaults to empty string).
- `encryption` (`BTPEncryption`, required): Encryption metadata (algorithm, key, iv, type).
- `receiverKey` (`Decrypter | string`, required): The receiver's `Decrypter`, or its private key PEM, wrapped in a `PemDecrypter` (tests and the interim only).

**Returns:**

- `Promise<object>`: `{ data, error }` with decrypted payload (if successful) and error (if any).

**Example:**

```js
import { decryptBtpPayload } from '@btps/sdk/crypto';
const { data, error } = await decryptBtpPayload(encryptedData, encryptionMeta, decrypter);
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
signBtpPayload(payload: unknown = '', signingKey: Signer | PemKeys): Promise<BTPSignature>
```

**Description:**
Signs the RFC 8785 (JCS) form of a payload through a `Signer` and returns a signature object (algorithmHash, value, fingerprint). The fingerprint is of the public key the signer reports. Async since BTPS 1.1.

**Arguments:**

- `payload` (`unknown`, required): The data to sign (object or string, defaults to empty string).
- `signingKey` (`Signer | PemKeys`, required): The sender's `Signer`, or its PEM key pair, wrapped in a `PemSigner` (tests and the interim only).

**Returns:**

- `Promise<BTPSignature>`: Signature object with algorithmHash, value, and fingerprint.

**Example:**

```js
import { signBtpPayload } from '@btps/sdk/crypto';
const signature = await signBtpPayload({ foo: 'bar' }, signer); // a Signer, e.g. KmsSigner
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
Verifies a payload's signature using the sender's public key and returns validity and error (if any).

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

### validateTrustResponse

```ts
validateTrustResponse(
  senderId: string,
  receiverId: string,
  trustStore: AbstractTrustStore<BTPTrustRecord>
): Promise<{ isValid: boolean; error?: BTPErrorException }>
```

**Description:**
Validates a `TRUST_RES` by checking if the response is authorized (only the original receiver of a trust request can respond).

**Arguments:**

- `senderId` (`string`, required): The identity sending the trust response (responder).
- `receiverId` (`string`, required): The identity receiving the trust response (original requester).
- `trustStore` (`AbstractTrustStore<BTPTrustRecord>`, required): The trust store instance.

**Returns:**

- `Promise<object>`: `{ isValid, error }` with validity and error (if any).

**Example:**

```js
import { validateTrustResponse } from '@btps/sdk/trust';
const { isValid, error } = await validateTrustResponse('userB$domain', 'userA$domain', trustStore);
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

This is also the response a sender receives for a **revoked** trust record: on the wire, revoked and never-trusted produce an identical response body (the same `code`, `message` and `status.code` 403), so a sender who was removed cannot tell their refusal apart from one who was never trusted. The server's own context keeps the precise reason (see `BTP_ERROR_TRUST_REVOKED` below).

Since BTPS 1.1 every error response carries its stable `code` and the status class of that code; see [Wire Errors](../protocol/specifications/wire-errors.md) for the table, which also says which codes are retryable.

---

### BTP_ERROR_TRUST_EXPIRED

```ts
const BTP_ERROR_TRUST_EXPIRED: BTPError;
```

**Description:**
Error constant for a trust record that was `accepted` and whose `expiresAt` has since passed. A `blocked`, `rejected`, or `pending` record with a past `expiresAt` is reported under its own status instead — it is not "expired". Unlike a revoked or never-existent trust, an expired trust goes out with its own `code` on the wire, so a sender can tell the difference and know a request may re-establish trust. `status.ok` and `status.code` (403) stay identical to a plain not-allowed refusal, and neither is retryable.

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

### BTP_ERROR_TRUST_ALREADY_ACTIVE

```ts
const BTP_ERROR_TRUST_ALREADY_ACTIVE: BTPError;
```

**Description:**
Error constant for already active trust records.

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
Error constant for signature verification failures.

**Properties:**

- `code`: `'BTP_ERROR_SIG_VERIFICATION'`
- `message`: `'Signature verification failed'`

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

- `code`: `'BTP_ERROR_UNKNOWN'` (it was `'BTP_UNKNOWN_ERROR'` before BTPS 1.1)
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
Error constant for signature verification failures.

**Properties:**

- `code`: `'BTP_ERROR_SIG_VERIFICATION'`
- `message`: `'Signature verification failed'`

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
Error constant for decryption attempts by unintended recipients.

**Properties:**

- `code`: `'BTP_ERROR_DECRYPTION_UNINTENDED'`
- `message`: `'Decryption failed: Message was not intended for this receiver.'`

---

### BTP_ERROR_UNKNOWN

```ts
const BTP_ERROR_UNKNOWN: BTPError;
```

**Description:**
Error constant for unknown or unexpected errors.

**Properties:**

- `code`: `'BTP_ERROR_UNKNOWN'` (it was `'BTP_UNKNOWN_ERROR'` before BTPS 1.1)
- `message`: `'Unknown error'`

---

### BTP_ERROR_AUTHENTICATION_INVALID

```ts
const BTP_ERROR_AUTHENTICATION_INVALID: BTPError;
```

**Description:**
Error constant for invalid authentication.

**Properties:**

- `code`: `'BTP_ERROR_AUTHENTICATION_INVALID'`
- `message`: `'Invalid authentication'`

---
