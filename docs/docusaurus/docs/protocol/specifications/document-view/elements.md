---
title: Elements
sidebar_label: Elements
slug: /protocol/specifications/document-view/elements
---

# Elements

:::note Reference
`@btps/view` makes and draws views for you, from the HTML preview you
already have ([Overview](./overview.md#you-do-not-build-any-of-this)). This
page is the specification, for building your own builder or renderer.
:::

A canvas's `elements` are drawn in the order listed: each one over those
before it. Every element has a `type`; the others are below.

| Type | What it draws |
| --- | --- |
| [`rect`](#rect) | A rectangle, with rounded corners if wanted |
| [`line`](#line) | A straight line |
| [`path`](#path) | Any shape, as an outline |
| [`image`](#image) | One of the canvas's images |
| [`text`](#text) | A fact: a [binding](./bindings.md) to a signed field, drawn from that field |
| [`label`](#label) | The sender's own words |
| [`signature`](#signature) | The sender's visual signature, from the document's `signatory` |

## rect

```json
{ "type": "rect", "x": 438, "y": 334, "width": 150, "height": 74, "radius": 10, "fill": "#f2f6ff" }
```

| Field | What it says |
| --- | --- |
| `x`, `y`, `width`, `height` | Its box. `width` and `height` are at least 0. |
| `radius` | Optional. The corners' radius, or four, `[topLeft, topRight, bottomRight, bottomLeft]`. |
| `fill` | Optional. A [paint](./canvas.md#colours-and-paints). |
| `stroke`, `strokeWidth` | Optional, together. Its outline: a paint and a width from 0 to 100. |
| `opacity` | Optional. 0 to 1; 1 when absent. |

## line

```json
{ "type": "line", "from": [60, 410.5], "to": [588, 410.5], "stroke": "#e6eaf0", "strokeWidth": 1 }
```

| Field | What it says |
| --- | --- |
| `from`, `to` | Its ends, `[x, y]`. |
| `stroke`, `strokeWidth` | A paint and a width from 0 to 100. |
| `dash` | Optional. `[on, off]` lengths, each from 0 to 1,000. |
| `opacity` | Optional. 0 to 1. |

## path

Any outline: a logo drawn as shapes, an icon, a wave, an ornament.

```json
{ "type": "path", "d": "M0 1083C200 1063 400 1093 600 1068L600 1123L0 1123Z", "fill": { "linear": { "from": [0, 1060], "to": [0, 1123], "stops": [[0, "#f2f6ff"], [1, "#ffffff"]] } } }
```

| Field | What it says |
| --- | --- |
| `d` | The outline (below). |
| `fill`, `stroke`, `strokeWidth`, `opacity` | As for `rect`. |
| `fillRule` | Optional. `nonzero` (when absent) or `evenodd`. |

`d` is a list of commands, each a capital letter followed by its numbers,
separated by spaces or commas. Positions are absolute page positions.

| Command | Numbers | Draws |
| --- | --- | --- |
| `M` | x y | Moves to a point, starting a new outline |
| `L` | x y | A straight line to a point |
| `H` | x | A horizontal line |
| `V` | y | A vertical line |
| `Q` | x1 y1 x y | A quadratic curve |
| `C` | x1 y1 x2 y2 x y | A cubic curve |
| `Z` | | Closes the outline |

Numbers have an optional `-`, digits, and at most two decimal places. No
other command, no relative (lower-case) command, and no arc is allowed: a
renderer reads exactly this and nothing else.

## image

```json
{ "type": "image", "image": "logo", "x": 36, "y": 36, "width": 160, "height": 60 }
```

| Field | What it says |
| --- | --- |
| `image` | A key of the canvas's [`images`](./images.md). |
| `x`, `y`, `width`, `height` | Where it is drawn. The image is scaled to fill the box. |
| `opacity` | Optional. 0 to 1. |

## text

A fact: the value of a signed field, drawn from that field. The canvas holds
where and how it is drawn, never its text.

```json
{
  "type": "text",
  "bind": { "field": "dueAt", "format": { "date": "d MMM yyyy" } },
  "x": 271, "y": 404.3, "width": 79.5, "align": "start",
  "font": "body-bold", "size": 12, "colour": "#0f1b2d"
}
```

| Field | What it says |
| --- | --- |
| `bind` | Which field, which part of it, and how it is formatted: see [Bindings and formats](./bindings.md). |
| `x` | The left edge of its box. |
| `y` | Its baseline: the line the letters sit on. |
| `width` | Its box's width. The drawn value fits inside it ([Checks](./checks.md#shown-in-full)). |
| `align` | `start`, `centre` or `end`: where in the box the value is placed. |
| `font` | A key of the canvas's [`fonts`](./fonts.md). |
| `size` | The font size in pixels, 6 to 400. |
| `colour` | A colour, never a gradient, at full opacity (`#rrggbb`). |
| `letterSpacing` | Optional. Extra space after each character, in pixels, from -10 to 50. |
| `transform` | Optional. `uppercase` or `lowercase`. |

One `text` element is one line. A value shown over several lines, such as an
address or a note, is several `text` elements, each bound to a range of the
same field.

## label

The sender's own words: a heading, a caption, a column name, a greeting.

```json
{ "type": "label", "text": "Amount due", "x": 450, "y": 349, "width": 72, "align": "start", "font": "body-semibold", "size": 10, "colour": "#1e4fc2", "letterSpacing": 0.6, "transform": "uppercase" }
```

Its fields are those of `text`, with `text` in place of `bind`: plain text of
1 to 500 characters, with no control, hidden or direction-changing character.

A label is the sender's words, as a note is. BTPS carries it as signed and
makes no claim about what it says ([Security model](./security.md)).

## signature

The sender's sign-off on a letter or an agreement, from the document's
`signatory.visualSignature`.

```json
{ "type": "signature", "x": 60, "y": 610, "width": 220, "height": 66, "colour": "#0f1b2d" }
```

| Field | What it says |
| --- | --- |
| `x`, `y`, `width`, `height` | Its box. A drawn signature's 1,000 by 300 canvas is scaled to fit it; a typed one is set in the script font Caveat to fit it. |
| `colour` | Its ink colour. |

The signatory's `name` and `title` are `text` elements bound to
`signatory.name` and `signatory.title`.

## Limits

| What | Limit |
| --- | --- |
| A path's `d` | 20,000 characters |
| All paths' `d` together | 100,000 characters |
| A label's `text` | 500 characters |
| A gradient's stops | 8 |
| `size` | 6 to 400 |
| `strokeWidth` | 0 to 100 |
