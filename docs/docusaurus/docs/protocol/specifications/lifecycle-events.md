---
title: Lifecycle Events (BTPS_EVENT)
sidebar_label: Lifecycle Events
---

# Lifecycle Events (`BTPS_EVENT`)

A lifecycle event says something happened to an invoice or credit note:
it was paid, partly paid, disputed, a refund was asked for or made, or a
proposal was accepted or rejected. It travels as the fourth transporter
type, `BTPS_EVENT`, beside `TRUST_REQ`, `TRUST_RES` and `BTPS_DOC`. BTPS 1.1.

A document never carries its own status. Each side works out an invoice's
status from the trail of **accepted** events; a proposal not yet answered
shows as pending (for example, "Marked paid, waiting for Acme to confirm").

**In the SDK:** the schema is `src/core/server/schemas/documents/eventSchema.ts`,
the helpers are in `src/core/server/schemas/helpers.ts`, the constants in
`src/core/server/constants/documents.ts`, and the trust rule is
`resolveEventTrust` in `src/core/trust/index.ts`. The schema and helpers are
exported from `@btps/sdk/documents`, which imports no Node built-in:

```ts
import {
  BtpEventDocSchema,
  parseBtpEventDoc,
  validateBtpEventEnvelope,
  validateBtpEventReply,
  BTP_EVENT_TYPES,
  BTP_EVENT_DISPUTE_REASONS,
  type BTPEventDoc,
} from '@btps/sdk/documents';
import { resolveEventTrust } from '@btps/sdk/trust';
```

## The flow

The receiver of an invoice (the **payer**) proposes; the sender (the
**biller**) confirms. A status changes only once it is accepted, on both
sides.

| Proposed by        | Event                                                  | Answer                                                                   | Both sides then show                                                              |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Payer              | `paid`                                                 | Biller sends a `response`: accepted or rejected                          | Paid                                                                              |
| Payer              | `partially_paid`, with `amount`                        | Biller accepts with `remainingDueDate` for the rest, or rejects          | Partial: the remaining amount and its due date                                    |
| Payer              | `disputed`, with a `reason`                            | Biller accepts or rejects                                                | Accepted: dispute resolved, and the biller sends a corrected invoice (a `correction_of` reference) |
| Biller             | `paid` (recorded by the biller, e.g. cash or transfer) | None: final                                                              | Paid                                                                              |
| Payer (after Paid) | `refund_requested`                                     | Biller answers with a `refund` and its amount, or a rejecting `response` | —                                                                                 |
| Biller             | `refund`, with `amount`                                | Payer acknowledges with a `response`                                     | Refunded (full or partial)                                                        |

- Several partial payments are allowed; the remaining amount keeps going down.
- The protocol carries no conversation: there is no reason on a rejection,
  and no reminders. The two parties already talk outside the protocol.
- A payer may propose again after a rejection: it is a new event.

## The event document

What an unencrypted `BTPS_EVENT` carries. Every object is strict: a field the
table does not allow on that `eventType` is refused, not dropped.

| Field              | Required                   | Meaning                                                                                                               |
| ------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`    | yes                        | `2`                                                                                                                   |
| `type`             | yes                        | `lifecycle_event`                                                                                                     |
| `id`               | yes                        | A random UUID, equal to the transporter artifact's `id` (see [Ids](#ids-and-the-reply-chain))                         |
| `occurredAt`       | yes                        | When it happened, as the sender states it (ISO 8601)                                                                  |
| `document`         | yes                        | `{ from, id, sha256 }`: the invoice or credit note it is about. `sha256` is over the JCS form of that signed artifact |
| `eventType`        | yes                        | `paid`, `partially_paid`, `disputed`, `refund_requested`, `refund`, `response`                                        |
| `inReplyTo`        | on a reply                 | The `id` of the event being answered: required on `response` and `refund`, refused on every other type                |
| `amount`           | `partially_paid`, `refund` | Money: integer minor units and an ISO 4217 currency, more than zero. Refused on the other types                       |
| `reason`           | `disputed`                 | An open, namespaced code (see below). Refused on the other types                                                      |
| `decision`         | `response`                 | `accepted` or `rejected`. Refused on the other types                                                                  |
| `remainingDueDate` | no                         | Only on an accepted `response`: the agreed date for the rest of a `partially_paid` (ISO 8601)                         |
| `note`             | no                         | Short free text, at most 500 characters (`BTP_DOC_LIMITS.EVENT_NOTE_MAX_LENGTH`)                                      |

**`reason`** is an open code like a payslip category: a bare word or one
namespace (`^[a-zA-Z0-9_]+(:[a-zA-Z0-9_]+)?$`). The protocol names three,
which every platform should understand (`BTP_EVENT_DISPUTE_REASONS`):

| Code            | Meaning                                                |
| --------------- | ------------------------------------------------------ |
| `rejected`      | The payer rejects the invoice                          |
| `amount_wrong`  | The amount is wrong                                    |
| `not_as_agreed` | It is not what the parties agreed outside the protocol |

Another code, such as `au:late_delivery`, still validates.

**`remainingDueDate`** belongs on an accepted response to a `partially_paid`.
The schema cannot know what a response answers, so it allows the field on
any accepted `response` and refuses it on a rejection and on every other
type. That the answered event is a `partially_paid` is the receiving
platform's check.

An example of each type is in the golden vectors,
`test/vectors/events/`.

```json
{
  "schemaVersion": 2,
  "type": "lifecycle_event",
  "id": "abcbbcca-229a-4135-9b86-470f681d365e",
  "occurredAt": "2026-10-22T11:00:00.000Z",
  "document": {
    "from": "billing$acme.example",
    "id": "inv_2001",
    "sha256": "1c838c4117d0cf6f3fe99de6144bf9c27692ff390d4bdf9900c0710751c8d416"
  },
  "eventType": "response",
  "inReplyTo": "89926b24-0e69-4452-b4f7-474f39169153",
  "decision": "accepted",
  "remainingDueDate": "2026-11-30T00:00:00.000Z"
}
```

## Ids and the reply chain

- **The id is a random UUID, like every artifact's.** An artifact is only
  ever between two parties, already named by `from:to`, so an id only has
  to be unique within that pair. No id is computed from content.
- **The global reference** to an event is the pair plus the id:
  `(computeTrustId(from, to), id)`, or simply `(from, to, id)`.
- **One id end to end:** the transporter artifact's `id` is the event's
  `id`. The server refuses an unencrypted event whose ids differ. `BtpsAgent`
  (`event.send`) and `signEncrypt` set the artifact id from the event.
- **The signature proves who sent it;** an id never has to.
- **A reused id is refused** once replay protection lands: it refuses any
  `(from, id)` it has seen before. That is EBA-114 (addendum item 4), not
  yet in the SDK: until then a platform must refuse a repeated `(from, id)`
  itself.

`inReplyTo` is required on every reply:

| Event                                                                     | `inReplyTo`               |
| ------------------------------------------------------------------------- | ------------------------- |
| `paid`, `partially_paid`, `disputed`, `refund_requested` (payer proposes) | none: these start a chain |
| `paid` recorded by the biller                                             | none: final               |
| `response` (biller accepts or rejects a proposal)                         | the proposal's id         |
| `refund` (biller answers a refund request with the amount)                | the `refund_requested` id |
| `response` (payer acknowledges a refund)                                  | the `refund` id           |

Every event names the invoice (`document`) and every reply names what it
answers (`inReplyTo`), so either side, or an auditor holding both, can
rebuild the whole exchange from the pair and the ids: invoice ← proposal ←
reply ← …

## Trust

Trust is directional, keyed `computeTrustId(from, to)`. Once A has accepted
B's trust request (so B may send documents to A), B's server accepts
`BTPS_EVENT` from A automatically, and **only that type**. A still needs its
own trust request to send invoices or other documents, and a third party C
can send events to neither.

The receiving server therefore accepts a `BTPS_EVENT` from `from` to `to`
when **either** record is active (accepted and not expired):

- the normal record, `computeTrustId(from, to)`; or
- the flipped record, `computeTrustId(to, from)`: the receiver's own trust
  to the sender.

Only a record between two identities that names exactly this pair counts.
Device (agent) records share the trust store (`agentId → identity`), and
never count. `BTPS_DOC`, `TRUST_REQ` and `TRUST_RES` are unchanged. When
neither record is active, the refusal carries the reason of the normal
record, else of the flipped one (never trusted, revoked, expired…).

### The structural check

An event may only refer to a document sent between the same two parties:
`document.from` must be the event's `to` (the payer writing back about the
biller's invoice) or its `from` (the biller answering about its own).
Otherwise it is refused. With the trust rule, this means C cannot write
about an invoice between A and B.

## Encryption

- Every event is signed, like every artifact.
- An event is encrypted when the trust's `privacyType` says so: it carries
  amounts, due dates and dispute reasons, which are as private as the
  invoice. The envelope (`from`, `to`, `type`, `issuedAt`, `id`) stays
  readable, so routing and the trust check work.
- **Unencrypted:** the server validates the document against the event
  schema and applies the id and structural checks.
- **Encrypted:** the document is an opaque string to the server, as for
  `BTPS_DOC`. The receiving platform applies the same checks after it
  decrypts (below).

Enforcing `privacyType` itself (refusing an unencrypted event on an
encrypted trust) is fix-list item 8, EBA-444, and is not in this change.

## What the receiving platform checks

The SDK server never interprets documents, and holds no events. These
checks belong to the receiving platform:

1. **For an encrypted event, the protocol's own checks**, after decrypting:
   `parseBtpEventDoc(document)` then
   `validateBtpEventEnvelope(event, artifact)`.
2. **The document exists:** `document` names an invoice or credit note the
   platform holds, between this pair, with that `sha256`.
3. **The reply chain:** an `inReplyTo` names an event already exchanged
   between the same two parties (looked up within the pair), about the same
   document, sent by the other party, of a type the table allows to be
   answered. Once the platform has found the answered event,
   `validateBtpEventReply(reply, answered)` checks all of that except the
   lookup.
4. **The change of state is allowed:** for example, no `refund` before Paid,
   no `remainingDueDate` unless the answered event is a `partially_paid`, a
   refund within what was paid. The protocol cannot check this.
5. **Replay**, until EBA-114 lands: a repeated `(from, id)` is refused.

**Where:** a `before onArtifact` middleware. The existing middleware context
is enough, so the SDK adds no hook: `req.data.artifact` is the verified,
trusted artifact; the platform decrypts it with its own key
(`decryptVerify`), runs the checks above against its store, and refuses with
`res.sendError(...)` before `onArtifact` runs.

```ts
import { decryptVerify } from '@btps/sdk/crypto';
import {
  parseBtpEventDoc,
  validateBtpEventEnvelope,
  validateBtpEventReply,
} from '@btps/sdk/documents';
import { BTP_ERROR_VALIDATION } from '@btps/sdk/error';

export default () => [
  {
    phase: 'before',
    step: 'onArtifact',
    handler: async (req, res) => {
      const { artifact, type } = req.data;
      if (type !== 'transporter' || artifact.type !== 'BTPS_EVENT') return;

      const raw = artifact.encryption ? await openWithMyKey(artifact) : artifact.document;
      const { data: event, error } = parseBtpEventDoc(raw);
      if (error || validateBtpEventEnvelope(event, artifact)) {
        return res.sendError(BTP_ERROR_VALIDATION);
      }
      if (!(await documents.exists(artifact.from, artifact.to, event.document))) {
        return res.sendError(BTP_ERROR_VALIDATION);
      }
      if (event.inReplyTo) {
        const answered = await events.find(artifact.from, artifact.to, event.inReplyTo);
        if (
          !answered ||
          validateBtpEventReply({ event, from: artifact.from, to: artifact.to }, answered)
        ) {
          return res.sendError(BTP_ERROR_VALIDATION);
        }
      }
      // ...and whether the change of state is allowed.
    },
  },
];
```

`openWithMyKey`, `documents` and `events` stand for the platform's own key
handling and storage.

## Sending an event

From a device, with the agent:

```ts
await agent.command('event.send', 'billing$acme.example', event, {
  signature: { algorithmHash: 'sha256' },
  encryption: { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' },
});
```

From a server, with `signEncrypt` and `BtpsTransporter`: pass
`type: 'BTPS_EVENT'` and the event as `document`; the artifact `id` defaults
to the event's `id`.

## Golden vectors

`test/vectors/event.vectors.json`, over the events in `test/vectors/events/`
(`yarn verify:btps-vectors`, checks `sdk/item-A/…`):

- schema cases for every event type, accepted and refused per the tables above;
- the envelope: the id equals the artifact id, and only a document between
  the two parties;
- reply chains: paid then accepted; partially paid then accepted with a due
  date; disputed then rejected; paid recorded by the biller (final); refund
  requested, refunded and acknowledged; and chains that must be refused (a
  reply from the same party, naming an unknown event, from another pair,
  about another document, answering the biller's own `paid`, a `refund`
  answering a `paid`).

The `sha256` values in the vectors are illustrative: the protocol never
recomputes them. Its form is checked: like every `sha256` in a v2 document,
it is lowercase hex, 64 characters (see
[How a `sha256` is written](./document-model-v2.md#how-a-sha256-is-written)).
