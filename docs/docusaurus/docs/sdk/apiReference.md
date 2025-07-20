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

### getDnsParts

```ts
getDnsParts(identity: string, type?: 'key' | 'pem' | 'version' | 'btpAddress'): Promise<any>
```

**Description:**
Resolves DNS TXT records for a BTPS identity and extracts key, version, PEM, or BTPS address information.

**Arguments:**

- `identity` (`string`, required): The BTPS identity to resolve.
- `type` (`'key' | 'pem' | 'version' | 'btpAddress'`, optional): The specific part to extract. If omitted, returns all parts.

**Returns:**

- `Promise<any>`: The requested DNS part, or an object with all parts if `type` is omitted.

**Example:**

```js
import { getDnsParts } from '@btps/sdk';
const pem = await getDnsParts('billing$company.com', 'pem');
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
resolvePublicKey(identity: string): Promise<string | undefined>
```

**Description:**
Resolves the public key PEM for a BTPS identity using DNS.

**Arguments:**

- `identity` (`string`, required): The BTPS identity to resolve.

**Returns:**

- `Promise<string | undefined>`: The PEM-formatted public key, or `undefined` if not found.

**Example:**

```js
import { resolvePublicKey } from '@btps/sdk';
const pubKey = await resolvePublicKey('billing$company.com');
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

## Cryptography (`@btps/sdk/crypto`)

### signEncrypt

```ts
signEncrypt<T>(
  to: string | undefined,
  sender: ParsedIdentity & { pemFiles: PemKeys },
  payload: {
    document: T;
    [key: string]: unknown;
  },
  options?: BTPCryptoOptions
): Promise<BTPCryptoResponse<T>>
```

**Description:**
Signs and (optionally) encrypts a BTPS document for secure transmission. Handles key lookup, encryption, and signature in one step.

**Arguments:**

- `to` (`string | undefined`, required): Recipient BTPS identity. If undefined, no encryption is performed.
- `sender` (`ParsedIdentity & { pemFiles: PemKeys }`, required): Sender identity and PEM key pair.
- `payload` (object, required): Document and metadata to send.
  - `document` (`T`, required): The document payload.
  - `[key: string]` (`unknown`): Additional metadata fields.
- `options` (`BTPCryptoOptions`, optional): Signature and encryption options.

**Returns:**

- `Promise<BTPCryptoResponse<T>>`: Signed (and encrypted) artifact and error (if any).

**Example:**

```js
import { signEncrypt } from '@btps/sdk/crypto';
const { payload, error } = await signEncrypt(
  'pay$client.com',
  { accountName: 'billing', domainName: 'vendorcorp.com', pemFiles: { publicKey, privateKey } },
  {
    type: 'btp_invoice',
    document: {
      /* ... */
    },
  },
  {
    signature: { algorithm: 'sha256' },
    encryption: { algorithm: 'aes-256-cbc', mode: 'standardEncrypt' },
  },
);
```

---

### decryptVerify

```ts
decryptVerify<T>(
  senderPubPem: string,
  encryptedPayload: VerifyEncryptedPayload<T>,
  receiverPrivatePem?: string
): Promise<BTPCryptoResponse<T>>
```

**Description:**
Verifies the signature and (optionally) decrypts a received BTPS artifact. Ensures authenticity and privacy.

**Arguments:**

- `senderPubPem` (`string`, required): Sender's public key (PEM).
- `encryptedPayload` (`VerifyEncryptedPayload<T>`, required): The received artifact.
- `receiverPrivatePem` (`string`, optional): Receiver's private key for decryption.

**Returns:**

- `Promise<BTPCryptoResponse<T>>`: Decrypted and verified artifact and error (if any).

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
  payload: unknown,
  receiverPubPem: string,
  options?: BTPCryptoOptions['encryption']
): { data: string; encryption: BTPEncryption }
```

**Description:**
Encrypts a payload using AES-256-CBC and the recipient's public key. Returns the encrypted data and encryption metadata.

**Arguments:**

- `payload` (`unknown`, required): The data to encrypt.
- `receiverPubPem` (`string`, required): Recipient's public key (PEM).
- `options` (`BTPCryptoOptions['encryption']`, optional): Encryption algorithm and mode.

**Returns:**

- `object`: `{ data, encryption }` with encrypted payload and metadata.

**Example:**

```js
import { encryptBtpPayload } from '@btps/sdk/crypto';
const encrypted = encryptBtpPayload({ foo: 'bar' }, receiverPublicKeyPem, {
  algorithm: 'aes-256-cbc',
  mode: 'standardEncrypt',
});
```

---

### decryptBtpPayload

```ts
decryptBtpPayload<T>(
  payload: unknown,
  encryption: BTPEncryption,
  receiverPrivPem: string
): { data?: T; error?: BTPErrorException }
```

**Description:**
Decrypts an AES-256-CBC encrypted payload using the receiver's private key and the provided encryption metadata.

**Arguments:**

- `payload` (`unknown`, required): The encrypted data to decrypt (base64 string or object).
- `encryption` (`BTPEncryption`, required): Encryption metadata (algorithm, key, iv, type).
- `receiverPrivPem` (`string`, required): Receiver's private key (PEM).

**Returns:**

- `object`: `{ data, error }` with decrypted payload (if successful) and error (if any).

**Example:**

```js
import { decryptBtpPayload } from '@btps/sdk/crypto';
const { data, error } = decryptBtpPayload(encryptedData, encryptionMeta, receiverPrivateKeyPem);
```

---

### encryptRSA

```ts
encryptRSA(publicKeyPem: string, data: Buffer): Buffer
```

**Description:**
Encrypts a buffer using the recipient's RSA public key (OAEP, SHA-1).

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
Decrypts an RSA-encrypted buffer using the receiver's private key (OAEP, SHA-1).

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
  algorithm?: SignatureAlgorithmType
): string
```

**Description:**
Computes a fingerprint (hash) of a PEM public key using the specified algorithm (default: `sha256`).

**Arguments:**

- `pem` (`string`, required): The PEM-formatted public key.
- `algorithm` (`SignatureAlgorithmType`, optional, default: `'sha256'`): Hash algorithm.

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
signBtpPayload(payload: unknown, senderPemFiles: PemKeys): BTPSignature
```

**Description:**
Signs a payload using the sender's private key and returns a signature object (algorithm, value, fingerprint).

**Arguments:**

- `payload` (`unknown`, required): The data to sign (object or string).
- `senderPemFiles` (`PemKeys`, required): Sender's PEM key pair.

**Returns:**

- `BTPSignature`: Signature object with algorithm, value, and fingerprint.

**Example:**

```js
import { signBtpPayload } from '@btps/sdk/crypto';
const signature = signBtpPayload({ foo: 'bar' }, { publicKey, privateKey });
```

---

### verifySignature

```ts
verifySignature(
  payload: unknown,
  signature: BTPSignature,
  senderPubKey: string
): { isValid: boolean; error?: BTPErrorException }
```

**Description:**
Verifies a payload's signature using the sender's public key and returns validity and error (if any).

**Arguments:**

- `payload` (`unknown`, required): The data to verify (object or string).
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
Validates a `btp_trust_response` by checking if the response is authorized (only the original receiver of a trust request can respond).

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
transformToBTPErrorException(err: unknown): BTPErrorException
```

**Description:**
Converts any error (native, string, or unknown) into a `BTPErrorException` for consistent error handling.

**Arguments:**

- `err` (`unknown`, required): The error to transform.

**Returns:**

- `BTPErrorException`: The wrapped error.

**Example:**

```js
import { transformToBTPErrorException } from '@btps/sdk/error';
try {
  // ...
} catch (err) {
  throw transformToBTPErrorException(err);
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
Error constant for non-existent or expired trust records.

**Properties:**

- `code`: `'BTP_ERROR_TRUST_NON_EXISTENT'`
- `message`: `'BTPS trust record does not exist or has been expired'`

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
- `message`: `' Signature verification failed'`

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

- `code`: `'BTP_UNKNOWN_ERROR'`
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
