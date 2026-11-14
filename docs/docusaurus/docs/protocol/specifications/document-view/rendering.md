---
title: Rendering
sidebar_label: Rendering
slug: /protocol/specifications/document-view/rendering
---

# Rendering

:::note Reference
`@btps/view` makes and draws views for you, from the HTML preview you
already have ([Overview](./overview.md#you-do-not-build-any-of-this)). This
page is the specification, for building your own builder or renderer.
:::

How a canvas is drawn, so every receiver draws it the same way. The
`@btps/view` package's `renderLayout` draws by these rules with one engine,
compiled to WebAssembly, and gives a finished picture; a receiver's app only
displays it. A receiver that draws a canvas some other way must draw it as
these rules say.

## Order and the page

1. The page is filled with `page.background`, white when absent.
2. Each element is drawn in the order of `elements`, over those before it.
3. Nothing outside the page is drawn.

## Shapes

- A `rect` is drawn as its box, with its corners rounded by `radius`
  (clamped to half the shorter side), filled, then stroked centred on its
  edge.
- A `line` is stroked from `from` to `to` with butt ends.
- A `path` is filled by its `fillRule`, then stroked.
- `opacity` multiplies the element's paint's own alpha.
- A gradient interpolates between its stops in sRGB; outside the first and
  last stop it keeps their colours.

## Images

An `image` element draws its image scaled to its box, with bilinear
filtering. The image's pixels are drawn as stored: no colour profile is
applied.

## Text

A `text` element's string is its bound value written in its
[format](./bindings.md#formats), or the part `range` names. A `label`'s
string is its `text`. Then:

1. `transform`, when present, makes the string upper or lower case, character
   by character, as Unicode's simple case mapping does with no locale.
2. Each character is drawn with its font's glyph, or its
   [fallback](./fonts.md#fallbacks).
3. Characters are placed along the baseline at `y`. After each character the
   pen moves by its `advance`, plus the kerning for it and the next
   character, scaled by `size / unitsPerEm`, plus `letterSpacing` (after
   the last character too, as browsers do).
4. The string's width is where the pen ends. `align` places it in the box:
   `start` at `x`, `end` so it ends at `x + width`, `centre` midway.
5. If it is wider than `width`, `size` is reduced until it fits, no lower than
   [the check allows](./checks.md#shown-in-full).
6. Glyphs are filled with `colour`, by the non-zero rule.

## Signatures

A drawn signature's strokes, on their 1,000 by 300 canvas, are scaled to fit
the `signature` element's box, keeping their proportions, centred, and
stroked with round ends and joins in `colour`. A typed signature is set in
Caveat, bundled with the renderer, sized to fit the box.

## What may differ

A receiver's screen shows the finished picture with its own colour and
edge rendering, as it shows any image. Positions, shapes, letters and pixels
are the canvas's.

## The engine

`renderLayout` draws with resvg and its rasterizer, tiny-skia, compiled to
WebAssembly: the same code in a browser, on a server and in an app. The SDK's
[golden vectors](../golden-vectors.md) include canvases with the pictures
they must give.
