# Changelog

All notable changes to `@btps/sdk` and the BTPS protocol it implements. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/).

## [1.1.3] — 2026-10-30 (alpha)

A patch release. Every document a compliant sender sent before is still
valid; what is new only adds.

### Security

- **A crafted document can no longer exhaust a receiver's memory**
  (GHSA-mrhx-c7xc-m3w5, in zod 3). zod makes one issue for every invalid
  entry of a list, with no cap, and keeps reading after a `.max()` fails: one
  5 MB document cost 2 GB to check. Every list and record in a document now
  has a protocol limit, far above any real document, and is checked before
  zod reads inside it. Over its limit, a list is refused with one issue; a
  list of more than 100 entries stops at its first invalid entry. Both crafted
  documents now cost one issue and under a megabyte. The limits are on the
  [Limits](https://www.openbtps.org/docs/protocol/specifications/limits) page and
  in `BTPS_FIELD_LIMITS`.
- **`generateUserToken` draws every character from a secure random source**,
  about 60 bits for a 12-character token, where it had about 32.

### Added

- `encryptBtpPayload`, `decryptBtpPayload` and
  `decryptBtpPayloadWithDecrypter` take an optional document type. Given one,
  they check the document against it, limits included. Without one they
  behave as before.
- `BtpsAgent.command` takes `options.id`, a UUID: the artifact is sent under
  it, so a document sent again after a lost answer keeps its id. On
  `event.send` it may only be the event's own id.
- `trust.fetch` may answer with trust records (`BTPTrustRecord`), which now
  have a schema, as well as with the requests' `TRUST_REQ` artifacts.
- `BTP_ERROR_TEMPORARILY_UNAVAILABLE` (503), for a trust or identity store to
  throw when it is briefly unreachable, so a sender sends again later.

### Fixed

- **An error on one artifact no longer ends its connection**, and every other
  artifact in flight on it. The server answers that artifact's error and
  keeps the connection; only framing, socket, size and timeout failures end
  it.
- **Each artifact on a connection is attributed to its own sender.**
  `getIdentity()` returned the first artifact's sender for every later one,
  in middleware, rate limits and logs.
- **An identity lookup whose store throws is answered with an error**, where
  it was left unanswered as an unhandled rejection.
- **A client keeps an identity lookup's answer when the host closes the
  connection first**, as it does right after answering. The lookup failed
  with `BTP_ERROR_CONNECTION_CLOSED` whenever the close arrived while the
  answer was being verified.
- **A `BtpsTransporter`'s idle connections no longer keep a process alive**
  for up to five minutes after its work is done.

## [1.1.2] — 2026-10-19 (alpha)

A patch release: the protocol and the API are unchanged.

### Fixed

- **A client or transporter can keep sending after a server ends the
  connection.** The next send used the ended connection and failed with
  `BTP_ERROR_CONNECTION_CLOSED`. It now makes a new one. A `BtpsTransporter`
  keeping one connection per receiver depends on this.
- **An answer is not lost when the server ends the connection right after
  writing it**, as a rate limit does. Sends waiting on a connection are failed
  only once the lines already received have been read.
- **A connection's end fails only the sends written to it.** An older
  connection closing late used to fail the sends waiting on the newer one.
- **Sends made while the client is connecting each go out once**, on the
  connection being made. Before, they waited for an earlier answer, and one
  could be written twice.
- **`maxRetries` retries the connection, as documented.** A retry used to
  reconnect without sending what was waiting, which then timed out. Each new
  connection has its own tries, and an error event's `willRetry` says whether
  another follows.

## [1.1.1] — 2026-10-19 (alpha)

A patch release: the protocol and the API are unchanged.

### Fixed

- **The package is about 3.8 MB smaller.** It no longer ships type
  declarations that no entry point can reach: the exports map lets a project
  import only the entry points, so those files were never read. The
  declarations every entry point needs are all still included, and CI now
  type-checks each entry point against the packed package.

### Corrected

- The 1.1.0 notes said every trust refusal reads `BTP_ERROR_TRUST_NOT_ALLOWED`.
  Two stay distinct on the wire: an expired trust reads
  `BTP_ERROR_TRUST_EXPIRED`, and an artifact sent without the encryption the
  trust requires reads `BTP_ERROR_PRIVACY_TYPE`. Every other refusal, including
  a trust that was never made, is pending, rejected, revoked or blocked, reads
  `BTP_ERROR_TRUST_NOT_ALLOWED`.

## [1.1.0] — 2026-10-18 (alpha)

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

- **Protocol golden vectors** for any implementation, in any language:
  addresses, every document type with each field limit at and one over,
  two artifacts exactly as they travel (plain and encrypted), the device key
  proof, the time window, and a manifest of the whole set with each file's
  SHA-256. `yarn verify:btps-vectors` checks them on Node and WebCrypto and
  against the SDK.
- **Receipts, payslips and letters.** A `BTPS_DOC` now carries an `invoice`,
  a `receipt`, a `payslip` or a `letter`, by its `type`.

  - A receipt is the invoice without `dueAt` and `paymentLink`, with a
    required `payment`; it may name the invoice it pays (`receipt_for`).
  - A payslip lists earnings, deductions, contributions and leave, each by an
    open code, with decimals written as text.
  - A letter has a title and one body, `text` or `markdown`, and no money.

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
  default), a time window for `issuedAt` (`maxArtifactAgeSeconds`,
  5 minutes by default), and a limit on requests handled at once per
  connection (`maxInFlightPerConnection`, 32 by default). At that limit the
  server reads no more from the connection until one finishes, so a sender
  that does not wait for answers is slowed instead of filling its memory.
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

- A sender whose published key is not a public key no longer writes a
  console line for every artifact it signs. The refusal
  (`BTP_ERROR_SIG_MISMATCH`) says why in `meta.reason`.

- A JSON store with no records no longer reads its file again on every
  lookup.

- A client bundle no longer carries the server. `@btps/sdk/client` imported
  the server entry for one constant, and `@btps/sdk/authentication` reached
  the JSON file stores through the trust barrel, so a phone or browser app
  bundled `BtpsServer`, its middleware loader and file locking. The trust
  rules now live apart from the file store; `@btps/sdk/trust` exports the same
  names.

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

[1.1.3]: https://github.com/openbtps/btps-node/releases/tag/v1.1.3
[1.1.2]: https://github.com/openbtps/btps-node/releases/tag/v1.1.2
[1.1.1]: https://github.com/openbtps/btps-node/releases/tag/v1.1.1
[1.1.0]: https://github.com/openbtps/btps-node/releases/tag/v1.1.0
