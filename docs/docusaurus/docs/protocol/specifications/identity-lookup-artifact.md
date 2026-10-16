---
title: Identity Lookup Artifact Specification
sidebar_label: Identity Lookup Artifact
---

# Identity Lookup Artifact Specification

An identity lookup asks an address's host for the address's public key, when
the address has no identity record of its own in DNS. A SaaS platform such
as `ebilladdress.com` cannot publish a DNS record for every user like
`john$ebilladdress.com`; its BTPS host answers for them instead, from its
identity store, with a response signed by its own key.

## Key lookup: DNS first, then the host

To find the key of an address `account$domain`, a client:

1. Reads the domain's host record, `_btps.host.<domain>`
   (`v=…; u=<host>:<port>; s=<selector>`).
2. **DNS first.** Looks up the address's own identity record,
   `<selector>._btps.identity.<account>.<domain>`
   (`v=…; k=rsa; p=<base64 SPKI>`). If there is one, that is the key, and
   the host is never asked.
3. **Then the host.** Only when DNS answers that the record does not exist
   (`ENOTFOUND` or `ENODATA`, or an empty answer), the client opens a TLS
   connection to the host from step 1 and sends an identity lookup request.
   Any other DNS failure (a timeout, `SERVFAIL`) is an error: the client
   does not turn a resolver it cannot reach into a question for the host.
4. Checks the host's answer (below) and uses the key record it carries.

A TXT record's tags are separated by `;`, and each `tag=value` is split on
its **first** `=` only: the base64 key of a 3072-bit or 4096-bit RSA key
ends in `=` padding, which is part of the value. A record longer than 255
characters arrives as several strings, which are joined without separators.
A record with no `p=` tag is refused, not read as an empty key.

## Request: `BTPIdentityLookupRequest`

```json
{
  "version": "1.1.0",
  "id": "4c0c2f0e-6b7a-4f53-9d55-2f6c1f3a9e11",
  "issuedAt": "2026-10-16T10:30:00.000Z",
  "identity": "john$ebilladdress.com",
  "from": "billing$vendorcorp.com",
  "hostSelector": "btps1"
}
```

### Required fields

- **version**: protocol version
- **id**: unique request id (UUID v4). The answer names it as `reqId`.
- **issuedAt**: ISO 8601 time the request was made
- **identity**: the address whose key is wanted
- **from**: the requesting party's address
- **hostSelector**: the selector the client read from `_btps.host` (`s=`).
  Informational: the host signs at its own selector, below.

### Optional fields

- **identitySelector**: the selector of the address's key wanted. Without
  it, the host answers with the address's current key.

The request is one line of JSON, ended by `\n`. It is not signed.

## Response

### Found

```json
{
  "version": "1.1.0",
  "status": { "ok": true, "code": 200, "message": "success" },
  "id": "9b1e3a52-0d1f-4d8c-8a0e-5b2c7e6f4d21",
  "issuedAt": "2026-10-16T10:30:00.100Z",
  "type": "btps_response",
  "reqId": "4c0c2f0e-6b7a-4f53-9d55-2f6c1f3a9e11",
  "document": {
    "selector": "btps1",
    "publicKey": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    "keyType": "rsa",
    "version": "1.1.0"
  },
  "signedBy": "admin$ebilladdress.com",
  "signatureSelector": "host1",
  "signature": {
    "algorithmHash": "sha256",
    "value": "base64-encoded-signature",
    "fingerprint": "sha256-base64-fingerprint"
  }
}
```

- **document** (`BTPIdentityResDoc`): the address's key record.

  - **selector**: the selector of the address's key
  - **publicKey**: the public key, PEM (SPKI)
  - **keyType**: `rsa`
  - **version**: the record's version

  Only these four fields are sent: what else the host stores (such as
  `createdAt`) stays with it.

- **signedBy**: the host's own identity, which publishes its key in DNS.
- **signatureSelector**: the selector of the host's key that signed, at
  `<signatureSelector>._btps.identity.<account>.<domain>` of `signedBy`.
  It is the host's own selector, set in its configuration
  (`serverIdentity.selector` in this SDK), and not the request's
  `hostSelector`. 1.0 named this field `selector`, which 1.1 refuses.
- There is no `encryption` member on an unencrypted answer, and the
  response schema refuses `encryption: null`.

The signature is over the RFC 8785 (JCS) canonical form of the response
without `signature`, as for every signed response
([Responses](./responses.md)).

### Not found

```json
{
  "version": "1.1.0",
  "status": { "ok": false, "code": 500, "message": "Identity not found" },
  "id": "0f6d1c2b-1a3e-4c55-8f0a-7e2d9b4c6a33",
  "issuedAt": "2026-10-16T10:30:00.100Z",
  "type": "btps_error",
  "reqId": "4c0c2f0e-6b7a-4f53-9d55-2f6c1f3a9e11"
}
```

## What the client checks

A client accepts the answer, and uses its key record, only when all of
these hold (`verifyIdentityLookupResponse` in `@btps/sdk/crypto`):

1. It is a valid server response of type `btps_response` with
   `status.ok`. An error answer means the host does not have the address.
2. `reqId` is the request's `id`.
3. It is signed: `signature`, `signedBy` and `signatureSelector` are all
   present.
4. `signedBy` is an identity of the **looked-up address's own domain**. A
   domain vouches only for its own addresses: an answer for
   `john$ebilladdress.com` signed by `admin$elsewhere.com` is refused, even
   when that signature verifies.
5. The signature verifies, over the response **as received**, with the key
   `signedBy` publishes in DNS at `signatureSelector`. Nothing is added to
   the response before verifying.
6. `document` is a key record whose `publicKey` is a public key.

An encrypted answer (`encryption` present, `document` a string) is opened
with the requester's key before step 6.

## What the host does

- Looks the address up in its identity store by the address itself
  (`getPublicKeyRecord(identity, identitySelector)`); the store computes
  its own record id.
- Answers `Identity not found` when the store has no such address or key.
- Signs the answer with its own key and names that key's selector as
  `signatureSelector`. A host that serves lookups must be configured with
  that selector; this SDK's `BtpsServer` refuses to start with an identity
  store and no `serverIdentity.selector` (`BTP_ERROR_SERVER_SELECTOR`).
- Ends the connection after a found answer.

## Vectors

`test/vectors/identity-lookup.vectors.json` pins TXT parsing (including
padded 3072-bit and 4096-bit keys), the DNS-first outcomes, and the answers
a client must accept or refuse.
