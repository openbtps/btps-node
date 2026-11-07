# Changelog

All notable changes to `@btps/sdk` and the BTPS protocol it implements. The
format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased] — 1.2.0

### Added

- **BTPS 1.2 speaks 1.1 and 1.2.** A 1.2 server takes any 1.1.x and 1.2.x
  artifact. A 1.2 sender stamps an artifact `1.1.0` whenever everything in it
  can be said in 1.1 (`artifactVersion`), and `1.2.0` only when it uses
  something 1.2 adds, so a 1.1 and a 1.2 provider always talk. Identity
  lookups and control artifacts are always `1.1.0`.
- `BtpsClient.getServerVersion()`: the version a server speaks, from its
  answer to a `PING` that every 1.1 and 1.2 server answers.
- `resolveIdentity` also returns `serverVersion` when the address's host
  answered: the version its server speaks, from its signed answer.
- A "created, with this id" answer, `{ id }` (`BTPCreatedResDoc`), so
  `draft.create` can return the new draft's id.
- **The `withdrawn` event.** The sender of an unanswered proposal takes it
  back with `withdrawn`, naming it in `inReplyTo`; a proposal sent again names
  the `withdrawn` it follows in `follows`. Both travel only in `1.2.0`
  artifacts; under `1.1.0` an event is read exactly as 1.1 reads it
  (`processBtpDocSchema` now takes the artifact's version).
- `BTP_ERROR_EVENT_CHAIN`: a server refuses a `withdrawn` or `follows` from
  the invoice's issuer, since only the payer withdraws or proposes again.
  When its trust store has the new, optional `getEvent`, it also refuses a
  `withdrawn` that does not take back the payer's own open proposal about the
  same invoice, and a `follows` that names no `withdrawn` about it. It tells
  the sender which rule it broke. `lifecycleEventChainProblem` and
  `lifecycleEventSenderProblem` (`@btps/sdk/server`) let a platform check an
  encrypted event the same way once it has opened it.
- **Notes say how they are written.** An invoice's and receipt's
  `description`, an event's `message`, and a trust request's or response's
  `message` may be `{ format: 'text' | 'markdown', content }` (`BTPNote`); a
  plain string is still taken, read as `text`. In a `1.2.0` artifact a note's
  content is at most 5,000 characters.
- **Discounts.** An invoice or receipt may carry `discount`, `{ amount }` in
  minor units or `{ percent }` in whole basis points (1 to 10,000), applied
  before tax (`BTPDiscount`). In a `1.2.0` artifact a line's `discount` cell is
  an amount of at least 0.
- **Templates by reference.** In a `1.2.0` artifact a template's named `data`
  fields (`version`, `sha256`, `source`, `logo`) are well formed when present
  (`BTPTemplate`), a `source` always comes with its `sha256`, and a letter or
  payslip may name a template. The template file's format is specified on the
  new Templates page, with a JSON Schema published with the docs
  (`schemas/btps-template.schema.json`) and golden vectors
  (`templates.vectors.json`). Format 1 says how an invoice or receipt looks,
  never what it says: it never carries or changes a value, hides no section
  with signed fields, fetches nothing and runs nothing, and its labels, terms
  and footer are plain text, with no markup and no control, hidden or
  direction-changing character. What those words say is the platform's
  policy; the Templates page recommends refusing digit runs and web, email
  and BTPS addresses, where a fake payment detail would hide. Its fingerprint is the
  SHA-256 of its RFC 8785 canonical form. The SDK renders nothing.
- **Template format 2: payslips and letters.** Format 2 is format 1 for
  invoices and receipts, plus a payslip template (the payslip's own sections
  and labels, every one with signed fields shown) and a letter template, which
  sets only the page, a letterhead placing the sender's own fields, and a
  footer with a sign-off and signature slots, never the body. A letter's
  template carries the slots' values in `template.data.values`
  (`BTPTemplateValues`), signed with the letter, 1.2.0 only: a typed
  signature, drawn in the open-licence script font Caveat, a name, a title, and
  a drawn signature as integer strokes on a 1,000 by 300 canvas, never markup.
  Such a signature is decoration and proves no agreement.
- Every 1.2 document rule applies under `1.2.0` only: a document valid in 1.1
  reads exactly as before in a `1.1.0` artifact. The schemas 1.1 reads with are
  kept beside the newest (`Btp…V1_1Schema`). A device checks what it sends
  under the version it will stamp it with, so it sends whatever a 1.1 device
  could; a draft or edit takes either version's shape.
- **Signed answers, and a device that requires them.** A server with
  `signAnswers` signs every answer, errors included, as `serverIdentity` under
  its new `selector`. A client with `requireSignedBy: { identity, selector }`
  takes no answer but one signed by that signer under that selector, and
  refuses any other before it looks up a key. `serverIdentity` is the
  domain's operator, whose key signs identity-lookup answers too, so a
  provider keeps one key pair and its app pins the operator.
- **Sync.** A device's sync is an `artifact.send` to the user's own address
  that names the send it copies on its envelope, `syncOf: { id, sha256 }`
  (`BtpsAgentCommandOptions.syncOf`; `syncOfArtifact` computes it). It is only
  from and to the same address, only in `1.2.0` artifacts, and only inside a
  device's `artifact.send`: a server refuses one sent to it directly
  (`BTP_ERROR_SYNC_NOT_ALLOWED`).
- **Trust permissions on the envelope.** A `TRUST_REQ` may carry
  `permissions` (one flat list of the `send:` and `detail:` names it asks
  for, each `required` or not, each once, with at least one `send:`), `entityType`, `given` (the details it gives) and `change`; an
  accepted `TRUST_RES` carries `granted` and the responder's `entityType`; a
  `BTPS_DOC` may carry `documentType`. All are signed, readable and `1.2.0`
  only. A server refuses on arrival a name that is not the protocol's, a
  request that does not give what it asks for (a person's `detail:dob` and an
  organisation's `detail:registrationNumber` swap between kinds), and a
  readable request or answer that carries values unencrypted. The names are
  exported from `@btps/sdk/trust` (`DOCUMENT_TYPES`, `SEND_PERMISSIONS`,
  `DETAIL_PERMISSIONS`).
- **Trust permission values, checked when opened.** A request gives each name
  in `given` its value, in the 1.1 field it has (`name` is `detail:legalName`,
  and so on) or else in `own`, by name; an answer holds every granted detail's
  value in `details`, by name. `decryptVerify` refuses a request or answer
  whose values do not match its names, or whose values are not their names'
  shapes (`{ number, country }`, a `YYYY-MM-DD` date, a profile with https
  addresses), with `BTP_ERROR_VALIDATION`. `trustRequestProblem` and
  `trustResponseProblem` in `@btps/sdk/trust` run the same check.
- **Trust permissions on the trust record.** A record may carry `permissions`
  (`requested`, `granted`, `detailsHeld`, `detailsShared`, `pendingChange`),
  which the platform writes and the server only reads; without it, a 1.1
  trust. `trustPermissionsFromRequest` and `trustPermissionsFromResponse`
  compute what to save. A server refuses a `TRUST_RES` whose `granted` leaves
  out a required name, or that its record cannot check
  (`BTP_ERROR_PERMISSION_REQUIRED`), or that grants a name never asked for
  (`BTP_ERROR_PERMISSION`), and takes an answer on an accepted trust only to a
  pending change (`trustGrantProblem`; `validateTrustResponse` gains an
  optional `response`). `BTPDetailValues` now types each detail's value.
- **A send's document type.** Under a trust with permissions, a server refuses
  a `BTPS_DOC` that names no `documentType`, or one whose `send:<type>` the
  trust does not grant (`BTP_ERROR_PERMISSION`), and a readable document that
  is not its `documentType` (`BTP_ERROR_DOCUMENT_TYPE_MISMATCH`, also from
  `decryptVerify` once opened and from `signEncrypt` before sending). A device
  sets it with `artifact.send`'s new `documentType` option. A trust without
  permissions takes any type, as in 1.1 (`documentTypeProblem`). A device's
  send is checked the same way by its own provider before it goes, from the
  user's own record of the trust in its direction, sender to receiver.
- **Details refresh.** Three new artifact types, `DETAILS_CHANGED`,
  `DETAILS_REQ` and `DETAILS_RES`, carry `details`, the `detail:` names they
  are about, on the envelope, so each side of an active trust is told when the
  other's details change and can fetch again only what it already holds. A
  server checks the names against its own record of the trust, in either
  direction (`BTP_ERROR_DETAILS_NOT_HELD`), that a response answers a request
  its receiver sent, naming only what it asked (`BTP_ERROR_PERMISSION`;
  through the trust store's new, optional `getArtifact`, else only
  `isKnownArtifact`), and the provider's own limit (`allowDetailsRequest`,
  `BTP_ERROR_DETAILS_RATE_LIMITED`, with `retryAfter`). A request that passes
  is told to `server.on('detailsRequested', …)`. `decryptVerify` refuses an
  opened response whose values do not match its names (`detailsProblem`).
  `JsonTrustStore` keeps no artifacts, so its `getArtifact` answers
  `undefined`: a server using it as is takes no `DETAILS_RES` until the store
  is extended to answer from the platform's own records. The known-failing
  vector list is empty.
- **Details refresh from a device.** New agent actions `details.changed`,
  `details.request` and `details.respond`, with the `BtpsAgent` command option
  `details` (a response also needs `relatesTo` and encryption). The device's
  own provider checks the names before it sends them, as the receiver will,
  from the user's own record of the trust, and tells
  `server.on('detailsShared', …)` of each response it takes.
- `meta.delivery` on a sentbox result: a send's outcome by its provider's own
  record, `{ status: 'pending' | 'delivered' | 'failed', code?, at }`
  (`BTPDelivery`).
- **Device-key theft signals.** With a token store that has the new, optional
  `isConsumed`, a refresh token used a second time, which only a copy of it can
  do, revokes the device and fires `refreshTokenReused`. Without it, a second
  use is refused as in 1.1, and `BtpsAuthentication` warns once.
  `InMemoryTokenStore` has it. `auth.on('keyRotated', …)` tells a listener
  when a device moves to a new key.
- **A grace window for a retried refresh** (`refreshGraceMs`, default 30 s,
  `0` off). A device that lost a refresh's answer asks again with its old token:
  inside the window it gets the same answer, the same new token included, and
  nothing is revoked; after it, a second use is theft. The answer is kept
  sealed under the old token (AES-256-GCM, key by HKDF-SHA256, bound to the
  device and user), never in plain text, through the new, optional
  `TokenStore.markSuccessor`. A store without it has no window, and
  `BtpsAuthentication` warns once. `InMemoryTokenStore` has it.
- **A maximum key age** (`maxKeyAgeMs`, off by default): a refresh signed by an
  older device key is refused with `BTP_ERROR_KEY_TOO_OLD`, and the device
  moves to a new key with the same refresh token.
- **A device reads encrypted documents with its own key.** A query result may
  carry `agentKey: { key, fingerprint, wrappedAt }`: the artifact's content key
  wrapped again to the device that asked, by `wrapForAgent`
  (`@btps/sdk/server`). The artifact is untouched, so its signature still
  verifies. `BtpsAgent.openResult` checks the key is its own, checks who signed
  the artifact as a server does on arrival (a delegation and its attestation
  too), and decrypts. A `Decrypter` gains the optional `unwrapKey`, which
  `PemDecrypter` has, and `decryptVerify` an optional `contentKey`.
- `verifyTransporterSignature` (`@btps/sdk/server`): who signed a transporter
  artifact, checked as a server checks it on arrival. The server and
  `openResult` share it.
- **One `keyResolver` option for every key lookup** (`BtpsKeyResolver`), so a
  provider can cache keys; BTPS itself caches nothing. `BtpsServer`,
  `BtpsClient` (and so `BtpsAgent` and `BtpsTransporter`), `BtpsDelegator`
  and `signEncrypt`'s `lookup` take it, and it is asked for a key and what it
  is for, `verify` or `encrypt`. Without it, every lookup is as before.
  `createDefaultKeyResolver` is that lookup, to wrap.
- `yarn bench`: what a server spends on one arriving artifact, step by step.

### Changed

- `decryptVerify` refuses every signature that does not verify. Before, one
  that failed without an error object went on to be decrypted.
- A refresh never makes a revoked or blocked device accepted again.
- `keyHistory[].firstSeen` is when the retired key came into use (when the key
  before it was retired, or when the device registered). It was the time of
  the key's last refresh.
- A receiver's refusal of an artifact's version reaches the sender as a
  `BTP_ERROR_VERSION_UNSUPPORTED` error with `receiverVersion`, the version
  the receiver speaks, beside its answer. `send` now returns both `response`
  and `error` for it, where 1.1 returned the response with no error: a caller
  that checks `error` first now takes that path.
- A client refuses to send an artifact stamped lower than what it uses, and an
  agent artifact stamped lower than the artifact it carries.
- An answer a provider builds in a shape no answer allows reaches its sender
  as a generic `btps_error` against its request's `reqId`, and the connection
  stays open. It was closed without an answer, which a device saw only as
  "Connection closed". The server still reports it to `onError`.
- A server whose implementor takes errors, through the `onError` option or
  `onError` middleware, no longer also writes each failed artifact to
  `console.error`. With neither, it writes as before.

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
