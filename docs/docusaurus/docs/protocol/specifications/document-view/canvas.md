---
title: Canvas
sidebar_label: Canvas
slug: /protocol/specifications/document-view/canvas
---

# Canvas

:::note Reference
`@btps/view` makes and draws views for you, from the HTML preview you
already have ([Overview](./overview.md#you-do-not-build-any-of-this)). This
page is the specification, for building your own builder or renderer.
:::

A document's view is the canvas in its `template.layout`. Since 1.2, under
`1.2.0`, `template` on an invoice, a receipt, a payslip, a letter or an
agreement is exactly `{ "layout": { … } }`.

```json
{
  "template": {
    "layout": {
      "format": 1,
      "page": { "width": 600, "height": 900, "background": "#ffffff" },
      "fonts": {
        "body": { "unitsPerEm": 1000, "ascent": 940, "descent": 240, "glyphs": { "A": { "advance": 640, "path": "M12 0L292 712L348 712L628 0Z" } } }
      },
      "images": {
        "logo": { "width": 320, "height": 120, "encoding": "rgba8-deflate", "data": "eJzt…" }
      },
      "elements": [
        { "type": "rect", "x": 0, "y": 0, "width": 600, "height": 900, "fill": "#ffffff" },
        { "type": "image", "image": "logo", "x": 36, "y": 36, "width": 160, "height": 60 },
        { "type": "text", "bind": { "field": "totalAmount", "format": { "money": { "group": ",", "decimal": ".", "prefix": "A$" } } },
          "x": 450, "y": 380, "width": 120, "align": "end", "font": "body", "size": 18, "colour": "#0f1b2d" }
      ]
    }
  }
}
```

## Fields

| Field | What it holds |
| --- | --- |
| `format` | `1`. A later format is a new number, never a new key an older receiver would ignore. |
| `page` | The canvas's size and background (below). |
| `fonts` | The fonts its text uses, by a key the canvas chooses, each as [glyph outlines](./fonts.md). Optional when it has no text. |
| `images` | Its images, by a key the canvas chooses, each as [pixels](./images.md). Optional. |
| `elements` | What is drawn, in order: each one is drawn over those before it. See [Elements](./elements.md). |

Every key a canvas, a font, an image or an element may hold is named in the
schema. Any other key is refused.

## Page

```json
{ "width": 600, "height": 900, "background": "#ffffff", "breaks": [900] }
```

| Field | What it says |
| --- | --- |
| `width`, `height` | The canvas's size in pixels: CSS pixels, 96 to the inch, at 1×. |
| `background` | The colour behind everything. Optional; white when absent. |
| `breaks` | Optional. Where a printed copy starts a new page, as `y` positions in increasing order. A view is one canvas on a screen; `breaks` only matter when it is printed. |

A long document is one tall canvas. A receiver shows a canvas wider than its
screen scaled down to fit, and lets the reader zoom.

## Coordinates

- The origin is the top-left corner of the page; `x` grows to the right and
  `y` grows down.
- Positions and sizes are numbers in pixels, with at most two decimal places.
- A shape may extend past the page; what lies outside it is not drawn. A
  bound text, a label, an image and a signature lie wholly inside it
  ([Checks](./checks.md)).

## Colours and paints

A colour is `#rrggbb`, or `#rrggbbaa` with opacity, in lower case.

Where an element takes a **paint** (`fill`, `stroke`), it is a colour or a
gradient:

```json
{ "linear": { "from": [0, 0], "to": [600, 0], "stops": [[0, "#1e4fc2"], [1, "#7c3aed"]] } }
{ "radial": { "centre": [80, 30], "radius": 140, "stops": [[0, "#ffffff73"], [1, "#ffffff00"]] } }
```

`stops` are `[offset, colour]` pairs, offsets from 0 to 1 in increasing
order, two to eight of them. `from`, `to` and `centre` are page positions.

## What a canvas never holds

- **A fact as text.** An amount, a date, a name, a number or an address the
  document carries appears only as a [binding](./bindings.md). The canvas
  holds where and how it is drawn, never its text.
- **An address to fetch.** No URL, font file, image file, style sheet or
  script. A receiver needs nothing but the document to draw it.
- **Markup.** A canvas is data the receiver draws itself. Nothing in it is
  read as HTML, SVG, CSS or a font or image format.

## Limits

| What | Limit |
| --- | --- |
| A canvas, as JSON | 384 KiB |
| `page.width` | 1 to 2,000 |
| `page.height` | 1 to 20,000 |
| `page.breaks` | 100 |
| Fonts | 4 |
| Images | 8 |
| Elements | 2,000 |
| Text, label and signature elements together | 1,000 |
| A position or size | -20,000 to 20,000 |

The limits for fonts, images, paths and text are on their own pages, and all
of them on [Limits](../limits.md).
