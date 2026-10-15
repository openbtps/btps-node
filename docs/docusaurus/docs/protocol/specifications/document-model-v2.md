---
title: Document Model v2
sidebar_label: Document Model v2
---

# Document Model v2

Document model v2 is what an unencrypted `BTPS_DOC` carries in BTPS 1.1: an
**invoice**, a **credit note** or a **payslip**, told apart by `type`. It
replaces the 1.0 invoice, which 1.1 refuses.

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
  verifyTaxTotal,
  reconcilePayslip,
  BTP_DOC_LIMITS,
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
| Strict | A field the model does not name is refused, not silently dropped, so what is validated is exactly what was signed. `extensions` is the one open place |
| Size caps | Every string, array and attachment is bounded (see [Size caps](#size-caps)) |

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

A rate or quantity is a decimal string (`"32.50"`, `"38"`) for display only.
**A line's amount is never recomputed from rate × quantity**; it is what the
issuer states.

## Invoice

`BtpInvoiceV2DocSchema`, type `BTPInvoiceV2Doc`.

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion`, `type: "invoice"`, `id` | yes | See above |
| `issuedAt` | yes | ISO 8601 date-time |
| `title` | yes | What the invoice is for, 1 to 200 characters |
| `lineItems` | yes, 1 to 500 | `description`, `quantity` (decimal string), `unitPrice`, `lineTotal`, `taxAmount` (money) and `taxCategory`, the rate key (e.g. `"GST10"`) |
| `total` | yes | Money |
| `taxTotals` | yes, 1 to 50 | One `{ taxCategory, amount }` per rate |
| `replaces` | no | `{ from, id, sha256 }`: the invoice this corrected one replaces, e.g. after an accepted dispute. `from` must be the sender (see [Ownership](#ownership)) |
| `invoiceNumber` | no | Up to 64 characters |
| `issueDate`, `supplyDate`, `dueDate` | no | ISO 8601 date-times |
| `seller`, `buyer` | no | `{ name, address?, taxIds? }` |
| `gstInclusive` | no | Boolean |
| `paymentTerms` | no | Free text |
| `attachments` | no, up to 10 | `{ name, mediaType, size, sha256 }`: a description and hash of each file, `size` in bytes |
| `extensions` | no | See [Extensions](#extensions) |

### Tax totals are verified, and a mismatch is a warning

`verifyTaxTotal(doc)` (invoice or credit note) recomputes the total from the
line items, and the tax per rate by grouping lines by `taxCategory`, and
compares both with the declared values:

```ts
const check = verifyTaxTotal(invoice);
// check.ok, check.computedTotal, check.declaredTotal,
// check.byCategory: { taxCategory, computedAmount, declaredAmount, ok }[]
```

It never throws for a disagreement: `ok` is false, and whether that blocks
anything is the receiving platform's decision. The schema does not refuse a
document whose totals disagree.

## Credit note

`BtpCreditNoteDocSchema`, type `BTPCreditNoteDoc`. Required: `id`,
`issuedAt`, `relatesToInvoice`, `lineItems`, `total`, `taxTotals`, with the
invoice's line item and tax total shapes. Optional: `reason`, `extensions`.

`relatesToInvoice` is `{ from, id, sha256 }`, the invoice it corrects. Its
`from` must be the credit note's own sender (see [Ownership](#ownership)).

## Payslip

`BtpPayslipDocSchema`, type `BTPPayslipDoc`. Required: `id`, `issuedAt`,
`employee` (`{ name, employeeId?, payBasis? }`), `earnings`, `deductions`,
`contributions` (up to 200 each), `gross`, `net`. Optional: `jurisdiction`
(ISO 3166-1 alpha-2), `employer`, `payPeriod`, `payDate`, `payRate`,
`taxWithheld`, `yearToDate` (up to 100 entries), `attachments`,
`extensions`.

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

## Extensions

`extensions` is a free-form, namespaced object (`"au:stateCustomField": {…}`)
carried exactly as given. It is bounded: at most 50 keys, each up to 64
characters, and at most 16 KiB as JSON.

## Ownership

A document can refer to another by `{ from, id, sha256 }`: a credit note's
`relatesToInvoice` and an invoice's `replaces`. **The protocol checks the
structural part:** the reference's `from` must be the artifact's own `from`,
so a sender can only refer to its own documents.

- The server applies this where it validates an unencrypted `BTPS_DOC`
  against its envelope (`BtpTransporterArtifactSchema`). The document schemas
  stay pure; the rule is `validateBtpDocOwnership(document, from)`.
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
Lengths are in characters (UTF-16 code units).

| Cap | Value | Applies to |
| --- | --- | --- |
| `ID_MAX_LENGTH` | 128 | a document id; a reference's `id` |
| `IDENTITY_MAX_LENGTH` | 256 | a reference's `from` |
| `HASH_MAX_LENGTH` | 128 | a reference's or an attachment's `sha256` |
| `TITLE_MAX_LENGTH` | 200 | an invoice's `title` |
| `NAME_MAX_LENGTH` | 200 | names: seller, buyer, employer, employee, payee, fund, attachment |
| `CODE_MAX_LENGTH` | 64 | invoice number, categories, tax categories, tax ids, units, account and member numbers, employee id, `yearToDate` and `extensions` keys |
| `DECIMAL_MAX_LENGTH` | 32 | `quantity`, `rate` |
| `ADDRESS_MAX_LENGTH` | 500 | addresses |
| `TEXT_MAX_LENGTH` | 2000 | descriptions, a credit note's `reason`, `paymentTerms` |
| `MEDIA_TYPE_MAX_LENGTH` | 128 | an attachment's `mediaType` |
| `LINE_ITEMS_MAX` | 500 | `lineItems` |
| `TAX_TOTALS_MAX` | 50 | `taxTotals` |
| `PAYSLIP_LINES_MAX` | 200 | each of `earnings`, `deductions`, `contributions` |
| `TAX_IDS_MAX` | 10 | a party's `taxIds` |
| `YEAR_TO_DATE_MAX` | 100 | `yearToDate` entries |
| `ATTACHMENTS_MAX` | 10 | `attachments` |
| `ATTACHMENT_MAX_BYTES` | 10 MiB | an attachment's declared `size` |
| `EXTENSIONS_MAX_KEYS` | 50 | top-level keys in `extensions` |
| `EXTENSIONS_MAX_LENGTH` | 16 KiB | `extensions` as JSON |

## Interop

Document model v2 is BTPS 1.1. A 1.1 receiver refuses an unencrypted 1.0
invoice (`totalAmount`, `status` inside the document, `lineItems` as columns
and rows). There is no independent BTPS provider yet, so the break costs
nothing now (release plan, section 6). The golden vectors for this page are
`test/vectors/document-model.vectors.json` and `test/vectors/documents/`.
