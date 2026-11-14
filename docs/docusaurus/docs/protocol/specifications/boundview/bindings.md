---
title: Bindings and Formats
sidebar_label: Bindings and formats
slug: /protocol/specifications/boundview/bindings
description: How a text element binds a signed field, which fields each document type lets a BoundView bind, and how money, dates, percents and grouped text are written.
---

# Bindings and formats

:::info Reference for implementers
Part of the BoundView specification, for building your own builder or
renderer, or checking one. A platform that uses `@btps/boundview` does not need
it: see [Using BoundView](./using.md).
:::

A `text` element's `bind` names a signed field and says how its value is
written. A receiver draws the value it finds in the document, never text
from the canvas, so a BoundView cannot show a fact the document does not carry.

```json
{ "field": "totalAmount", "format": { "money": { "group": ",", "decimal": ".", "prefix": "A$" } } }
{ "field": "dueAt", "format": { "date": "d MMM yyyy" } }
{ "field": "issuer.identifiers.au:abn", "format": { "groups": { "sizes": [2, 3, 3, 3], "separator": " " } } }
{ "field": "issuer.address", "range": [0, 21] }
{ "field": "lineItems.rows.2.Unit price", "format": { "money": { "group": ",", "decimal": "." , "prefix": "A$" } } }
```

| Field | Type | Required | What it says |
| --- | --- | --- | --- |
| `field` | string | Yes | The signed field, as a path ([below](#fields-that-can-be-bound)). |
| `format` | format | Yes for money, dates and a discount's percent. For text, only to write it in groups. | How the value is written ([Formats](#formats)). Absent for text written as it is. |
| `range` | `[start, end]` | No, text only | The characters of the value this element shows, counted in code points, `end` excluded. It is how a value shown over several lines, or part of a line, is bound. |

## Fields that can be bound

A path names a field by its keys, joined by `.`. A list's entry is named by
its index from 0: `lineItems.rows.2.Unit price`, `earnings.0.amount`. A
line item cell is named by its column's name as the document writes it.

The value column says which [format](#formats) a field takes: **Money**,
**Date** and **Percent** take that format, and **Text** takes
[groups](#groups) or none.

### Invoice and receipt

| Path | Value |
| --- | --- |
| `id` | Text |
| `title` | Text |
| `issuedAt` | Date |
| `dueAt` | Date (an invoice) |
| `totalAmount`, `subtotalAmount`, `taxAmount` | Money |
| `discount.amount` | Money, in the document's currency |
| `discount.percent` | Percent |
| `issuer.name`, `issuer.email`, `issuer.phone`, `issuer.address` | Text |
| `issuer.identifiers.<key>` | Text, e.g. `issuer.identifiers.au:abn` |
| `recipient.name` | Text |
| `description` | Text: a note's content |
| `lineItems.rows.<n>.<column>` | Money when the cell is a number, text when it is text |
| `payment.amount` | Money (a receipt) |
| `payment.paidAt` | Date (a receipt) |
| `payment.method`, `payment.reference` | Text (a receipt) |

### Payslip

| Path | Value |
| --- | --- |
| `id`, `title` | Text |
| `issuedAt`, `payDate`, `payPeriod.start`, `payPeriod.end`, `payRate.asAt` | Date |
| `issuer.name`, `issuer.email`, `issuer.phone`, `issuer.address`, `issuer.identifiers.<key>` | Text |
| `employee.name`, `employee.employeeId` | Text |
| `payRate.amount`, `gross`, `net`, `taxWithheld`, `yearToDate.<key>` | Money |
| `earnings.<n>.description`, `.category`, `.rate`, `.rateUnit`, `.quantity` | Text |
| `earnings.<n>.amount` | Money |
| `deductions.<n>.description`, `.category`, `.payee.name` | Text |
| `deductions.<n>.amount` | Money |
| `contributions.<n>.category`, `.fund.name` | Text |
| `contributions.<n>.amount` | Money |
| `leave.<n>.description`, `.category`, `.unit`, `.balance`, `.accrued`, `.taken` | Text |

### Letter and agreement

| Path | Value |
| --- | --- |
| `id`, `title` | Text |
| `issuedAt` | Date |
| `body.content` | Text, bound by `range` line by line |
| `issuer.name`, `issuer.email`, `issuer.phone`, `issuer.address`, `issuer.identifiers.<key>` | Text |
| `recipient.name` | Text |
| `signatory.name`, `signatory.title` | Text |
| `acceptance.by` | Date (an agreement) |

### Fields that cannot be bound

A field that is not in these tables cannot be bound: `metadata`, an
attachment, a reference, a payment link, the envelope's addresses. The
receiving app shows those around the BoundView
([Using BoundView](./using.md#what-the-receiving-app-shows-around-a-boundview)).

:::warning Refused, not skipped
A binding to a field the document does not have is refused, and with it the
document ([Checks](./checks.md#two-outcomes)).
:::

## Formats

| Format | For | Example | Drawn |
| --- | --- | --- | --- |
| [`money`](#money) | Money | `{ "money": { "group": ",", "decimal": ".", "prefix": "A$" } }` | `A$1,452.00` |
| [`date`](#date) | Dates | `{ "date": "d MMM yyyy" }` | `25 Nov 2026` |
| [`percent`](#percent) | `discount.percent` | `{ "percent": { "decimals": 0, "decimal": "." } }` | `10%` |
| [`groups`](#groups) | Text written in groups | `{ "groups": { "sizes": [2, 3, 3, 3], "separator": " " } }` | `51 824 753 556` |
| [none](#text) | Text written as it is | | The value, or its `range` |

### Money

```json
{ "money": { "group": ",", "decimal": ".", "prefix": "A$", "suffix": "" } }
```

| Field | Type | Required | What it says |
| --- | --- | --- | --- |
| `group` | string | Yes | The thousands separator: `,`, `.`, ` ` (space), `'`, or `""` for none. |
| `decimal` | string | Yes | The decimal mark: `.` or `,`. Not the same as `group`. |
| `prefix`, `suffix` | string | No | Up to 8 characters each, written before and after the number: `A$`, `€`, ` AUD`, `kr`. |

The digits come from the amount: an integer in the minor units of its
currency, with as many decimal places as ISO 4217 gives that currency. A
negative amount is written with `-` before the prefix.

| Amount | Format | Drawn |
| --- | --- | --- |
| 145200 AUD | `group ","`, `decimal "."`, `prefix "A$"` | `A$1,452.00` |
| 145200 EUR | `group "."`, `decimal ","`, `suffix " €"` | `1.452,00 €` |
| 4997 JPY | `group ","`, `decimal "."`, `prefix "¥"` | `¥4,997` |
| -2500 AUD | `group ","`, `decimal "."`, `prefix "A$"` | `-A$25.00` |

:::note
The prefix and suffix are the sender's words, as a label is. The number is
always the signed amount.
:::

### Date

```json
{ "date": "d MMM yyyy" }
```

A date is drawn from the calendar date of the field's value in UTC, in one of
these patterns:

| Pattern | 2026-11-25 is drawn |
| --- | --- |
| `d MMM yyyy` | 25 Nov 2026 |
| `d MMMM yyyy` | 25 November 2026 |
| `MMM d, yyyy` | Nov 25, 2026 |
| `MMMM d, yyyy` | November 25, 2026 |
| `dd/MM/yyyy` | 25/11/2026 |
| `MM/dd/yyyy` | 11/25/2026 |
| `dd.MM.yyyy` | 25.11.2026 |
| `dd-MM-yyyy` | 25-11-2026 |
| `yyyy-MM-dd` | 2026-11-25 |

Month names are English: `Jan` to `Dec`, `January` to `December`.

### Percent

```json
{ "percent": { "decimals": 0, "decimal": "." } }
```

For `discount.percent`, whole basis points: 1000 is drawn `10%` with
`decimals` 0, `10.00%` with 2. `decimals` is 0, 1 or 2.

### Groups

```json
{ "groups": { "sizes": [2, 3, 3, 3], "separator": " " } }
```

For text written in groups, such as a company number: the value's
characters, spaces removed, in groups of these sizes joined by `separator`
(one character), with 1 to 32 sizes. `51824753556` with `[2, 3, 3, 3]` is
drawn `51 824 753 556`. The sizes add up to the value's length, or the binding is
refused.

### Text

No `format`: the value as the document writes it, or the part of it `range`
names. A note's or a letter body's `range` counts the characters of its
`content` as written. A markdown body's formatting marks (`#`, `*`, `_`,
`` ` ``, `>`, a list's `-`) need not be inside a range; its words must be.

```json
{ "field": "body.content", "range": [0, 39] }
{ "field": "body.content", "range": [40, 76] }
```

Together, the ranges of a letter's body cover every word of it: each word
is a [key fact](./checks.md#key-facts). The [letter example](./examples.md#a-letter-with-its-signatory)
binds a body over two lines this way.
