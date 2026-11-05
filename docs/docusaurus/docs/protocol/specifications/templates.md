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

A template is a JSON file that changes only **style, order and layout**. It refers to the document's own sections by name, to place them and style them, and it carries no text, number or value of its own: no wording, no labels, nothing a reader could mistake for the document's content. The receiver's provider writes every label. Its format is the JSON Schema [`btps-template.schema.json`](pathname:///schemas/btps-template.schema.json), published with these docs, and the [golden vectors](./golden-vectors.md) (`templates.vectors.json`) show what it accepts and refuses.

```json
{
  "format": "btps-template/1",
  "name": "acme/classic-invoice",
  "version": "1.2.0",
  "documentTypes": ["invoice", "receipt"],
  "layout": {
    "sections": [
      "header",
      "issuer",
      "details",
      "lineItems",
      "discount",
      "totals",
      "payment",
      "footer"
    ]
  },
  "colours": {
    "text": "#172b4d",
    "background": "#ffffff",
    "primary": "#0747a6",
    "accent": "#36b37e"
  },
  "fonts": { "body": "sans-serif", "heading": "serif", "numbers": "monospace" },
  "styles": {
    "header": { "colour": "primary", "font": "heading", "size": "large", "weight": "bold" },
    "totals": { "font": "numbers", "weight": "bold", "align": "end", "border": "thin" },
    "footer": { "colour": "muted", "size": "small", "spacing": "roomy" }
  },
  "logo": { "position": "left", "size": "medium" }
}
```

| Field           | What it says                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `format`        | `btps-template/1`                                                                                                         |
| `name`          | `owner/template`, lowercase letters, digits and `-`                                                                       |
| `version`       | A semantic version: the one the document's `template.data.version` names                                                  |
| `documentTypes` | The document types it is for: `invoice`, `receipt`, `payslip`, `letter`                                                   |
| `layout`        | `sections`: the order the document's own sections are placed in, each once, from the list below                           |
| `colours`       | The palette: `text`, `background`, `primary`, `accent`, `muted`, each `#rrggbb`                                           |
| `fonts`         | `body`, `heading`, `numbers`, each from a fixed list: `sans-serif`, `serif`, `monospace`, `system-ui`                     |
| `styles`        | How a section looks, by the section's name (below)                                                                        |
| `logo`          | Where the sender's own logo goes and how big: `position` (`left`, `centre`, `right`), `size` (`small`, `medium`, `large`) |

A section's style is made of tokens only, each from a fixed list:

| Style        | Tokens                                               |
| ------------ | ---------------------------------------------------- |
| `colour`     | `text`, `primary`, `accent`, `muted` (the palette's) |
| `background` | `background`, `primary`, `accent`, `muted`           |
| `font`       | `body`, `heading`, `numbers` (the template's fonts)  |
| `size`       | `small`, `normal`, `large`                           |
| `weight`     | `normal`, `bold`                                     |
| `align`      | `start`, `centre`, `end`                             |
| `spacing`    | `compact`, `normal`, `roomy`                         |
| `border`     | `none`, `thin`, `thick`                              |

Sections: `header`, `issuer`, `details`, `lineItems`, `totals`, `discount`, `payment`, `description`, `body`, `earnings`, `deductions`, `contributions`, `leave`, `attachments`, `references`, `footer`.

Every key a template may hold is named in the schema, every value is a colour or a token from a fixed list, and anything else is refused.

### What a template never does

- **Carry or change a value or any content.** It holds no amount, payee, payment link, text, number or label of its own, and it changes none of the document's: every value and every word shown comes from the signed document or from the receiver's provider.
- **Hide a field.** It cannot hide, omit or truncate a field, or reorder what is inside a value. Every signed field is shown: a section the document has content for but the template does not place is shown after the placed ones, in a default position. A section the document has no content for is not shown.
- **Fetch anything.** It names no address: fonts are from the fixed list, and the logo is the sender's own, named by the document (`template.data.logo`) and checked by its fingerprint. The template says only where the logo goes and how big.
- **Run anything.** It holds no script, style sheet or markup.

## The receiving side

When and how a template is fetched is each provider's own: it fetches when it can read the document, on arrival for a readable one, or when its user first views it for one only the user can open. What the protocol fixes is safety:

- **Draw only what matches.** A provider draws a template only from bytes whose SHA-256 is `sha256` and that are a valid template for the document's type.
- **The logo too.** It draws the logo only if its bytes match `logo.sha256` and are a PNG, JPEG or WebP image.
- **Fall back.** On any failure (no answer, a mismatch, an invalid file, a document type the template is not for) it shows the standard view. The signed document is always shown in full, so nothing depends on how long a template stays available.

Advice, not a rule: fetch a template once and keep it by its `sha256`, so the template's host is not told every time a document is read.
