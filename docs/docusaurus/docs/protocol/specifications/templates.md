---
title: Templates
sidebar_label: Templates
slug: templates
---

# Templates

Since 1.2. A receiver can show a document the way its sender sees it, even when the receiver is on another provider. The signed document carries a **reference** to its template, never the template itself: `template` on an invoice, a receipt, a payslip or a letter (see [Transporter Artifact](./transporter-artifact.md), Templates).

```json
{
  "template": {
    "name": "acme/classic-invoice",
    "data": {
      "version": "1.2.0",
      "sha256": "lowercase-hex-sha256-of-the-template-file",
      "source": "https://templates.example/acme/classic-invoice@1.2.0",
      "logo": {
        "sha256": "lowercase-hex-sha256-of-the-image",
        "source": "https://templates.example/logos/acme.png"
      }
    }
  }
}
```

In a `1.2.0` artifact, a `source` always comes with its `sha256`, and a `logo` with both. The fingerprint is what makes the reference trustworthy: a receiver never draws whatever an address happens to serve. A `sha256` alone is allowed: a receiver that already holds the file by that fingerprint can use it. The SDK renders no template; it checks only the reference.

## The template file

A template is a JSON file that says how a document looks, never what it says. It never carries or changes the content of the document's own fields: no amount, total, tax, date, party, payee, payment detail, document id or note. It hides nothing, and leaves the sender's verification as the receiver shows it. Its own words are presentation only: labels in place of the provider's default wording, and static terms and footer text.

The format is the JSON Schema [`btps-template.schema.json`](pathname:///schemas/btps-template.schema.json), published with these docs, together with the two rules under [Beyond the schema](#beyond-the-schema). The [golden vectors](./golden-vectors.md) (`templates.vectors.json`) show what it accepts and refuses. This is format `1`:

```json
{
  "format": 1,
  "kinds": ["invoice", "receipt"],
  "page": {
    "font": "source-serif-4",
    "size": "normal",
    "density": "comfortable",
    "background": "#ffffff",
    "text": "#1f2933",
    "muted": "#52606d",
    "accent": "#0b6e4f"
  },
  "logo": { "position": "top-left", "size": "medium" },
  "sections": [
    "header",
    "totals",
    "details",
    "parties",
    "lines",
    "payment",
    "notes",
    "terms",
    "footer"
  ],
  "labels": { "title": "Tax invoice", "to": "Bill to", "amountDue": "Amount due" },
  "lines": { "style": "striped", "header": "accent" },
  "totals": { "style": "accent" },
  "text": {
    "terms": "Payment within 14 days.\nThank you for your business.",
    "footer": "Kauri Studio"
  }
}
```

| Field      | What it says                                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`   | `1`, or `2` (since 1.2, the same for an invoice or receipt). A later format adds fields under a new number, never as a key an older renderer would ignore                                           |
| `kinds`    | The document types it is for: `invoice`, `receipt`. Payslips and letters have templates of their own in [format 2](#format-2-payslips-and-letters)                                                  |
| `page`     | `font`, from a fixed list (below); `size` (`small`, `normal`, `large`); `density` (`compact`, `comfortable`); and the colours `background`, `text`, `muted`, `accent`, each `#rrggbb` in lower case |
| `logo`     | Where the sender's own logo goes and how big: `position` (`top-left`, `top-center`, `top-right`, `none`) and `size` (`small`, `medium`, `large`)                                                    |
| `sections` | The order the document's sections are shown in, each at most once (below)                                                                                                                           |
| `labels`   | Wording in place of the provider's default, by key (below): plain words of 1 to 40 characters                                                                                                       |
| `lines`    | How line items are drawn: `style` (`plain`, `striped`, `boxed`) and `header` (`plain`, `accent`)                                                                                                    |
| `totals`   | How the totals are drawn: `style` (`plain`, `boxed`, `accent`)                                                                                                                                      |
| `text`     | Static `terms` (at most 2,000 characters) and `footer` (at most 300), plain words. Each is required when `sections` lists it                                                                        |

- **Fonts:** `geist`, `source-serif-4`, `atkinson-hyperlegible-next`, `geist-mono`. All four are open-licence, so a receiver draws them from its own copy and fetches nothing.
- **Sections:** `header`, `parties`, `details`, `lines`, `totals`, `payment`, `notes`, `terms`, `footer`. The first seven carry signed fields, and every template shows all seven.
- **Label keys:** `title`, `from`, `to`, `number`, `issued`, `due`, `description`, `quantity`, `unitPrice`, `tax`, `lineTotal`, `subtotal`, `taxTotal`, `total`, `amountDue`, `paid`, `notes`, `payment`.

Every key a template may hold is named in the schema, and any other key is refused.

### A template's own words

A template's labels, terms and footer are printed on every document drawn with it, whoever sent it. So they are plain words only:

- no markup, and no control, hidden or direction-changing character;
- no run of four or more digits (an account, BSB or phone number), so `Payment within 14 days` is fine and `BSB 062-000` is not;
- no web, email or BTPS address.

No payment detail can come from a template.

### Beyond the schema

Two more rules, which a JSON Schema cannot say:

- **Contrast.** `page.text` and `page.muted` contrast with `page.background` at least 4.5:1, and `page.accent` at least 3:1, as WCAG 2 AA measures it.
- **Size.** A template is at most 16 KiB as JSON.

### What a template never does

- **Carry or change a value.** It holds no amount, total, tax, date, party, payee, payment detail, document id or note, and has no field that could change one. Every value shown comes from the signed document.
- **Hide a field.** Every section that carries signed fields is listed, so all of them are shown. A template cannot hide, truncate or reorder what is inside a value.
- **Fetch anything.** It names no address: fonts are from the fixed list, and the logo is the sender's own, named by the document (`template.data.logo`) and checked by its fingerprint. The template says only where the logo goes and how big.
- **Run anything.** It holds no script, style sheet or markup.

## Format 2: payslips and letters

Since 1.2. Format `2` is format 1 for invoices and receipts, word for word but for its number, and adds a template for payslips and one for letters. A format 2 template is for one kind of document. Every rule above holds for all three: the template's own words are plain words, nothing is hidden or fetched, nothing is run, and the contrast and 16 KiB rules apply.

### A payslip

A payslip template has the same fields as an invoice's (`page`, `logo`, `sections`, `labels`, `lines`, `totals`, `text`), with `kinds: ["payslip"]`. Its sections and labels are the payslip's own:

- **Sections:** `header`, `parties` (employer and employee), `period` (pay period, pay date, pay rate), `earnings`, `deductions`, `contributions`, `leave`, `totals` (gross, tax withheld, net, year to date), `terms`, `footer`. The first eight carry signed fields, and every payslip template shows all eight.
- **Label keys:** `title`, `employer`, `employee`, `employeeId`, `payPeriod`, `payDate`, `payRate`, `earnings`, `deductions`, `contributions`, `leave`, `description`, `rate`, `quantity`, `amount`, `balance`, `gross`, `taxWithheld`, `net`, `yearToDate`.
- `lines` styles the earnings, deductions, contributions and leave tables, and `totals` the totals.

### A letter

A letter's body is the sender's own text, in its own format. A letter template never styles, reorders or touches it: it has no sections and no labels. It sets the page, a letterhead and a footer, and nothing else:

```json
{
  "format": 2,
  "kinds": ["letter"],
  "page": {
    "font": "source-serif-4",
    "size": "normal",
    "density": "comfortable",
    "background": "#ffffff",
    "text": "#1f2933",
    "muted": "#52606d",
    "accent": "#0b6e4f"
  },
  "logo": { "position": "top-left", "size": "medium" },
  "letterhead": {
    "fields": ["name", "address", "email", "phone", "identifiers"],
    "align": "start"
  },
  "footer": {
    "signOff": "Yours sincerely,",
    "signature": {
      "slots": ["signature.drawn", "signature.typed", "signature.name", "signature.title"],
      "align": "start"
    }
  }
}
```

| Field        | What it says                                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `letterhead` | Where the sender's own issuer fields go: `fields` lists every one, `name`, `address`, `email`, `phone`, `identifiers`, each once, in the order shown; `align` (`start`, `center`, `end`). Placement only: the values are the document's `issuer`, and one it does not have is not shown |
| `footer`     | Optional. `signOff`, static text such as "Yours sincerely," (plain words, at most 300 characters), and `signature`: the `slots` to show, in order, and their `align`                                                                                                                    |

### Signature slots and their values

A letter template places named **slots**, and the sender fills them. The slots are a fixed list:

| Slot              | Its value                                          |
| ----------------- | -------------------------------------------------- |
| `signature.drawn` | A drawn signature, as data (below)                 |
| `signature.typed` | A typed signature, drawn in the script font Caveat |
| `signature.name`  | The signer's name                                  |
| `signature.title` | The signer's title                                 |

- **The values are the sender's own, and travel in the document.** The sender's provider fills them in when it sends, as `template.data.values` on the letter's template reference, so they are signed with the letter: see [Transporter Artifact](./transporter-artifact.md), Templates. Where a value comes from is the provider's: its user's settings, for example.
- **The receiver draws exactly those values in the slots the template places,** and fetches nothing. A value for a slot the template does not place is not drawn.
- **A value never fills, overrides or shadows a document field.** Its keys are the slot names above, and any other key is refused. Values are only on a letter's template, and only in a `1.2.0` artifact.
- **They are the sender's own data, not template text,** so the digit and address rules for a template's words do not apply to them. A text value is still plain text of 1 to 100 characters: no markup, and no control, hidden or direction-changing character.
- **A typed signature** is drawn in Caveat, an open-licence script font (SIL Open Font License 1.1), which a receiver holds itself. It is for the typed signature only: a template cannot set it as its page font.
- **A drawn signature is data, never SVG or any markup:** `{ "strokes": [[x, y, x, y, …], …] }`. Each stroke is integer points on a canvas 1,000 wide and 300 high, from `0, 0` at the top left. The receiving provider draws the lines itself. It holds at most 32 strokes, at most 512 points a stroke, and at most 2,048 points in all.

**A signature here is decoration and proves nothing.** It is a styled signature block, like the one an e-signature service prints, and anyone can type a name or draw a line. It records no agreement and is not evidence that the signer agreed to anything. A letter's acceptance, signed with the user's device key, is what records agreement, and it comes in a later version of BTPS.

### Its fingerprint

A template's `sha256`, the one `template.data.sha256` names, is the lowercase hex SHA-256 of its [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form: the same canonical JSON that artifacts are signed over. So the same template has one fingerprint however it is spaced or ordered. The vectors give one template, its canonical form and its fingerprint.

## The receiving side

When and how a template is fetched is each provider's own: it fetches when it can read the document, on arrival for a readable one, or when its user first views it for one only the user can open. What the protocol fixes is safety:

- **Draw only what matches.** A provider draws a template only when its fingerprint is `sha256` and it is a valid template for the document's type, in a format it knows.
- **The logo too.** It draws the logo only if its bytes match `logo.sha256` and are a PNG, JPEG or WebP image.
- **Fall back.** On any failure (no answer, a mismatch, an invalid file, a document type the template is not for) it shows the standard view. The signed document is always shown in full, so nothing depends on how long a template stays available.

Advice, not a rule: fetch a template once and keep it by its `sha256`, so the template's host is not told every time a document is read.
