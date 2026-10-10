---
title: Document Model v2
sidebar_label: Document Model v2
---

# Document Model v2

Document model v2 is the content layer for four document types: **invoice**,
**credit note**, **payslip**, and **lifecycle event**. It defines how each
type is shaped, validated, and reconciled — independent of the envelope
(`id`, `issuedAt`, `type`, `from`, `to`, selectors) that carries it over the
wire. Source: `src/schema/` (validation) and `src/document-model/`
(money arithmetic, tax-total and payslip reconciliation, immutability).

:::info Relationship to `BTPInvoiceDoc`
This is a separate, newer model from the `BTPInvoiceDoc` / `BTPDocType`
invoice shape described in [Types & Interfaces](../../sdk/typesAndInterfaces.md).
That type continues to describe the document carried inside a
[Transporter Artifact](./transporter-artifact.md) today. Document model v2
is validated by `DocumentV2Schema` in `src/schema/index.ts` and does not yet
replace it in the envelope — see the interop note below.
:::

## Money: integer minor units, never a float

Every amount in document model v2 is a `Money` value:

```ts
interface Money {
  amount: number; // integer, minor unit (e.g. cents)
  currency: string; // ISO 4217 code, e.g. "AUD"
}
```

`{ amount: 170000, currency: 'AUD' }` means AUD 1,700.00. `MoneySchema`
rejects a non-integer `amount` and any `currency` outside the ISO 4217 list
in `src/core/server/constants/currency.ts`. The helpers in
`src/document-model/money.ts` (`addMoney`, `subtractMoney`, `sumMoney`,
`moneyEquals`, `zeroMoney`) only ever add and subtract those integers —
nothing in `src/document-model/` or `src/schema/` calls `parseFloat` or
`.toFixed` on a money or decimal-string field.

A rate or quantity (e.g. an hourly rate, hours worked) is carried as a
decimal string — `"32.50"`, `"38"` — for display only. **The line's `amount`
is never recomputed from `rate × quantity`**; it is whatever the issuer
states.

## Invoice

`InvoiceV2Schema` (`src/schema/invoice.ts`). Required: `id`, `issuedAt`,
`lineItems` (at least one), `total`, `taxTotals` (at least one, one entry
per tax rate). Each line item has `description`, `quantity` (decimal
string), `unitPrice`, `lineTotal`, `taxAmount` (all `Money` except
`quantity`), and `taxCategory` — a string rate key (e.g. `"GST10"`,
`"GST0"`) matched against `taxTotals[].taxCategory`.

`invoiceNumber`, `issueDate`, `supplyDate`, `seller`, `buyer`,
`gstInclusive`, `paymentTerms`, `dueDate`, `attachments`, and `extensions`
are optional — richer fields from the design that this ticket's fixtures
don't yet exercise.

`verifyTaxTotal(doc)` (`src/document-model/taxTotal.ts`) recomputes `total`
from `lineItems`, and recomputes each tax rate's total by grouping line
items by `taxCategory`, then compares both against the declared values:

```ts
const check = verifyTaxTotal(invoice);
// check.ok, check.computedTotal, check.declaredTotal,
// check.byCategory: { taxCategory, computedAmount, declaredAmount, ok }[]
```

The total check and the per-category checks are independent — `check.ok`
is true only when the total and every category in `byCategory` agree. It
never throws — a disagreement is reported as `ok: false`, and it is up to
the caller (e.g. a send flow) to decide whether that blocks anything.

## Credit note

`CreditNoteV2Schema` (`src/schema/creditNote.ts`) reuses the invoice line
item shape. Required: `id`, `issuedAt`, `relatesToInvoice`, `lineItems`
(at least one), `total`, `taxTotals` (at least one). `reason` and
`extensions` are optional. `verifyTaxTotal` works on a credit note the same
way it works on an invoice.

`relatesToInvoice` is `{ from, id, sha256 }` — the same `(from, id, sha256)`
reference shape a lifecycle event uses to point at a document. `from` is
carried so that the invariant "a credit note cannot reference a document
from another sender" has something to check against, but that cross-document
check itself is not implemented in this layer.

## Payslip

`PayslipV2Schema` (`src/schema/payslip.ts`). Required: `id`, `issuedAt`,
`employee`, `earnings`, `deductions`, `contributions`, `gross`, `net`.
`jurisdiction`, `employer`, `payPeriod`, `payDate`, `payRate`,
`taxWithheld`, `yearToDate`, `attachments`, and `extensions` are optional.

Like invoice and credit note, `PayslipV2Schema` extends
`IssuedDocumentV2BaseSchema`, so `issuedAt` is required and present on the
parsed, frozen result. (The lifecycle event type is the one document in
this model without `issuedAt` — see below.)

**Earnings and deductions use open, namespaced categories**, not a closed
enum — e.g. `"ordinary"`, `"au:penalty"`, `"au:casual_loading"`. A category
this schema has never seen before still validates, so a new jurisdiction or
a new earnings/deduction kind never blocks an employer from being
compliant. The same is true of the top-level `extensions` field: it is a
free-form, namespaced bag (`z.record(string, unknown)`) carried exactly as
given, never stripped.

```json
{
  "category": "au:penalty",
  "rate": "48.75",
  "quantity": "4",
  "amount": { "amount": 19500, "currency": "AUD" }
}
```

A deduction paid to a named fund or account carries `payee: { name,
accountRef }`. A `contributions[]` entry (superannuation) carries `amount`
and an optional `fund: { name, memberNumber, accountRef }` — optional
because a new employee's contribution in their first 14 days can exist
with no fund assigned yet. A salaried employee's rate is `payRate: {
amount, unit, asAt }`, e.g. `{ amount: { amount: 9500000, currency: "AUD"
}, unit: "annual", asAt: "2026-10-01T00:00:00.000Z" }`.

### Reconciliation is a warning, not a rejection

`reconcilePayslip(doc)` (`src/document-model/payslipReconciliation.ts`) sums
`earnings` into a computed gross, subtracts `deductions` and `taxWithheld`
into a computed net, and compares both against the payslip's declared
`gross` and `net`:

```ts
const result = reconcilePayslip(payslip);
// result.ok, result.computedGross, result.computedNet, result.warnings
```

A payslip whose declared gross or net doesn't match what its own earnings
and deductions add up to **still validates against `PayslipV2Schema`** —
`reconcilePayslip` reports the disagreement in `result.warnings` instead of
throwing. Like `verifyTaxTotal`, this function never reads `rate` or
`quantity`; only the signed `amount` on each line feeds the computation.

## Lifecycle event

`LifecycleEventV2Schema` (`src/schema/lifecycleEvent.ts`). Required: `id`,
`document`, `eventType`, `occurredAt`. `amount` is optional. `eventType` is
one of `paid`, `partially_paid`, `refunded`, `disputed`, or
`dispute_resolved` (the last is still marked `[proposal]` in the design,
not yet a founder decision).

Unlike invoice, credit note, and payslip, `LifecycleEventV2Schema` extends
`DocumentV2BaseSchema`, not `IssuedDocumentV2BaseSchema` — it has no
`issuedAt`. It is signed by the party asserting the event, at the time the
event occurred (`occurredAt`), not at a separate issuance time.

A lifecycle event is **its own, separate signed document** — a status
change is recorded by issuing a new `lifecycle_event` document whose
`document` field — `{ from, id, sha256 }`, the same reference shape a
credit note uses — references the original artifact, never by writing
into the original artifact. There is no generic `status_change` event type
and no `previousStatus`/`newStatus` pair: the design's own rule is that
status never lives inside the signed document, and the enumerated
`eventType`s already say what happened without one.

```json
{
  "type": "lifecycle_event",
  "id": "evt_4001",
  "document": {
    "from": "biller$example.com",
    "id": "inv_2001",
    "sha256": "ae5b9964e2b837793076d01df1613b13f2997d266cba209a1bd058cd8a2c35bf"
  },
  "eventType": "paid",
  "occurredAt": "2026-10-03T00:00:00.000Z",
  "amount": { "amount": 170000, "currency": "AUD" }
}
```

## Parsing and immutability

`parseDocumentV2(raw)` (`src/document-model/parse.ts`) validates an unknown
value against `DocumentV2Schema` — the discriminated union of all four types
above, keyed on `type` — and returns either:

```ts
{ success: true, data: DocumentV2 }
| { success: false, errors: ZodIssue[] }
```

On success, `data` has been passed through `freezeDocument`
(`src/document-model/immutability.ts`), which deep-freezes the parsed
object and every nested object and array. Any later attempt to mutate a
parsed document in place — reassigning a field, pushing to a line-items
array — throws a `TypeError` rather than silently changing it. This is the
structural half of the model's core guarantee: **a status change never
alters the original artifact's bytes**. (The other half — that a *stored*
artifact can't be overwritten or deleted at the storage layer — is
infrastructure, not something this module can enforce.)

## Interop note

Document model v2 is new in BTPS 1.1; a 1.0 peer has no `payslip`,
`credit_note`, or `lifecycle_event` shape to break. This layer validates
and reconciles document content only — it does not change what envelope
version a server advertises or accepts.
