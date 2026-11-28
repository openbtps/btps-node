---
title: Limits
sidebar_label: Limits
slug: limits
---

# Limits

Every limit in BTPS, in one place. Each one is also described on the page
for the part it belongs to; this page is where to look them up.

There are two kinds:

- **Protocol limits** are the same at every provider. A sender cannot know
  which provider a receiver uses, so a document one provider accepts must be
  accepted by all of them. A provider cannot raise them. It may be stricter
  in its own middleware (see [Being stricter](#being-stricter)). Since 1.2,
  one is the exception: how many attachments a `1.2.0` document carries. The
  protocol guarantees 20, and a provider may take more but never refuse 20
  or fewer (see [Attachments](#attachments)).
- **Receiver settings** are chosen by each server, within a minimum the
  protocol sets, the way an email server announces its own message size.

A protocol limit is raised only by a new protocol version. Raising one does
not break anything, since what was accepted still is; lowering one would, so
it never happens within a version.

## Addresses

An address is `username$domain`, with exactly one `$`. Letters compare without
case.

| Part         | Limit                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Username     | 1 to 64 characters: `a`–`z`, `0`–`9`, `.`, `_`, `-`                             |
| Domain label | 1 to 63 characters: `a`–`z`, `0`–`9`, `-`, not starting or ending with `-`      |
| Domain       | at most 253 characters, at least two labels; international names in `xn--` form |

The full rules, with what they refuse, are in the
[Protocol Specification Overview](./overview.md).

## Document fields

The longest each field may be, in characters. A document over a limit is
refused with `BTP_ERROR_VALIDATION` (400).

Fields not listed have no limit of their own: the
[artifact size](#artifact-size) bounds them.

### Trust request (`TRUST_REQ`)

A trust request is the first thing a stranger can send, so every text field
has a limit.

| Field         | Limit |
| ------------- | ----: |
| `id`          |   100 |
| `name`        |   200 |
| `displayName` |   200 |
| `email`       |   254 |
| `phone`       |    32 |
| `address`     | 1,000 |
| `reason`      | 2,000 |
| `message`     | 5,000 |
| `logoUrl`     | 2,048 |
| `websiteUrl`  | 2,048 |

### Trust response (`TRUST_RES`)

| Field       | Limit |
| ----------- | ----: |
| `id`        |   100 |
| `decidedBy` |   254 |
| `message`   | 5,000 |

### Trust detail values

Since 1.2: a request's `own` and an answer's `details` (see [Trust permissions](./transporter-artifact.md#trust-permissions)). Each value has the limit of the trust request field it stands for, so `detail:legalName` is at most 200 characters, `detail:email` 254, `detail:phone` 32 and `detail:address` 1,000; `detail:profile`'s `displayName` is at most 200, and its `logo.source` and `website` at most 2,048.

| Value                                                 | Limit |
| ----------------------------------------------------- | ----: |
| `detail:taxNo`, `detail:registrationNumber`: `number` |    64 |

### Lifecycle event (`BTPS_EVENT`)

| Field         | Limit |
| ------------- | ----: |
| `message`     | 5,000 |
| `reason`      |    64 |
| `document.id` |   100 |

### Documents (`BTPS_DOC`)

Every document type, invoice, receipt, payslip, letter and agreement, limits its
identifiers. How many entries its lists may have is under
[Lists and records](#lists-and-records). Its other content is bounded by the
[artifact size](#artifact-size), except, since 1.2 and in a `1.2.0` artifact
only, an invoice's or receipt's description and line item text, a document's
BoundView and a letter's signatory. Under `1.1.0` a description has no limit of its own, as
in 1.1.

| Field                                        | Limit |
| -------------------------------------------- | ----: |
| `id`                                         |   100 |
| `references[].id`                            |   100 |
| `references[].type`                          |    64 |
| `description` (or its `content`), 1.2.0 only | 5,000 |
| `recipient.name`, 1.2.0 only                 |   200 |

### Line items

Since 1.2, in a `1.2.0` invoice or receipt only. Under `1.1.0` a column name
and a text cell have no limit of their own, as in 1.1.

| Field                           | Limit |
| ------------------------------- | ----: |
| a `lineItems.columns` name      | 1,000 |
| a text cell in `lineItems.rows` | 1,000 |

A number cell is unchanged: a safe whole number, with no length. How many rows,
columns and cells there may be is under [Lists and records](#lists-and-records).

### Receipt

| Field               | Limit |
| ------------------- | ----: |
| `payment.method`    |    64 |
| `payment.reference` |   100 |

### Payslip

Every code in a payslip has the same limit: the `category` of an earning,
deduction, contribution or leave, a leave `unit`, `rateUnit`, and
`payRate.unit`.

| Field  | Limit |
| ------ | ----: |
| a code |    64 |

### Letter

| Field          |   Limit |
| -------------- | ------: |
| `title`        |     200 |
| `body.content` | 100,000 |

Since 1.2, in a `1.2.0` artifact, a letter may carry its sender's `signatory`:

| Field                                                       |                Limit |
| ----------------------------------------------------------- | -------------------: |
| `signatory.name`, `signatory.title`                         |                  100 |
| `signatory.visualSignature.text` (typed)                    |                  100 |
| `signatory.visualSignature.strokes` (drawn): strokes        |                   32 |
| `signatory.visualSignature.strokes`: points a stroke        |                  512 |
| `signatory.visualSignature.strokes`: points in all          |                2,048 |
| `signatory.visualSignature.strokes`: a point's `x`, `y`     | 0 to 1,000, 0 to 300 |

### BoundView

Since 1.2, in a `1.2.0` artifact: a document's BoundView, `boundView`, on any
document type. Each limit is described on its
[BoundView](./boundview/overview.md) page.

| What                                                   |              Limit |
| ------------------------------------------------------ | -----------------: |
| a BoundView, as JSON                                   |            384 KiB |
| `page.width`                                           |           1 to 2,000 |
| `page.height`                                          |          1 to 20,000 |
| `page.breaks`                                          |                100 |
| elements                                               |              2,000 |
| text, label and signature elements together            |              1,000 |
| a position or size                                     | -20,000 to 20,000 |
| a label's `text`                                       |                500 |
| a path's `d`                                           |             20,000 |
| all paths' `d` together                                |            100,000 |
| a gradient's stops                                     |                  8 |
| fonts                                                  |                  8 |
| glyphs a font                                          |                256 |
| a glyph's `path`                                       |              4,000 |
| kerning pairs a font                                   |              4,096 |
| a font's `fallback`                                    |            4 names |
| images                                                 |                  8 |
| an image's `width`, `height`                           |           1 to 1,024 |
| pixels an image                                        |            262,144 |
| an image's `data` (base64)                             |            256 KiB |
| a money format's `prefix`, `suffix`                    |                  8 |
| a groups format's `sizes`                              |            1 to 32 |
| contrast tests on one BoundView                        |         20,000,000 |

### Agreement

Since 1.2, in a `1.2.0` artifact only. An agreement has a letter's limits,
its signatory's and its BoundView's included, and these:

| Field                                                        |                           Limit |
| ------------------------------------------------------------ | ------------------------------: |
| `acceptance.signers`                                         |                         1 to 20 |
| `acceptance.terms`                                           | one for each attachment at most |
| a statement's `viewedFrom.userAgent`, `signedFrom.userAgent` |                             256 |
| a statement's `viewedFrom.device.id`, `signedFrom.device.id` |                             128 |
| each other field of `viewedFrom.device`, `signedFrom.device` |                             100 |
| `salt`                                                       |                exactly 32 bytes |
| a cosignature's encrypted statement, padded to a multiple of |                4,096 characters |
| a cosignature's `ciphertext` (base64)                        |              262,144 characters |
| a cosignature's `recipients`                                 |                         1 to 21 |

An agreement's terms are its attachments, so they are held to the same number:
20, or more where its receiver takes more ([Attachments](#attachments)).

Since 1.2, a cosignature's statement is padded with `0`s to a multiple of 4,096 characters before it is encrypted, so its length does not tell an acceptance from a decline. A receiver refuses a statement whose padding is not exactly that. The ciphertext limit leaves room for a statement with a drawn signature, padded: a cosignature carries a statement, never a document. A cosignature's `recipients` include its signer and the agreement's originator, each identity once (compared without case), so there are at most 21 (the 20 signers and an originator that does not sign). See [Cosignatures](./transporter-artifact.md#cosignatures).

## Lists and records

How many entries a list may have, and how many keys a record. These are
counts, not lengths. They are far above any real document, and are there so
that no message, however crafted, costs a receiver more than a bounded
amount of memory to check. Since 1.1.3.

| Field                                                      |                       Limit |
| ---------------------------------------------------------- | --------------------------: |
| `lineItems.rows` (invoice, receipt)                        |                      10,000 |
| `lineItems.columns`                                        |                          50 |
| cells in one `lineItems` row                               |                          50 |
| `attachments` (invoice, receipt, payslip), `1.1.0`         |                          10 |
| `references` (invoice, receipt, payslip)                   |                          20 |
| `attachments` (letter), `1.1.0`                            |                          10 |
| `references` (letter)                                      |                          20 |
| `attachments` (every type), `1.2.0`, since 1.2             | the receiver's: 20 to 1,000 |
| payslip `earnings`, `deductions`, `contributions`, `leave` |                    200 each |
| query filter `in`, `notIn`                                 |                       1,000 |
| agent `ids` (to delete, cancel or mark seen)               |                       1,000 |
| query `results` (one page)                                 |                       1,000 |
| a trust record's `keyHistory`                              |                       1,000 |
| `agentInfo` list values                                    |                          50 |
| keys of any record                                         |                         100 |

Since 1.2, a `1.2.0` document's attachments are the one count a provider sets
itself: every receiver takes 20 of each type, and may take more
([Attachments](#attachments)).

Since 1.2, the lists that trust permissions, details refresh and agreements add. Each name is in a list at most once, so a names list is at most as long as the names it may hold:

| Field                                                                   |   Limit |
| ----------------------------------------------------------------------- | ------: |
| a `TRUST_REQ`'s `permissions` (at least one `send:` name)               |      13 |
| a `TRUST_REQ`'s `given`                                                 |       8 |
| a `TRUST_RES`'s `granted`                                               |      13 |
| a details artifact's `details` (at least one)                           |       8 |
| an agreement's `acceptance.signers`                                     |      20 |
| a `BTPS_EVENT`'s `cosignatures`                                         | 1 to 20 |
| an evidence bundle's `cosignatures`                                     |      20 |
| an evidence bundle's `statements`                                       |      20 |
| an evidence bundle's `keys` (up to four for each signer, plus two more) |      82 |
| an evidence bundle's `timestamps`                                       |      20 |
| an evidence bundle's `keyChains` (as many as its `keys`)                |      82 |
| an evidence bundle's `arrivals`                                         |      20 |
| an identity's key chain (`keyChain`), in records                        |     100 |
| a key rotation record's `signatures`                                    |  1 to 2 |
| a key's `publicKey` in a key rotation record (DER SPKI, base64)         |   2,048 |

A record is any object whose keys the sender chooses: `metadata`,
`issuer.identifiers`, a payslip's `yearToDate`, a `1.1.0` artifact's
`template.data`, and `agentInfo`.

A list over its limit is refused with one issue naming it, before any entry
in it is read. A list of more than 100 entries is checked one entry at a
time, and the check stops at the first invalid entry, naming where it is, for
example `lineItems.rows[4812].c3`. A shorter list is checked whole, and every
invalid entry is reported.

### Attachments

Since 1.2, in a `1.2.0` document of every type (invoice, receipt, payslip,
letter and agreement), how many attachments it carries is the one field limit
a provider sets itself. Every other limit on this page is fixed by the
protocol.

- **Every receiver takes at least 20 of each type.** This is the protocol's
  guarantee: a sender that sends 20 or fewer is never refused for its count,
  wherever it sends. A receiver's own middleware must not refuse 20 or fewer
  either ([Being stricter](#being-stricter)).
- **A limit is a maximum, never a minimum.** A document with 0, 2 or 19
  attachments is always taken.
- **A receiver may take more,** up to 1,000, by type. It can never take fewer
  than 20: a value below 20 is warned about and 20 is used.
- **A sender may hold its own documents to fewer,** from 0 to 1,000, for
  example a platform that sends one file on an invoice.
- **Sending more than 20 is the sender's choice and risk.** A receiver that
  takes only the guaranteed 20 refuses it, and the sender must send it again
  with fewer. That is the provider's responsibility.
- **An agreement's terms are its attachments** (`acceptance.terms`), so they
  are held to the same number.

A `1.1.0` document is unchanged: an invoice, a receipt, a payslip or a letter
carries at most 10, fixed by the protocol, as in 1.1. A 1.1 receiver takes at
most 10, by its own rule. The wire is unchanged.

Where each side sets its number, `maxAttachments`:

| Side                          | Set on                                                                        | Range       | Default    |
| ----------------------------- | ----------------------------------------------------------------------------- | ----------- | ---------- |
| receive, unencrypted document | `BtpsServerOptions.maxAttachments`                                            | 20 to 1,000 | 20 of each |
| receive, encrypted document   | `decryptVerify`'s `options.maxAttachments`, or `checkDecryptedDocument`'s     | 20 to 1,000 | 20 of each |
| send                          | `signEncrypt`'s `BTPCryptoOptions.maxAttachments`, or `checkDocumentToSend`'s | 0 to 1,000  | 20 of each |

A server counts the attachments of an unencrypted document when it arrives.
It cannot count an encrypted one: that is counted where it is opened. Past
the limit, either answers `BTP_ERROR_VALIDATION` (400), with a message such as
`a letter may carry at most 20 attachments here; it carries 21`. `signEncrypt`
refuses to encrypt a document past the sender's own limit, with the same
error.

Each setting is one number for every type, or one for each type, the rest at
20 (`BTPAttachmentLimits`). It takes whole numbers only: a value that is not
whole is warned about and 20 is used, and one above 1,000 is warned about and
1,000 is used.

A platform that takes up to 100 attachments on a letter or an agreement, and
sends one file on an invoice, a receipt or a payslip:

```ts check
import type { BTPAttachmentLimits } from '@btps/sdk/server';

// What it takes: 100 on a letter or an agreement; the others stay at the guaranteed 20.
// Give it to BtpsServer, and to decryptVerify, as maxAttachments.
export const receiveAttachments: BTPAttachmentLimits = { letter: 100, agreement: 100 };

// What it sends: one file on an invoice, a receipt or a payslip.
// Give it to signEncrypt, in its options, as maxAttachments.
export const sendAttachments: BTPAttachmentLimits = {
  invoice: 1,
  receipt: 1,
  payslip: 1,
  letter: 100,
  agreement: 100,
};
```

Sending 100 on a letter is this platform's own choice: a receiver that takes
only 20 refuses it. How large the files may be together is a separate limit,
the [artifact size](#artifact-size) (see also [Large documents](#large-documents)).

### Encrypted documents

An encrypted document is checked the same way, by the two parties that can
read it:

- **the sender's SDK** checks it before encrypting, and refuses to send it;
- **the receiver's SDK** checks it after decrypting, and refuses it with
  `BTP_ERROR_VALIDATION`.

The servers in between see only ciphertext, which the artifact size bounds.

`signEncrypt`, `decryptVerify`, `BtpsClient`, `BtpsTransporter` and
`BtpsAgent` always check. The low-level `encryptBtpPayload` and
`decryptBtpPayload` check only when given the document's artifact type as
their last argument, for example `'BTPS_DOC'`; a direct caller that does not
give one checks the document itself. Since 1.2, `encryptBtpPayloadStream`,
`decryptBtpPayloadStream` and `decryptBtpPayloadStreamWithDecrypter` never
check, because they never hold the whole document: their caller checks it,
with `checkDocumentToSend` before encrypting and `checkDecryptedDocument`
after decrypting, the checks `signEncrypt` and `decryptVerify` run
([Checking the document](../security/decryption.md#checking-the-document)).

### In code

The same numbers are exported, so a platform can set its form fields from
them instead of copying them:

```ts
import { BTPS_FIELD_LIMITS } from '@btps/sdk/server';

BTPS_FIELD_LIMITS.trustRequest.reason; // 2000
BTPS_FIELD_LIMITS.documentId; // 100
BTPS_FIELD_LIMITS.letter.content; // 100000
BTPS_FIELD_LIMITS.lineItems.rows; // 10000
BTPS_FIELD_LIMITS.lineItems.cell; // 1000, since 1.2
BTPS_FIELD_LIMITS.agreement.statementPaddingBucket; // 4096, since 1.2
BTPS_FIELD_LIMITS.agreement.cosignatureCiphertextChars; // 262144, since 1.2
BTPS_FIELD_LIMITS.documentAttachments; // { standard: 20, ceiling: 1000 }, since 1.2
```

## Receiver settings

Each server sets these for what it receives. A value below the minimum is
raised to the minimum, with a warning; the server still starts. Since 1.2,
`maxArtifactSizeKb` is 64 MB by default and at least 64 MB (in 1.1, 5 MB by
default and at least 1 MB), and `maxArtifactsInFlight` is 2 by default (in
1.1, no limit).

| Setting                      | Default           | Minimum   | What it bounds                                                                                   |
| ---------------------------- | ----------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `maxArtifactSizeKb`          | 65,536 KB (64 MB) | 65,536 KB | the size of one artifact, attachments included (`BTP_ERROR_ARTIFACT_TOO_LARGE`)                  |
| `maxArtifactAgeSeconds`      | 300 (5 minutes)   | 60        | how far `issuedAt` may be from the server's clock, either way (`BTP_ERROR_ARTIFACT_TIME_WINDOW`) |
| `connectionTimeoutMs`        | 30,000 (30 s)     | none      | how long a connection with nothing in flight stays open                                          |
| `maxInFlightPerConnection`   | 32                | 1         | how many requests one connection may have handled at once                                        |
| `maxArtifactsInFlight`       | 2                 | 1         | since 1.2: how many artifacts the whole server may read and handle at once                       |
| `maxArtifactsWaiting`        | 100               | 0         | since 1.2: how many artifacts may wait for a place                                               |
| `maxConsecutiveInvalidLines` | 10                | 1         | since 1.2: how many lines in a row one connection may send that the server cannot read           |
| `retiredKeyGraceSeconds`     | 86,400 (1 day)    | 0         | since 1.2: how long a key rotated away as planned still signs (see Key Rotation)                 |
| `keyChainMaxCacheSeconds`    | 300 (5 minutes)   | 0         | since 1.2: the longest a key chain is trusted from a cache: the worst-case revocation delay      |
| `maxAttachments`             | 20 of each type   | 20        | since 1.2: attachments in a `1.2.0` document, by type, at most 1,000 (see Attachments)           |

### Requests in flight

A sender may write its next artifact before the answer to the last one
arrives. Once a connection has `maxInFlightPerConnection` requests being
handled, the server reads nothing more from it until one finishes. The
sender is then slowed by TCP; nothing is refused, and every artifact is
answered in turn. Without this, a sender that never waits could make the
server hold any number of artifacts in memory at once.

A request is handled until its answer is written, a signed answer included,
so a server that signs its answers (`signAnswers`) signs no more at once than
the limit. Since 1.2, a connection that sends `maxConsecutiveInvalidLines`
lines in a row the server cannot read (not JSON, or not a valid artifact) has
the last one answered and is ended, with `status.closing`; a line it can read
starts the count again. A connection that has gone is sent nothing, and no
answer is signed for it.

### Artifacts across the server

Since 1.2, a server also limits how many artifacts it reads and handles at
once over every connection, with `maxArtifactsInFlight`: 2 by default. An
artifact takes a place before its first byte is read, and gives it up once
its answer is written. Two artifacts of the 64 MB every server takes need
about 380 MB, so a server that sets nothing fits a 512 MB container.

A place is held until its artifact is answered (its verification, its key
lookups, the handler), whatever its size. A busy server raises
`maxArtifactsInFlight` to handle more small artifacts at once, or runs more
instances.

An artifact that finds no place waits, in order of arrival, up to
`maxArtifactsWaiting` (100 by default). While it waits, the server reads
nothing from its connection, so the sender is held by TCP and the waiting
artifact costs the server no memory. `connectionTimeoutMs` does not close a
connection that is waiting for a place: the wait is the server's, not the
sender's. A connection that closes while waiting gives up its turn, and places
held for lines read but not yet handled are given back when it closes.

The next artifact past the queue is answered `BTP_ERROR_TEMPORARILY_UNAVAILABLE`
(503), and its connection ends gently: the server reads and drops what the
sender still sends, so the answer reaches it. Once a place frees, the first
waiting artifact goes in, and once the queue is below its limit, the next
newcomer waits instead of being refused. With `maxArtifactsInFlight` 2 and
`maxArtifactsWaiting` 300, two are read at once, 300 wait, and the 303rd to
arrive at that moment is told 503. When one finishes, a waiting one goes in,
and there is room for one more to wait. With `maxArtifactsWaiting` 0, nothing
waits: the first past the limit is refused at once.

`maxArtifactsInFlight` is a whole number above 0: any other value is warned
about and 1 is used. A `maxArtifactsWaiting` that is not a whole number is
warned about and 100 is used, and one below 0 is warned about and 0 is used.

The two limits complement each other. `maxInFlightPerConnection` bounds one
connection, and counts an artifact only once it has been read whole.
`maxArtifactsInFlight` bounds the whole server, and counts an artifact before
it is read.

**For senders.** A 503 means the receiver is busy: send the same artifact
again later. A provider's outbox, which retries, does this.

### Artifact size

Since 1.2, every server takes artifacts up to 64 MB (65,536 KB), so a sender
within it is never refused for its size. That is about 30 MB of files, plus
the document's own fields: a file grows about 1.78 times, base64 inside the
document, then encrypted and base64 again. A server may take more, with no
maximum. A value below 64 MB is warned about and 64 MB is used.

Above 64 MB, `maxArtifactSizeKb` is the receiver's choice, so a sender learns
it only when an artifact is refused. A document with more files may need to
be split. The guarantee holds between 1.2 servers: a 1.1 server keeps its own
default of 5 MB, and takes at least 1 MB.

The exported defaults are `DEFAULT_MAX_ARTIFACT_SIZE_KB`,
`MIN_MAX_ARTIFACT_SIZE_KB`, `DEFAULT_MAX_ARTIFACT_AGE_SECONDS`,
`MIN_MAX_ARTIFACT_AGE_SECONDS`, `DEFAULT_CONNECTION_TIMEOUT_MS`,
`DEFAULT_MAX_IN_FLIGHT_PER_CONNECTION`, `MIN_MAX_IN_FLIGHT_PER_CONNECTION` and,
since 1.2, `DEFAULT_MAX_ARTIFACTS_IN_FLIGHT` and
`DEFAULT_MAX_ARTIFACTS_WAITING`, from `@btps/sdk/server/core`.

#### Large documents

An agreement carrying several PDFs can be far larger than an invoice.
`maxArtifactSizeKb` is the receiver's choice, with a floor of 64 MB since 1.2
and no ceiling, so a platform that receives larger agreements raises it
deliberately.

Size it from the largest files you take. Base64 is applied twice, and each
time adds about a third:

1. Inside the document's JSON, each file is base64, so 100 MB of PDFs is about
   133 MB of JSON.
2. An encrypted artifact's payload is base64 of the encrypted JSON, so 133 MB
   of JSON is about 178 MB of payload.

Measured: an agreement with 10 PDFs of 10 MB each gave a 176 MB payload. The
envelope adds a little more. A receiver that takes agreements with up to
105 MB of files should allow about 190 MB (194,560 KB):

```ts check
import { BtpsServer, type BtpsServerOptions } from '@btps/sdk/server';

// Up to 105 MB of files: base64 in the JSON, then base64 again as the
// encrypted payload, plus the envelope.
const MAX_ARTIFACT_SIZE_KB = 194_560; // 190 MB

export const largeDocumentServer = (options: BtpsServerOptions) =>
  new BtpsServer({ ...options, maxArtifactSizeKb: MAX_ARTIFACT_SIZE_KB });
```

**The cost.** A BTPS server reads each artifact as one line, and holds it whole
while it is parsed and its signature verified. The memory one artifact takes is
several times its size (about three times, measured). Size the server for that, and limit how many large artifacts it takes at once:
`maxInFlightPerConnection` bounds how many one connection has handled at once,
and, since 1.2, `maxArtifactsInFlight` bounds how many the whole server takes,
with the rest queued and then refused with 503
([Artifacts across the server](#artifacts-across-the-server)). Set it at about
the memory you have for artifacts ÷ (3 × the largest artifact you accept). For
more at once, run more server instances behind a load balancer, each with its
own places. Chunked encryption, in a later release, is what removes this cost.

**Why the default is 64 MB.** Since 1.2, it is what every server takes, so a
sender within it is never refused for its size. A 64 MB artifact takes about
190 MB of the server's memory while it is read, and with `maxArtifactsInFlight`
at its default of 2, a server nobody configured needs about 380 MB for
artifacts.

**After receipt,** a platform does not have to hold the document whole again.
With the stream functions, it views, stores or forwards it a piece at a time
([Large payloads, a piece at a time](../security/decryption.md#large-payloads-a-piece-at-a-time)).

**For senders.** A sender learns a receiver's limit only when an artifact is
refused, with `BTP_ERROR_ARTIFACT_TOO_LARGE`. A document meant for any 1.2
receiver should stay within 64 MB. To a 1.1 receiver, stay within 1 MB, or
within its default 5 MB where it is known to use it.

## Client and transporter settings

How long a sender waits, and how many connections it keeps. A value below the
minimum is raised to it.

| Setting                | Default         | Minimum | What it bounds                                     |
| ---------------------- | --------------- | ------- | -------------------------------------------------- |
| `connectTimeoutMs`     | 5,000 (5 s)     | 5,000   | the wait to connect                                |
| `replyTimeoutMs`       | 20,000 (20 s)   | 10,000  | the wait for an answer                             |
| `maxQueue`             | 100             | none    | requests queued on one connection                  |
| `maxConnections`       | 10              | none    | connections a transporter keeps, one per receiver  |
| `connectionTTLSeconds` | 300 (5 minutes) | none    | how long an idle transporter connection stays open |

The minimums exist so every receiver gets the same chance to answer: a sender
cannot give up so quickly that a busy but working server looks broken.

The exported values are `DEFAULT_CONNECT_TIMEOUT_MS`, `MIN_CONNECT_TIMEOUT_MS`,
`DEFAULT_REPLY_TIMEOUT_MS`, `MIN_REPLY_TIMEOUT_MS`,
`BTP_TRANSPORTER_DEFAULT_MAX_CONNECTIONS` and
`BTP_TRANSPORTER_DEFAULT_CONNECTION_TTL_SECONDS`, from `@btps/sdk/client`.

## Keys

| Key                        | Limit              |
| -------------------------- | ------------------ |
| RSA signing and encryption | at least 2048 bits |
| AES-GCM authentication tag | exactly 16 bytes   |

## What BTPS does not limit

- **How often anyone may send.** Rate limits are a provider's own decision,
  off unless it turns them on. See
  [Defending your provider](../security/bestPractices.md#defending-your-provider).
- **How many trust requests or documents an identity may receive.**
- **A document's content** beyond the fields listed above, other than the
  artifact size.

## Being stricter

A provider may refuse more than the protocol does: shorter fields, fewer
requests. It does this in its own
[middleware](../../server/middlewares.md), answering with `res.sendError`. It cannot accept more than the protocol allows, since a
document that only one provider accepts is not one every sender can rely on.
The one exception, since 1.2, is how many attachments a `1.2.0` document
carries: a receiver may take more than the guaranteed 20, and a sender that
sends more takes the risk of a refusal ([Attachments](#attachments)).

A provider may be stricter in this way about every field limit except the
number of attachments. Every receiver takes at least 20 of each type, and
must never refuse a `1.2.0` document for carrying 20 or fewer. A provider may
still hold what its own users send to fewer.

The same holds for size. Since 1.2, a server must not refuse an artifact of
64 MB or less for its size ([Artifact size](#artifact-size)).
