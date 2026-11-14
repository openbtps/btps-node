---
title: Document View Examples
sidebar_label: Examples
slug: /protocol/specifications/document-view/examples
---

# Examples

Glyph outlines and pixel data are shortened with `…`; every other value is as
a sender would send it.

## An invoice

The document's own fields, then its view. The view shows the sender's logo,
its name, ABN, address, the invoice number, the bill-to name, both dates, the
amount due in a tinted box, the lines, the totals and the note.

```json
{
  "type": "invoice",
  "title": "Website care, October",
  "id": "INV-0042",
  "issuedAt": "2026-11-11T00:00:00.000Z",
  "dueAt": "2026-11-25T00:00:00.000Z",
  "totalAmount": { "amount": 145200, "currency": "AUD" },
  "subtotalAmount": { "amount": 132000, "currency": "AUD" },
  "taxAmount": { "amount": 13200, "currency": "AUD" },
  "lineItems": {
    "columns": ["Description", "Qty", "Unit price", "Amount"],
    "roles": { "Description": "description", "Qty": "quantity", "Unit price": "unitPrice", "Amount": "lineTotal" },
    "rows": [
      { "Description": "Website care, October", "Qty": "1", "Unit price": 90000, "Amount": 90000 },
      { "Description": "Hosting, three months", "Qty": "3", "Unit price": 4000, "Amount": 12000 }
    ]
  },
  "issuer": {
    "name": "Apexworld",
    "address": "79 Barlow Boulevard, Gables NSW 2765",
    "identifiers": { "au:abn": "51824753556" }
  },
  "recipient": { "name": "Northwind Studio" },
  "description": { "format": "text", "content": "Thanks for your business." },
  "template": {
    "layout": {
      "format": 1,
      "page": { "width": 600, "height": 640 },
      "fonts": {
        "geist-400": { "unitsPerEm": 1000, "ascent": 940, "descent": 240, "glyphs": { "A": { "advance": 640, "path": "M12 0L292 -712…Z" }, "…": {} }, "kerning": { "AV": -48 } },
        "geist-700": { "unitsPerEm": 1000, "ascent": 940, "descent": 240, "glyphs": { "…": {} } },
        "geist-mono-400": { "unitsPerEm": 1000, "ascent": 940, "descent": 240, "glyphs": { "…": {} } }
      },
      "images": { "logo": { "width": 320, "height": 120, "encoding": "rgba8-deflate", "data": "eJzt…" } },
      "elements": [
        { "type": "image", "image": "logo", "x": 36, "y": 36, "width": 160, "height": 60 },
        { "type": "text", "bind": { "field": "issuer.name" }, "x": 36, "y": 126, "width": 92, "align": "start", "font": "geist-700", "size": 18, "colour": "#0f1b2d" },
        { "type": "label", "text": "ABN", "x": 36, "y": 150, "width": 22, "align": "start", "font": "geist-400", "size": 11, "colour": "#4e5a6d" },
        { "type": "text", "bind": { "field": "issuer.identifiers.au:abn", "format": { "groups": { "sizes": [2, 3, 3, 3], "separator": " " } } },
          "x": 61, "y": 150, "width": 82, "align": "start", "font": "geist-400", "size": 11, "colour": "#4e5a6d" },
        { "type": "text", "bind": { "field": "issuer.address" }, "x": 36, "y": 166, "width": 199, "align": "start", "font": "geist-400", "size": 11, "colour": "#4e5a6d" },
        { "type": "label", "text": "Tax invoice", "x": 448, "y": 58, "width": 116, "align": "end", "font": "geist-700", "size": 22, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "id" }, "x": 488, "y": 78, "width": 76, "align": "end", "font": "geist-mono-400", "size": 11, "colour": "#4e5a6d" },
        { "type": "line", "from": [36, 196.5], "to": [564, 196.5], "stroke": "#e6eaf0", "strokeWidth": 1 },
        { "type": "label", "text": "Bill to", "x": 36, "y": 222, "width": 40, "align": "start", "font": "geist-700", "size": 10, "colour": "#667185", "letterSpacing": 0.6, "transform": "uppercase" },
        { "type": "text", "bind": { "field": "recipient.name" }, "x": 36, "y": 240, "width": 103, "align": "start", "font": "geist-700", "size": 12, "colour": "#0f1b2d" },
        { "type": "label", "text": "Issued", "x": 247, "y": 222, "width": 40, "align": "start", "font": "geist-700", "size": 10, "colour": "#667185", "letterSpacing": 0.6, "transform": "uppercase" },
        { "type": "text", "bind": { "field": "issuedAt", "format": { "date": "d MMM yyyy" } }, "x": 247, "y": 240, "width": 70, "align": "start", "font": "geist-400", "size": 12, "colour": "#0f1b2d" },
        { "type": "label", "text": "Due", "x": 247, "y": 262, "width": 22, "align": "start", "font": "geist-700", "size": 10, "colour": "#667185", "letterSpacing": 0.6, "transform": "uppercase" },
        { "type": "text", "bind": { "field": "dueAt", "format": { "date": "d MMM yyyy" } }, "x": 247, "y": 280, "width": 80, "align": "start", "font": "geist-700", "size": 12, "colour": "#0f1b2d" },
        { "type": "rect", "x": 414, "y": 208, "width": 150, "height": 74, "radius": 10, "fill": "#f2f6ff" },
        { "type": "label", "text": "Amount due", "x": 426, "y": 228, "width": 72, "align": "start", "font": "geist-700", "size": 10, "colour": "#1e4fc2", "letterSpacing": 0.6, "transform": "uppercase" },
        { "type": "text", "bind": { "field": "totalAmount", "format": { "money": { "group": ",", "decimal": ".", "prefix": "A$" } } },
          "x": 426, "y": 256, "width": 102, "align": "start", "font": "geist-700", "size": 18, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "lineItems.rows.0.Description" }, "x": 36, "y": 352, "width": 130, "align": "start", "font": "geist-400", "size": 12, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "lineItems.rows.0.Amount", "format": { "money": { "group": ",", "decimal": ".", "prefix": "A$" } } },
          "x": 508, "y": 352, "width": 56, "align": "end", "font": "geist-400", "size": 12, "colour": "#0f1b2d" },
        { "type": "label", "text": "…the second line, the totals and the note, the same way" , "x": 36, "y": 600, "width": 300, "align": "start", "font": "geist-400", "size": 11, "colour": "#4e5a6d" }
      ]
    }
  }
}
```

What the receiver checks, among the rest: every key fact (the number, both
dates, the three amounts, the sender's and the recipient's names, the note,
and each line's description and amount) has a bound element; each fits its
box; none is covered; the amount due's colour has 3:1 contrast against the
tinted box beneath it.

## A letter with its signatory

```json
{
  "type": "letter",
  "title": "Office closing",
  "id": "LTR-5B1E09C4-7A2D-4F61-9C3E-1D2A8B7F6E05",
  "issuedAt": "2026-12-01T00:00:00.000Z",
  "body": { "format": "text", "content": "Our office closes on Friday 19 December and opens again on Monday 5 January." },
  "issuer": { "name": "Apexworld" },
  "recipient": { "name": "Northwind Studio" },
  "signatory": {
    "name": "Jo Bloggs",
    "title": "Director",
    "visualSignature": { "type": "drawn", "strokes": [[40, 200, 180, 90, 320, 210, 470, 80]] }
  },
  "template": {
    "layout": {
      "format": 1,
      "page": { "width": 600, "height": 520 },
      "fonts": { "serif-400": { "unitsPerEm": 1000, "ascent": 900, "descent": 220, "glyphs": { "…": {} } } },
      "elements": [
        { "type": "text", "bind": { "field": "issuer.name" }, "x": 48, "y": 60, "width": 120, "align": "start", "font": "serif-400", "size": 20, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "issuedAt", "format": { "date": "d MMMM yyyy" } }, "x": 420, "y": 60, "width": 132, "align": "end", "font": "serif-400", "size": 12, "colour": "#4e5a6d" },
        { "type": "label", "text": "Dear", "x": 48, "y": 120, "width": 30, "align": "start", "font": "serif-400", "size": 13, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "recipient.name" }, "x": 82, "y": 120, "width": 118, "align": "start", "font": "serif-400", "size": 13, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "body.content", "range": [0, 39] }, "x": 48, "y": 160, "width": 504, "align": "start", "font": "serif-400", "size": 13, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "body.content", "range": [40, 76] }, "x": 48, "y": 180, "width": 504, "align": "start", "font": "serif-400", "size": 13, "colour": "#0f1b2d" },
        { "type": "label", "text": "Yours sincerely,", "x": 48, "y": 240, "width": 110, "align": "start", "font": "serif-400", "size": 13, "colour": "#0f1b2d" },
        { "type": "signature", "x": 48, "y": 256, "width": 220, "height": 66, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "signatory.name" }, "x": 48, "y": 344, "width": 70, "align": "start", "font": "serif-400", "size": 13, "colour": "#0f1b2d" },
        { "type": "text", "bind": { "field": "signatory.title" }, "x": 48, "y": 362, "width": 60, "align": "start", "font": "serif-400", "size": 12, "colour": "#4e5a6d" }
      ]
    }
  }
}
```

The body is bound line by line with `range`; together the ranges cover every
word of it. The signature is drawn from `signatory.visualSignature`, never
from pixels in the canvas.
