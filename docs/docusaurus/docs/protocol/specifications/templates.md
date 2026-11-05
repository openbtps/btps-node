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
| `format`   | `1`. A later format adds fields under a new number, never as a key an older renderer would ignore                                                                                                   |
| `kinds`    | The document types it is for: `invoice`, `receipt`. A letter or payslip may name a template, but format 1 has none for them, so they are shown in the standard view until a later format adds them  |
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

### Its fingerprint

A template's `sha256`, the one `template.data.sha256` names, is the lowercase hex SHA-256 of its [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form: the same canonical JSON that artifacts are signed over. So the same template has one fingerprint however it is spaced or ordered. The vectors give one template, its canonical form and its fingerprint.

## The receiving side

When and how a template is fetched is each provider's own: it fetches when it can read the document, on arrival for a readable one, or when its user first views it for one only the user can open. What the protocol fixes is safety:

- **Draw only what matches.** A provider draws a template only when its fingerprint is `sha256` and it is a valid template for the document's type.
- **The logo too.** It draws the logo only if its bytes match `logo.sha256` and are a PNG, JPEG or WebP image.
- **Fall back.** On any failure (no answer, a mismatch, an invalid file, a document type the template is not for) it shows the standard view. The signed document is always shown in full, so nothing depends on how long a template stays available.

Advice, not a rule: fetch a template once and keep it by its `sha256`, so the template's host is not told every time a document is read.
