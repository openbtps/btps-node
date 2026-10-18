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
  in its own middleware (see [Being stricter](#being-stricter)).
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

### Lifecycle event (`BTPS_EVENT`)

| Field         | Limit |
| ------------- | ----: |
| `message`     | 5,000 |
| `reason`      |    64 |
| `document.id` |   100 |

### Documents (`BTPS_DOC`)

Every document type, invoice, receipt, payslip and letter, limits its
identifiers. Its content (line items, description, attachments) is bounded by
the [artifact size](#artifact-size) unless listed below.

| Field               | Limit |
| ------------------- | ----: |
| `id`                |   100 |
| `references[].id`   |   100 |
| `references[].type` |    64 |

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

| Field          |                  Limit |
| -------------- | ---------------------: |
| `title`        |                    200 |
| `body.content` |                100,000 |
| `attachments`  | 10 (count, not length) |
| `references`   | 20 (count, not length) |

### Encrypted documents

An encrypted document is checked the same way, by the two parties that can
read it:

- **the sender's SDK** checks it before encrypting, and refuses to send it;
- **the receiver's SDK** checks it after decrypting, and refuses it with
  `BTP_ERROR_VALIDATION`.

The servers in between see only ciphertext, which the artifact size bounds.

### In code

The same numbers are exported, so a platform can set its form fields from
them instead of copying them:

```ts
import { BTPS_FIELD_LIMITS } from '@btps/sdk/server';

BTPS_FIELD_LIMITS.trustRequest.reason; // 2000
BTPS_FIELD_LIMITS.documentId; // 100
BTPS_FIELD_LIMITS.letter.content; // 100000
```

## Receiver settings

Each server sets these for what it receives. A value below the minimum is
raised to the minimum, with a warning; the server still starts.

| Setting                 | Default         | Minimum  | What it bounds                                                                                   |
| ----------------------- | --------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `maxArtifactSizeKb`     | 5,120 KB (5 MB) | 1,024 KB | the size of one artifact, attachments included (`BTP_ERROR_ARTIFACT_TOO_LARGE`)                  |
| `maxArtifactAgeSeconds` | 300 (5 minutes) | 60       | how far `issuedAt` may be from the server's clock, either way (`BTP_ERROR_ARTIFACT_TIME_WINDOW`) |
| `connectionTimeoutMs`   | 30,000 (30 s)   | none     | how long a connection with nothing in flight stays open                                          |

### Artifact size

`maxArtifactSizeKb` is the receiver's choice, so a sender learns it only when
an artifact is refused. Every server accepts at least 1 MB. A document meant
for any receiver should stay under that; one with large attachments may need
to be split.

The exported defaults are `DEFAULT_MAX_ARTIFACT_SIZE_KB`,
`MIN_MAX_ARTIFACT_SIZE_KB`, `DEFAULT_MAX_ARTIFACT_AGE_SECONDS`,
`MIN_MAX_ARTIFACT_AGE_SECONDS` and `DEFAULT_CONNECTION_TIMEOUT_MS`, from
`@btps/sdk/server/core`.

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

A provider may refuse more than the protocol does: shorter fields, a smaller
artifact, fewer requests. It does this in its own
[middleware](../../server/middlewares.md), answering with `res.sendError`. It cannot accept more than the protocol allows, since a
document that only one provider accepts is not one every sender can rely on.
