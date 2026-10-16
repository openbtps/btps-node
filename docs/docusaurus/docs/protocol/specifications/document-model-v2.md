---
title: Document Model v2
sidebar_label: Document Model v2
---

# Document Model v2

Document model v2 is what an unencrypted `BTPS_DOC` carries in BTPS 1.1: an
**invoice**, a **credit note** or a **payslip**, told apart by `type`. The
invoice is the 1.0 invoice with the changes listed under
[What changed from 1.0](#what-changed-from-10); 1.1 refuses the 1.0 shape.

The document is the content only. The [transporter artifact](./transporter-artifact.md)
around it (`id`, `issuedAt`, `type`, `from`, `to`, the selectors, the
signature) is a separate layer.

**In the SDK:** the schemas are in `src/core/server/schemas/documents/`, the
helpers in `src/core/utils/` (`money.ts`, `documentChecks.ts`, `freeze.ts`),
and the size caps in `src/core/server/constants/documents.ts`. All of it is
exported from `@btps/sdk/documents`, which imports no Node built-in and so
also runs on web and React Native:

```ts
import {
  BtpDocV2Schema,
  parseBtpDocV2,
  validateBtpDocOwnership,
  reconcilePayslip,
  verifyAttachments,
  BTP_DOC_LIMITS,
  BTP_DOC_REFERENCE_TYPES,
  CURRENCY_CODES,
  type BTPDocV2,
} from '@btps/sdk/documents';
```

## Rules for every document

| Rule | What it means |
| --- | --- |
| `schemaVersion: 2` | Required. Anything else is refused |
| `type` | `invoice`, `credit_note` or `payslip`. A lifecycle event is not a document: it travels as its own artifact (`BTPS_EVENT`, see [Lifecycle Events](./lifecycle-events.md)) |
| `id` | Required, 1 to 128 characters |
| No status | `status`, `paidAt`, `refundedAt` and `disputedAt` are refused by name. A document is signed and never changes; its status is derived from accepted lifecycle events |
| Strict | A field the model does not name is refused, not silently dropped, so what is validated is exactly what was signed. The open places are a payslip's `extensions`, an invoice's or credit note's `metadata` and an invoice's `template.data` (see [Open objects](#open-objects)) |
| Size caps | Every string, array and attachment is bounded (see [Size caps](#size-caps)) |
| `references` | Related documents, each `{ type, from, id, sha256 }`, all from the same sender (see [References](#references)) |
| `sha256` | Lowercase hex, 64 characters, wherever it appears (see [How a `sha256` is written](#how-a-sha256-is-written)) |

## Money: integer minor units, never a float

Every amount is a `BTPMoney`:

```ts
interface BTPMoney {
  amount: number; // an integer in the currency's minor unit, e.g. cents
  currency: CurrencyCode; // ISO 4217, from CURRENCY_CODES
}
```

`{ "amount": 170000, "currency": "AUD" }` is AUD 1,700.00. `BtpMoneySchema`
refuses a fractional amount, an amount beyond ±(2^53 − 1) (which JSON and
RFC 8785 cannot carry exactly) and a code outside `CURRENCY_CODES`.

The helpers `addMoney`, `subtractMoney`, `sumMoney`, `moneyEquals` and
`zeroMoney` only add and subtract integers. They throw `BTPErrorException`
with `BTP_ERROR_MONEY_NOT_INTEGER`, `BTP_ERROR_MONEY_CURRENCY_MISMATCH` or
`BTP_ERROR_MONEY_OUT_OF_RANGE` for a malformed amount.

On a payslip, a rate or quantity is a decimal string (`"32.50"`, `"38"`)
for display only. **A line's amount is never recomputed from rate ×
quantity**; it is what the issuer states. An invoice's and a credit note's
line items are a table, whose money cells are integers too (see
[Invoice](#invoice)).

## Invoice

`BtpInvoiceV2DocSchema`, type `BTPInvoiceV2Doc`. **The 1.1 invoice is the 1.0
invoice (`BtpInvoiceDocSchema`) with only the changes in the table below**
(decided 2026-10-16).

```ts
interface BTPInvoiceV2Doc {
  schemaVersion: 2;
  type: 'invoice';
  id: string; // the invoice number: unique per sender, separate from the artifact id
  issuedAt: string; // ISO 8601
  title: string; // 1 to 200 characters
  dueAt?: string; // ISO 8601
  totalAmount: { amount: number; currency: CurrencyCode }; // integer minor units
  lineItems: {
    columns: string[];
    rows: Array<Record<string, string | number>>; // strings and integers; never a float
  };
  issuer?: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    identifiers?: Record<string, string>; // namespaced keys: "au:abn", "gb:vat"
  };
  paymentLink?: { linkText: string; url: string };
  description?: string;
  attachments?: BTPAttachment[]; // up to 10
  references?: Array<{ type: string; from: string; id: string; sha256: string }>; // up to 20
  template?: { name: string; data: Record<string, unknown> }; // a marketplace template
  metadata?: Record<string, unknown>; // the provider's own data
}
```

```json
{
  "schemaVersion": 2,
  "type": "invoice",
  "id": "inv_2001",
  "issuedAt": "2026-10-01T00:00:00.000Z",
  "title": "Consulting, September 2026",
  "dueAt": "2026-10-31T00:00:00.000Z",
  "totalAmount": { "amount": 185000, "currency": "AUD" },
  "lineItems": {
    "columns": ["Description", "Quantity", "Unit price", "Tax code", "Tax", "Amount"],
    "rows": [
      { "Description": "Consulting services", "Quantity": 10, "Unit price": 15000, "Tax code": "GST", "Tax": 15000, "Amount": 165000 },
      { "Description": "Export services (GST-free)", "Quantity": 1, "Unit price": 20000, "Tax code": "GST-free", "Tax": 0, "Amount": 20000 }
    ]
  },
  "issuer": {
    "name": "Biller Pty Ltd",
    "email": "accounts@biller.example.com",
    "address": "Level 3, 1 Example Street, Sydney NSW 2000, Australia",
    "identifiers": { "au:abn": "51824753556" }
  },
  "metadata": { "biller:customerRef": "CUST-0042" }
}
```

### What changed from 1.0

| Field | BTPS 1.0 | BTPS 1.1 |
| --- | --- | --- |
| `schemaVersion`, `type` | absent | `2` and `"invoice"`: required, so a receiver tells the invoice from a credit note or payslip |
| `totalAmount` | `{ value, currency }`, `value` a float | `{ amount, currency }`, `amount` an integer in minor units (cents) |
| `lineItems` | `{ columns, rows }`, cells strings or numbers | Unchanged table. Cells are strings or integers; a float is refused. Money cells are in minor units of the invoice's currency |
| Tax | in the line items | Unchanged: tax stays in the line items, as columns such as "Tax" and "Tax code" |
| `issuer` | `{ name, email?, phone? }` | Adds `address?` and `identifiers?`: company and tax ids for any country, by namespaced key (`"au:abn"`) |
| `attachment` | one `{ content, type, filename? }` | `attachments`: a list of `{ content, name, mediaType, size, sha256 }` (see [Attachments](#attachments)) |
| `references` | absent | New: related documents, e.g. a corrected invoice's `correction_of` (see [References](#references)) |
| `metadata` | absent | New: the provider's own data. Carried and signed; the protocol never reads it |
| `status`, `paidAt`, `refundedAt`, `disputedAt` | in the document | Removed, and refused by name: status comes from lifecycle events (`BTPS_EVENT`) |
| `id`, `title`, `issuedAt`, `dueAt`, `paymentLink`, `description`, `template` | | Unchanged, with size caps |
| Strictness | unknown fields passed through | Every object is strict and every string, list and open object capped |
| Credit note | none | New: `type: "credit_note"`, the 1.1 invoice's shape with a required `credits` reference, an optional `reason` and a positive `totalAmount` (see [Credit note](#credit-note)) |

### Line items: a table the issuer lays out

`lineItems` is 1.0's table: the issuer names the columns, and each row maps
a column name to a cell. Tax is in the line items, as columns, so any
country's tax fits without the protocol knowing its rules.

**Money cells are integers in minor units of the invoice's currency.** The
protocol cannot know which cells are money, so it refuses every float: a
cell is a string (up to 2,000 characters) or an integer. A quantity such as
1.5 is written as a string (`"1.5"`). The protocol does not add the rows up
or compare them with `totalAmount`; that is the receiving platform's
decision.

### Issuer identifiers

`issuer.identifiers` holds company and tax ids by namespaced key, the
pattern payslip categories use, with the namespace required:
`{ "au:abn": "51824753556", "gb:vat": "GB123456789" }`. A key without a
namespace (`"abn"`) is refused. The set is open: an unknown scheme
validates. Up to 10 entries, each value up to 64 characters.

### Metadata

`metadata` is the provider's own data, such as its customer or ledger
references. It is carried exactly as given and signed with the invoice; the
protocol never reads it. It is capped like `extensions` (see
[Open objects](#open-objects)).

### Removed from the invoice proposed in PR #9

PR #9's invoice additions are not part of 1.1: `invoiceNumber` (the `id` is
the invoice number), `issueDate`, `supplyDate`, `seller`, `buyer`, the
structured line items with `taxCategory`, `taxTotals`, `gstInclusive`,
`paymentTerms`, `dueDate` and `extensions`. Each is refused as an unknown
field.

## Credit note

`BtpCreditNoteDocSchema`, type `BTPCreditNoteDoc`. **The 1.1 credit note
takes the 1.1 invoice's shape** (decided 2026-10-16, EBA-119): the same
line-item table, issuer, attachments and metadata, built from the same
schemas, so the two cannot drift.

```ts
interface BTPCreditNoteDoc {
  schemaVersion: 2;
  type: 'credit_note';
  id: string; // the credit note number: unique per sender
  issuedAt: string; // ISO 8601
  title: string; // 1 to 200 characters
  totalAmount: { amount: number; currency: CurrencyCode }; // integer minor units, greater than zero
  lineItems: {
    columns: string[];
    rows: Array<Record<string, string | number>>; // strings and integers; never a float
  };
  issuer?: { name: string; email?: string; phone?: string; address?: string; identifiers?: Record<string, string> };
  description?: string;
  attachments?: BTPAttachment[]; // up to 10
  references: Array<{ type: string; from: string; id: string; sha256: string }>; // at least one "credits"
  reason?: string; // why it was credited: 1 to 500 characters
  metadata?: Record<string, unknown>; // the provider's own data
}
```

```json
{
  "schemaVersion": 2,
  "type": "credit_note",
  "id": "cn_3001",
  "issuedAt": "2026-10-02T00:00:00.000Z",
  "title": "Credit note for invoice inv_2001",
  "totalAmount": { "amount": 22000, "currency": "AUD" },
  "lineItems": {
    "columns": ["Description", "Quantity", "Unit price", "Tax code", "Tax", "Amount"],
    "rows": [
      { "Description": "Partial credit: consulting services", "Quantity": 1, "Unit price": 20000, "Tax code": "GST", "Tax": 2000, "Amount": 22000 }
    ]
  },
  "issuer": { "name": "Biller Pty Ltd", "identifiers": { "au:abn": "51824753556" } },
  "references": [
    { "type": "credits", "from": "biller$example.com", "id": "inv_2001", "sha256": "ae5b9964e2b837793076d01df1613b13f2997d266cba209a1bd058cd8a2c35bf" }
  ],
  "reason": "One consulting day was not delivered."
}
```

- **`references` is required** and must include a `credits` entry naming
  the invoice the credit note credits (see [References](#references)). Every
  reference's `from` must be the envelope's `from` (see
  [Ownership](#ownership)). It replaces the `relatesToInvoice` field proposed
  earlier.
- **Amounts are positive.** `totalAmount.amount` must be greater than zero:
  `type: "credit_note"` is what says the amount is a credit, so it carries no
  sign. A zero or negative `totalAmount` is refused. Write the table's money
  cells the same way, as the amounts credited; the protocol does not read
  the cells, so it does not check their sign.
- **Tax is in the line items**, as columns, exactly as on the invoice. The
  protocol does not add the rows up or compare them with `totalAmount`.
- `reason` is new and optional: a short line saying why the invoice was
  credited, 1 to 500 characters (`REASON_MAX_LENGTH`).
- Strict, as every v2 object: the status fields are refused by name, and an
  invoice's `dueAt`, `paymentLink` and `template` are refused as unknown
  fields.

### Removed from the credit note proposed in PR #9

The structured line items (`description`, `quantity`, `unitPrice`,
`lineTotal`, `taxAmount`, `taxCategory`), `total`, `taxTotals` and
`extensions` are not part of 1.1, and each is refused. `verifyTaxTotal`, which
checked `taxTotals` against those lines, is removed from the SDK, with the
`TAX_TOTALS_MAX` cap. The money helpers (`addMoney`, `sumMoney`, …) stay:
`reconcilePayslip` uses them.

## Payslip

`BtpPayslipDocSchema`, type `BTPPayslipDoc`. Required: `id`, `issuedAt`,
`employee` (`{ name, employeeId?, payBasis? }`), `earnings`, `deductions`,
`contributions` (up to 200 each), `gross`, `net`. Optional: `jurisdiction`
(ISO 3166-1 alpha-2), `employer`, `payPeriod`, `payDate`, `payRate`,
`taxWithheld`, `yearToDate` (up to 100 entries), `attachments` (as on an
invoice, see [Attachments](#attachments)), `extensions`.

**Categories are open and namespaced** (`"ordinary"`, `"au:penalty"`,
`"au:casual_loading"`). A category the SDK has never seen still validates,
so a new jurisdiction or kind of earning never blocks an employer.

- A deduction paid to a fund or account carries `payee: { name, accountRef? }`.
- A contribution (superannuation) carries `amount` and an optional
  `fund: { name?, memberNumber?, accountRef? }`; a new employee's first
  contribution may have no fund yet.
- A salaried rate is `payRate: { amount, unit, asAt }`, e.g. `unit: "annual"`.

### Reconciliation is a warning, not a rejection

`reconcilePayslip(doc)` sums `earnings` into a gross, subtracts `deductions`
and `taxWithheld` into a net, and compares both with the declared `gross`
and `net`:

```ts
const result = reconcilePayslip(payslip);
// result.ok, result.computedGross, result.computedNet, result.warnings
```

A payslip that does not reconcile still validates; the disagreement is in
`result.warnings`.

## Attachments

**The file travels inside the document, as in BTPS 1.0.** An invoice or a
payslip carries the PDF or image itself; there is no separate download.
1.0's `attachment: { content, type, filename? }` becomes a list, with the
size and hash stated beside the bytes:

| Field | Meaning |
| --- | --- |
| `content` | The file's bytes in standard base64 with padding (RFC 4648, section 4). Required |
| `name` | The file name, up to 200 characters |
| `mediaType` | `application/pdf`, `image/jpeg` or `image/png`, as in 1.0 |
| `size` | The decoded length in bytes, 1 to 10 MiB |
| `sha256` | The SHA-256 of the decoded bytes |

A document carries up to 10 attachments (`ATTACHMENTS_MAX`). Each file is at
most 10 MiB decoded (`ATTACHMENT_MAX_BYTES`), and its `content` at most the
base64 length of 10 MiB (`ATTACHMENT_CONTENT_MAX_LENGTH`).

**The schema checks the shape; `verifyAttachments` checks the file.** The
schema refuses a missing `content`, characters outside the base64 alphabet,
a media type other than the three, and anything over a cap.
`verifyAttachments(doc)` decodes each `content` and checks that it is
canonical base64, that it is exactly `size` bytes, and that its SHA-256 is
`sha256`:

```ts
const check = verifyAttachments(invoice);
// check.ok, check.problems: { index, field: 'content' | 'size' | 'sha256', message }[]
```

Unlike the payslip check, a problem here is a refusal: the
server runs `verifyAttachments` on every unencrypted `BTPS_DOC`, and on the
document of an agent's `artifact.send`, and refuses the artifact with the
problem at `document.attachments.<index>.<field>`. For an encrypted
`BTPS_DOC`, the receiving platform runs it after decrypting. It is plain
JavaScript (no Node built-in, no WebCrypto), so it runs the same on Node, web
and React Native.

### How a `sha256` is written

Every `sha256` in a v2 document, an attachment's and a reference's
(`references`), is **lowercase hex, 64 characters**:
`9853e99cb7e9817f7ee8b6fb9ade7c8e023d2520647034a098f7f85ed81e9cb0`. Upper
case, base64 and a prefix such as `sha256:` are refused. The format is
`BTP_DOC_SHA256` in `src/core/server/constants/documents.ts`, the one place
to change it.

## Open objects

Three places carry whatever the sender puts there, exactly as given:
`extensions` on a payslip (namespaced, e.g.
`"au:stateCustomField": {…}`), an invoice's or credit note's `metadata`, and
an invoice's `template.data`. Each is bounded: at most 50 keys, each up to 64
characters, and at most 16 KiB as JSON.

## References

A document names related documents in `references`, a list of up to 20
entries:

```ts
references?: Array<{ type: string; from: string; id: string; sha256: string }>;
```

`type` says what the relation is. It is an open code with the pattern of a
payslip category (`correction_of`, `acme:supersedes`). The protocol names
four, in `BTP_DOC_REFERENCE_TYPES`:

| `type` | Meaning |
| --- | --- |
| `correction_of` | A corrected invoice, e.g. after an accepted dispute, names the invoice it corrects |
| `credits` | A credit note names the invoice it credits. **Required on a credit note** (at least one) |
| `instalment_of` | One payment of several names the invoice it is an instalment of |
| `follows` | The next document in a series names the one it follows |

A platform adds its own under a prefix (`"acme:supersedes"`); bare codes are
the protocol's. A code that is not bare or `namespace:name` is refused.

`id` is the named document's `id` and `sha256` its hash (lowercase hex).
An event's `document` reference is separate and unchanged: it is
`{ from, id, sha256 }` with no `type`.

## Ownership

**The protocol checks the structural part of every reference:** its `from`
must be the artifact's own `from`, so a sender can only refer to its own
documents.

- The server applies this where it validates an unencrypted `BTPS_DOC`
  against its envelope (`BtpTransporterArtifactSchema`), and names the entry
  at fault (`document.references.<index>.from`). The document schemas stay
  pure; the rule is `validateBtpDocOwnership(document, from)`.
- For an encrypted `BTPS_DOC` the server cannot see the document; the
  receiving platform runs the same check after decrypting.
- **Whether the referenced document exists**, and that its `sha256` matches,
  is the receiving platform's check. The SDK server never interprets
  documents.

## Parsing and immutability

`parseBtpDocV2(raw)` validates an unknown value and returns either
`{ data }`, a deep-frozen copy of the document, or `{ error }`, a
`BTPErrorException` with code `BTP_ERROR_DOC_SCHEMA` and each problem's
`path` and `message` in `error.meta.issues`.

It never changes `raw`, and the parsed document is the same as `raw` under
RFC 8785: nothing is added or dropped. Writing to the parsed document throws.
A status change is never a write into a document; it is a separate event.

## Size caps

All caps are in `BTP_DOC_LIMITS` (`src/core/server/constants/documents.ts`).
Lengths are in characters (UTF-16 code units). A `sha256` is not capped by
length: it has one exact form (see [How a `sha256` is written](#how-a-sha256-is-written)).

| Cap | Value | Applies to |
| --- | --- | --- |
| `ID_MAX_LENGTH` | 128 | a document id; a reference's `id` |
| `IDENTITY_MAX_LENGTH` | 256 | a reference's `from` |
| `TITLE_MAX_LENGTH` | 200 | an invoice's or credit note's `title` |
| `NAME_MAX_LENGTH` | 200 | names: issuer, employer, employee, payee, fund, attachment, template; a line-item column; a payment link's text |
| `CODE_MAX_LENGTH` | 64 | categories, reference types, tax ids, identifier keys and values, a phone number, units, account and member numbers, employee id, `yearToDate` keys, open-object keys |
| `EMAIL_MAX_LENGTH` | 254 | the issuer's `email` |
| `URL_MAX_LENGTH` | 2048 | a payment link's `url` |
| `DECIMAL_MAX_LENGTH` | 32 | a payslip line's `quantity`, `rate` |
| `ADDRESS_MAX_LENGTH` | 500 | addresses |
| `TEXT_MAX_LENGTH` | 2000 | descriptions, a text cell in an invoice's or credit note's line items |
| `REASON_MAX_LENGTH` | 500 | a credit note's `reason` |
| `LINE_ITEMS_MAX` | 500 | an invoice's or credit note's line-item rows |
| `LINE_ITEM_COLUMNS_MAX` | 50 | an invoice's or credit note's line-item columns, and the cells in one row |
| `PAYSLIP_LINES_MAX` | 200 | each of `earnings`, `deductions`, `contributions` |
| `TAX_IDS_MAX` | 10 | a payslip employer's `taxIds` |
| `IDENTIFIERS_MAX` | 10 | an invoice issuer's `identifiers` |
| `YEAR_TO_DATE_MAX` | 100 | `yearToDate` entries |
| `REFERENCES_MAX` | 20 | `references` |
| `ATTACHMENTS_MAX` | 10 | `attachments` |
| `ATTACHMENT_MAX_BYTES` | 10 MiB | an attachment's file, decoded: its `size` |
| `ATTACHMENT_CONTENT_MAX_LENGTH` | 13,981,016 | an attachment's `content`: the base64 length of 10 MiB |
| `EXTENSIONS_MAX_KEYS` | 50 | top-level keys in an open object: `extensions`, `metadata`, `template.data` |
| `EXTENSIONS_MAX_LENGTH` | 16 KiB | an open object as JSON |

## Interop

Document model v2 is BTPS 1.1. A 1.1 receiver refuses an unencrypted 1.0
invoice (no `schemaVersion` or `type`, `totalAmount.value` as a float,
`status` inside the document). A 1.0 sender moves to 1.1 by adding
`schemaVersion` and `type`, writing amounts in minor units, dropping the
status fields and turning `attachment` into `attachments`; the line-item
table and the other fields stay as they are. There is no independent BTPS provider yet, so the break costs
nothing now. The golden vectors for this page are
`test/vectors/document-model.vectors.json` and `test/vectors/documents/`.
