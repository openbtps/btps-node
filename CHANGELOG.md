# Changelog

All notable changes to `@btps/sdk` and the BTPS protocol it implements. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] — Unreleased (alpha)

BTPS 1.1 is the alpha release of the protocol: 1.2 is planned as the beta and
1.3 as the general release. A 1.1 server refuses 1.0 artifacts, so both sides
of an exchange must upgrade together.

### Breaking

- **Protocol version 1.1.0.** Servers check every artifact's `version` and
  refuse another major.minor with `BTP_ERROR_VERSION_UNSUPPORTED` (400).
- **Node.js 24 or later.**
- **Canonical signing (JCS, RFC 8785).** Signatures are over the canonical
  form, so any implementation in any language produces the same bytes. A line
  that names a member twice is refused.
- **The 1.1 invoice.** Money is in integer minor units
  (`{ amount: 150000, currency: 'AUD' }` is AUD 1,500.00). The invoice has no
  `status`: status comes from lifecycle events. It may carry several
  attachments (with size and SHA-256), the issuer's address and identifiers,
  and references to other documents. A credit note is an invoice with a
  `credits` reference. The schema is strict: a field it does not name is
  refused.
- **An artifact's `selector` names the sender's own signing key.** In 1.0,
  `signEncrypt` wrote the receiver's selector.
- **The domain operator.** A domain names the identity that operates it in its
  `_btps.host` record (`op=<identity>`). Delegations, attestations and
  identity-lookup answers are accepted only from that operator. A SaaS must
  publish `op=` for its domain.
- **Address characters.** The username is letters, digits, `.`, `_` and `-`
  (up to 64); the domain follows DNS's rules, with international names in
  their `xn--` form; exactly one `$`. Letters compare without case.
- **Client timeouts.** `connectTimeoutMs` (at least and by default 5 s) and
  `replyTimeoutMs` (at least 10 s, default 20 s) replace the single wait.
  `connectionTimeoutMs` is now only an idle timeout.
- **Error codes on the wire.** Every refusal carries its exact status and its
  code in `status.error`. A refusal never tells the sender what only the
  receiver knows: a trust that was never made, is pending, rejected, revoked or
  blocked all read `BTP_ERROR_TRUST_NOT_ALLOWED`.
- **Field limits.** Trust requests, trust responses and lifecycle events have
  a longest length for each text field, and every document's `id` and
  references are limited, the same at every provider
  (`BTP_ERROR_VALIDATION`). An encrypted document is checked by the sender's
  SDK before encrypting and by the receiver's after decrypting. The numbers
  are exported as `BTPS_FIELD_LIMITS`. Every limit is listed on the new
  Limits page of the protocol docs.
- **`trust.update` and `trust.delete`** edit the user's own trust records at
  their provider and send nothing to the other side.
- **`BtpsTransporter.getConnectionTTLSeconds()`** returns seconds (it returned
  milliseconds).

### Added

- **Lifecycle events (`BTPS_EVENT`):** `paid`, `partially_paid`, `disputed`,
  `refund_requested`, `refund` and `response`. Each names the invoice it is
  about (`document` and the `relatesTo` artifact id). Replies carry
  `inReplyTo`. An event may come back over the trust that delivered the
  invoice.
- **`Signer` and `Decrypter` interfaces**, so a platform can keep private keys
  in a KMS or a device keystore. PEM and KMS-shaped implementations are
  included.
- **Device keys:** registration codes and refresh tokens are taken once,
  atomically. Every refresh is signed by the device's current key.
  `BtpsAuthentication.rotateKey` moves a device to a new key with a proof
  signed by that key.
- **Identity lookup through the host,** for an address whose key is not in
  DNS, answered and signed by the domain's operator.
- **Server guards:** a maximum artifact size (`maxArtifactSizeKb`, 5 MB by
  default) and a time window for `issuedAt` (`maxArtifactAgeSeconds`,
  5 minutes by default).
- **`privacyType` is enforced:** a plain artifact over a trust that requires
  encryption is refused (`BTP_ERROR_PRIVACY_TYPE`).
- **`sentbox.fetch` and `sentbox.delete`** agent actions.
- **Exports:** `BtpsTransporter`, the transporter's defaults and error codes,
  the timeout, size, time-window and idle defaults, and `CURRENCY_CODES`.
- **Transporter connections stay open while busy.** The TTL is idle time, a
  connection is never closed while a send waits for its answer, and a full
  pool closes the connection idle longest instead of refusing.
- **Test suites:** end-to-end journeys (`ci/e2e`) and an attack, spoofing,
  spam and probing suite (`ci/security`), against real servers over TLS.
- **Documentation:** the client pages, the security best practices
  ("Defending your provider"), and a docs build that fails on any broken link
  (`ci/docs`).

### Fixed

- A device can send. Its `artifact.send`, `event.send`, `trust.request` and
  `trust.respond`, addressed to someone else, were refused as a signature
  failure, because the server looked the device up under the receiver. It is
  now looked up under the sender of the artifact it carries.

- AES-GCM requires a full 16-byte authentication tag. RSA keys under 2048
  bits are refused.
- A server with no handler for an artifact refuses it
  (`BTP_ERROR_ARTIFACT_NOT_ACCEPTED`) instead of answering success, and
  answers success only once the handler has returned.
- Each line gets its own request context, and an answer is correlated to its
  request id. An error the server wrote before it could read an id goes to the
  single pending send.
- `PING` keeps the connection open. A connection is never closed mid-request.
- `getServerIdentity()` never returns the private key.
- Device records are kept apart from trust between identities, so a trusted
  business cannot act as one of the receiver's devices.
- Device `artifact.send` and `event.send` pass the server's schema, and
  attested delegations verify.
- `signEncrypt` finds the receiver's key in DNS first, then from the
  receiver's host.
- `transport()` answers `{ error }` when no connection can be opened instead
  of throwing. The client's `connected` event is typed with what it emits.
- The default middleware counts an identity's rate limit after signature
  verification. Rate limiting is off unless a provider enables it.

[1.1.0]: https://github.com/openbtps/btps-node/compare/master...release/1.1
