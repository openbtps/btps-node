# Changelog

All notable changes to `@btps/sdk` and the BTPS protocol it implements.

## 1.1.0 (unreleased)

BTPS 1.1 hardens the protocol and the SDK in one release. It is a deliberate
break with 1.0: a 1.1 implementation refuses 1.0 signatures, the 1.0 invoice,
the 1.0 `selector` field and 1.0 device registration, and there is no
fallback. No independent BTPS provider exists yet, so the break costs nothing
now; every party upgrades together.

- **Specification:** [protocol specifications](docs/docusaurus/docs/protocol/specifications/overview.md),
  with the pages new in 1.1:
  [Document Model v2](docs/docusaurus/docs/protocol/specifications/document-model-v2.md),
  [Lifecycle Events](docs/docusaurus/docs/protocol/specifications/lifecycle-events.md),
  [Wire Errors](docs/docusaurus/docs/protocol/specifications/wire-errors.md),
  [Selectors](docs/docusaurus/docs/protocol/specifications/transporter-artifact.md#selectors-btps-11),
  [Timeouts](docs/docusaurus/docs/protocol/specifications/overview.md#timeouts-btps-11),
  [Algorithms](docs/docusaurus/docs/protocol/security/algorithm.md).
- **Golden vectors:** set 1.1.1 in [`test/vectors/`](test/vectors/), pinned by
  [`test/vectors/manifest.json`](test/vectors/manifest.json); how to run them
  against another implementation is on
  [Golden Vectors](docs/docusaurus/docs/protocol/specifications/golden-vectors.md).
- **Cryptography:** RSA keys of 2048 bits or more (smaller keys are refused),
  RSASSA-PKCS1-v1_5 with SHA-256 over the RFC 8785 canonical form, AES-256-GCM
  with a 16-byte tag, the key wrapped with RSA-OAEP (SHA-256, MGF1-SHA-256).

### Not in this release yet

These are part of 1.1 but not in the pull requests below; each lands
before 1.1.0 is published.

- **Version on the wire.** `BTP_PROTOCOL_VERSION` is still
  `1.0.0`, `_btps.host` still advertises `v=1.0.0`, and the server does not yet
  check an artifact's `version`. "Refuses 1.0" above means refuses the 1.0
  shapes, not the version string.
- **Authorised delegators and attestors.** The address's
  `_btps.host` record does not yet declare who may delegate or attest for it.
- **The Hermes run (PR #4).** The vectors have run on Node and Node's
  WebCrypto only, not on React Native's engine.
- **The package version.** `package.json` still says `1.0.0`; it becomes
  `1.1.0` when the release is cut from `release/1.1`.

### Upgrading from 1.0

1. **Imports.** Import each class from its subpath: `BtpsServer` from
   `@btps/sdk/server`, `BtpsClient`, `BtpsAgent` and `BtpsTransporter` from
   `@btps/sdk/client`, `BtpsDelegator` from `@btps/sdk/delegation`,
   `JsonTrustStore` from `@btps/sdk/trust`, `JsonIdentityStore` from
   `@btps/sdk/storage`, document schemas from `@btps/sdk/documents`. The root
   `@btps/sdk` exports only shared utilities.
2. **Keys.** Replace any RSA key under 2048 bits. Sign through a `Signer` and
   decrypt through a `Decrypter` (`KmsSigner`, `KmsDecrypter` in production;
   PEM still works, for tests and the interim). `await` `signBtpPayload` and
   `decryptBtpPayload`.
3. **Artifacts.** Send `sender.selector` to `signEncrypt` and
   `payload.encryptionSelector` for the receiver; never set `selector`.
4. **Documents.** Send document model v2: `schemaVersion: 2`, `type`, money as
   integer minor units (`{ amount, currency }`), `attachments` (a list) in
   place of `attachment`, and no `status`, `paidAt`, `refundedAt` or
   `disputedAt`. Send paid, partly paid, disputed and refunded as
   `BTPS_EVENT` lifecycle events. Send a credit note in the invoice's shape
   with `type: "credit_note"`, a positive `totalAmount`, a `credits`
   reference to the invoice and, optionally, a `reason`.
5. **Server.** Pass `tokenStore` (device registration) and remove your
   `auth.request` handlers; set `serverIdentity.selector` if you pass an
   `identityStore`; pass a shared `replayStore` if you run more than one
   instance; give custom token stores the atomic `consume()`; check your
   middleware file loads (an invalid definition now stops the server) and
   your handlers call `next()` when later ones should run; return `true` from
   `forwardTo` once a `TRUST_REQ` is stored; keep `connectionTimeoutMs` at
   30000 or above.
6. **Client.** Replace `connectionTimeoutMs` with `connectTimeoutMs` (minimum
   5000) and `replyTimeoutMs` (minimum 10000); decide retries by
   `error.code` and `error.retryable`, never by message text.

### Changes, by pull request

Each pull request below is stacked on the one before it and merges into
`release/1.1`.

#### #14 Canonical signing with JCS

- **Wire:** every signature is over the RFC 8785 (JCS) canonical form of the
  payload without `signature`. A line with a duplicate member name is refused
  as invalid JSON (`BTP_ERROR_CANONICAL_JSON`).
- **Breaks:** a 1.0 signature over `JSON.stringify` output does not verify.
- **Migrate:** sign with `signBtpPayload` or `signEncrypt` from 1.1; a non-JS
  signer signs the JCS bytes (`canonicalize` from `@btps/sdk/crypto`, and
  `jcs.vectors.json`).

#### #15 Separate `signatureSelector` and `encryptionSelector`

- **Wire:** the single `selector` is replaced by `signatureSelector` (the
  sender's signing key, required unless delegated) and `encryptionSelector`
  (the receiver's key, present exactly when encrypted). A server response's
  `selector` becomes `signatureSelector`. An artifact or response carrying
  `selector` is refused.
- **Breaks:** `signEncrypt` refuses a payload with `selector` and a sender
  without `selector`; `decryptVerify`'s third argument is `BTPDecryptionKeys`.
- **Migrate:** pass `sender.selector` and `payload.encryptionSelector`; a
  receiver that rotated passes a lookup `(encryptionSelector) => key`.

#### #16 Document model v2, wired into the core

- **Wire:** an unencrypted `BTPS_DOC` must be a v2 `invoice`, `credit_note`
  or `payslip`. The 1.0 invoice is refused. No document carries a status.
  Every string, list and attachment is capped; attachments are verified
  against their `size` and `sha256`; every `references` entry must come from
  the artifact's sender.
- **Credit note (2026-10-16, EBA-119):** the credit note takes the 1.1
  invoice's shape: `title`, `totalAmount` in integer minor units and greater
  than zero (the type says it is a credit, not the sign), the same
  `lineItems` table with tax in its columns, `issuer`, `attachments`,
  `description` and `metadata`. `references` is required, with at least one
  `credits` entry; `reason` (up to 500 characters) is new and optional. PR
  #9's structured lines, `total`, `taxTotals` and `extensions` are refused,
  and `verifyTaxTotal` and `TAX_TOTALS_MAX` are removed.
- **Breaks:** `BtpInvoiceDocSchema`, `BtpAttachmentSchema` and `BTPInvoiceDoc`
  are removed.
- **Migrate:** see Upgrading, step 4, and
  [what changed from 1.0](docs/docusaurus/docs/protocol/specifications/document-model-v2.md#what-changed-from-10).
  New export path `@btps/sdk/documents`. Supersedes PR #9.

#### #17 Lifecycle events, `BTPS_EVENT`

- **Wire:** a fourth transporter type, `BTPS_EVENT`, carrying `paid`,
  `partially_paid`, `disputed`, `refund_requested`, `refund` and `response`
  events. The event's id is the artifact's id; `inReplyTo` is required on
  replies and refused on proposals. Accepted over the normal or the flipped
  trust record. New agent action `event.send`.
- **Breaks:** nothing existing.
- **Migrate:** record status changes as events; the receiving platform runs
  the checks the [Lifecycle Events](docs/docusaurus/docs/protocol/specifications/lifecycle-events.md)
  page lists.

#### #18 Signer and Decrypter in the core; exports

- **Wire:** a GCM tag that is not exactly 16 bytes is refused on every
  decrypt path.
- **Breaks:** `signBtpPayload` and `decryptBtpPayload` are async;
  `selectDecryptionKey` returns `{ decrypter }`.
- **Migrate:** `await` them; pass a `Signer`/`Decrypter` (or PEM, for tests
  and the interim). `BtpsTransporter`, the Signer/Decrypter classes and their
  helpers are exported (`@btps/sdk/client`, `@btps/sdk/crypto`).

#### #19 Replay window and `(from, id)` uniqueness

- **Wire:** an artifact whose `issuedAt` is more than 5 minutes from the
  server's clock is refused (`BTP_ERROR_ISSUED_AT_WINDOW`), and a repeated
  `(from, id)` is refused (`BTP_ERROR_ALREADY_RECEIVED`).
- **Breaks:** the default replay store is in memory: it does not survive a
  restart and is not shared between instances.
- **Migrate:** a multi-instance server passes an `AbstractReplayStore` over
  shared storage (`replayStore`). Resending the same signed artifact after a
  timeout is safe inside the window.

#### #20 Key-rotating refresh signed by the current key

- **Wire:** every `auth.refresh` is verified with the device's current key;
  a refresh that rotates carries a `keyProof` signed by the new key. A 1.0
  rotating refresh is refused (`BTP_ERROR_REFRESH_NOT_CURRENT_KEY`,
  `BTP_ERROR_KEY_ROTATION_PROOF`).
- **Migrate:** rotate with `BtpsAuthentication.rotateKey`.

#### #21 Device registration bound to the identity

- **Wire:** the server answers every `auth.request` itself, consuming a
  one-time registration token issued to the identity; five new refusals
  (`BTP_ERROR_REGISTRATION_*`). An agent artifact whose `agentId` is an
  identity is refused, so an agent message cannot be forged as the identity.
- **Breaks:** application `auth.request` handlers never run; without a
  `tokenStore`, every registration is refused; `TokenStore` has a new
  required, atomic `consume()`.
- **Migrate:** pass the same token store to `BtpsServer` and
  `BtpsAuthentication`; remove `auth.request` handlers; implement `consume()`
  in a custom store (Redis: `GETDEL`).

#### #22 Host identity lookup repaired

- **Wire:** lookup stays DNS first, then the address's host; the host's
  answer is signed and checked (request id, signer in the address's domain,
  a real key record). TXT tags split on the first `=`, so padded keys parse.
- **Breaks:** a server with an `identityStore` must set
  `serverIdentity.selector` (`BTP_ERROR_SERVER_SELECTOR`).
- **Migrate:** publish the server's key at a selector and pass it.

#### #23 Agent artifacts, attested delegation, per-line request context, line limit, identity rules

- **Wire:** each line on a connection gets its own answer, by `reqId`; a line
  longer than `BTP_MAX_LINE_LENGTH` is answered `BTP_ERROR_LINE_TOO_LONG` and
  the connection closed; an identity has exactly one `$` and no `:`.
  Agent `artifact.send`, `event.send`, `trust.request` and `trust.respond`
  carry a transporter artifact the server now validates; agent artifacts are
  addressed to the agent's own identity. Attested delegations verify.
- **Breaks:** identities outside the strict character rules are refused.
- **Migrate:** none for SDK users beyond the identity rule.

#### #24 Stable error codes on the wire

- **Wire:** an error answer carries a stable string `code` beside `status`,
  from one table (`BTP_WIRE_ERRORS`); the message is the code's fixed one.
- **Breaks:** `BtpsClient.send()` returns a `btps_error` as `error` as well as
  `response`; `BTP_ERROR_UNKNOWN.code` is `'BTP_ERROR_UNKNOWN'`; a middleware's
  bare status keeps its class but not its message.
- **Migrate:** decide retries by `error.code` and `error.retryable`.

#### #25 `privacyType` enforced; rate limits by verified identity

- **Wire:** a `BTPS_DOC` or `BTPS_EVENT` that breaks the trust's
  `privacyType` is refused (`BTP_ERROR_TRUST_PRIVACY`). Identity rate limits
  count only verified senders.
- **Breaks:** the default middleware always loads (`defaultMiddleware`
  controls it); rate tables are bounded.
- **Migrate:** a multi-instance server passes a shared rate limiter through
  `defaultMiddleware`.

#### #26 Trust-request storage, middleware, PING, and smaller defects

- **Wire:** a `TRUST_REQ` is answered success only once stored
  (`BTP_ERROR_TRUST_REQUEST_NOT_STORED` otherwise); `PING` is answered and the
  connection stays open; an error answer with no `reqId` reaches the one
  pending send; RSA keys under 2048 bits are refused
  (`BTP_ERROR_KEY_TOO_SMALL`).
- **Breaks:** an invalid middleware definition stops the server
  (`BTP_ERROR_MIDDLEWARE`); a handler that neither answers nor calls `next()`
  stops its step's chain; `getServerIdentity()` returns no private key.
- **Migrate:** `forwardTo` returns `true` once it stored a trust request;
  fix any middleware file that no longer loads.

#### #27 Timeout minimums

- **Wire:** a receiver replies within 10 s or answers "try again"; a sender
  waits at least 10 s for a reply and 5 s to connect.
- **Breaks:** the client's `connectionTimeoutMs` is removed and refused;
  waits below the minimums are refused; the server's `connectionTimeoutMs` is
  at least 30000.
- **Migrate:** use `connectTimeoutMs` and `replyTimeoutMs`.

#### #28 Documentation, published vectors, and resend on reconnect

- **Client:** after a retryable failure `BtpsClient` reconnects and sends, on
  the new connection, every pending send that was never written. A send that
  was written and not answered is answered with its error and **not** resent
  automatically; resending is the caller's choice, safe inside the replay
  window (#19). A reconnect with nothing to send no longer keeps the process
  alive.
- **Docs:** every page describes RSA-2048 and AES-256-GCM, the 1.1 shapes
  and the real `@btps/sdk` subpaths.
- **Vectors:** published as set 1.1.0 with a SHA-256 manifest, checked by
  `yarn verify:btps-vectors`. Set 1.1.1 replaces it: the credit note vector
  takes the invoice's shape, with its refusals, and the `taxTotal` cases are
  gone with `verifyTaxTotal`.
