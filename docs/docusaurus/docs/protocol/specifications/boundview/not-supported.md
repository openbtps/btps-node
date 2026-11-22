---
title: What BoundView does not support
sidebar_label: What it does not support
slug: /protocol/specifications/boundview/not-supported
description: For platforms building a preview to capture. The HTML and CSS a BoundView does not carry, what it draws only approximately, and what a design does that makes the snapshot throw.
---

# What BoundView does not support

For platforms whose preview HTML `snapshotBoundView` captures.
`snapshotBoundView` translates the page as the browser laid it out into the
BoundView format, and every receiver draws that format with the same engine.
The engine is not a browser. Some HTML and CSS cannot be carried at all, and
some only approximately. This page lists only those.

The snapshot has been tested in headless Chrome only. Firefox and Safari have
not been tested.

For what a design must do to be shown, see
[A preview that passes](./using.md#a-preview-that-passes). For what a
receiver refuses, see the [checks](./checks.md).

## Not carried

Ignored or dropped, silently: the snapshot does not warn.

| What                                                                                                                        | What happens, and why                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `filter`, `mix-blend-mode`, `clip-path` on anything but an `<img>` or `<svg>`                                               | Ignored: the box, its background and its text are drawn unfiltered and unclipped. Only an image is drawn through the browser's canvas, which applies them.                                                         |
| `backdrop-filter`                                                                                                           | Ignored. The format has no such effect.                                                                                                                                                                            |
| `mask`, `mask-image`                                                                                                        | Ignored on boxes and images. The format has no mask.                                                                                                                                                               |
| `border-image`                                                                                                              | Ignored: the plain border is drawn instead.                                                                                                                                                                        |
| `z-index`, stacking contexts                                                                                                | Ignored. The paint order is fixed: shapes not inside a positioned element, then text not inside one, then each outermost positioned element in document order, its shapes before its text.                         |
| `overflow: hidden`, `clip`, `scroll` or `auto` inside the preview                                                           | Ignored: children are drawn unclipped, and scrolled-away content is drawn. `text-overflow: ellipsis` is lost the same way: the cut characters are drawn, not the "…". Overflow is read only on the preview itself. |
| `conic-gradient`, `repeating-radial-gradient`, `repeating-conic-gradient`                                                   | The layer is dropped. Only `linear-gradient`, `radial-gradient`, `repeating-linear-gradient` and `url()` are read.                                                                                                 |
| A gradient with a colour hint, such as `red, 30%, blue`                                                                     | The whole layer is dropped.                                                                                                                                                                                        |
| `background-size`, `background-position`, `background-repeat` on a gradient                                                 | Ignored: a gradient always fills the whole border box. They apply to `url()` images only.                                                                                                                          |
| `color: transparent` text, as with `background-clip: text`                                                                  | Drawn black. Text in the format has a solid colour.                                                                                                                                                                |
| `direction: rtl`, bidirectional text                                                                                        | Not handled: glyphs are drawn left to right in string order.                                                                                                                                                       |
| `writing-mode` vertical, `text-orientation`                                                                                 | Not handled.                                                                                                                                                                                                       |
| `text-transform: capitalize`                                                                                                | Ignored: text is drawn as written in the page. Only `uppercase` and `lowercase` are read.                                                                                                                          |
| `hyphens: auto`                                                                                                             | The hyphen the browser inserts is not drawn. Only the page's own text is read.                                                                                                                                     |
| `::first-line`                                                                                                              | Its style is not applied.                                                                                                                                                                                          |
| `::before`, `::after` whose `content` is `counter()`, `url()` or quotes                                                     | The pseudo-element is dropped, its box too. Only quoted strings and `attr()` are read.                                                                                                                             |
| `<canvas>`, `<video>`, `<iframe>`                                                                                           | Their content is dropped. Only their box's decoration is drawn.                                                                                                                                                    |
| Fonts after the first in `font-family`                                                                                      | Ignored: only the first family is looked up.                                                                                                                                                                       |
| A font from a cross-origin stylesheet without CORS, such as a plain Google Fonts `<link>`, or added with the `FontFace` API | Drawn with a bundled fallback, with a warning. The snapshot reads only `@font-face` rules it is allowed to read.                                                                                                   |
| Animations and transitions                                                                                                  | A still of the moment `snapshotBoundView` is called.                                                                                                                                                               |

## Carried approximately

Drawn, but not as the browser draws it.

| What                                                                                          | How it is drawn, and why                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `box-shadow` with a blur                                                                      | Several faint copies stacked to fake the blur. The format has no blur.                                                                                                                                                                                    |
| `text-shadow`                                                                                 | The blur is dropped: a hard, offset copy of the glyphs.                                                                                                                                                                                                   |
| `radial-gradient` as an ellipse                                                               | Concentric bands. The format's radial paint is circular.                                                                                                                                                                                                  |
| A gradient with more than 8 stops                                                             | Cut to 8. The format carries at most 8.                                                                                                                                                                                                                   |
| `dotted` and `dashed` borders, and sides of different colours or styles, with rounded corners | The corner curves are not drawn. Dots are square.                                                                                                                                                                                                         |
| `groove`, `ridge`, `inset`, `outset` borders                                                  | Solid, one colour.                                                                                                                                                                                                                                        |
| Text shaping                                                                                  | None. Text is drawn glyph by glyph, one glyph per character plus pair kerning, so ligatures, complex scripts (such as Arabic joining or Indic reordering), `text-align: justify` and `word-spacing` are not drawn as the browser draws them.              |
| `font-variant: small-caps`                                                                    | Capitals at 70% of the size, not the font's own small capitals.                                                                                                                                                                                           |
| Translucent text (`opacity`, an `rgba` colour)                                                | Its colour is mixed with the nearest solid background behind it. Gradients, images and other elements behind it are not taken into account.                                                                                                               |
| Images                                                                                        | Downscaled to at most 1,024 pixels a side and 262,144 pixels in all.                                                                                                                                                                                      |
| An `<img>` or `<svg>` with `filter`, `mix-blend-mode` or `clip-path`                          | Drawn to pixels by the browser's canvas. A blend is with the nearest solid background only.                                                                                                                                                               |
| 3D transforms (`perspective`, `rotateX`, `rotateY`, `matrix3d`)                               | Flattened to their 2D part. Perspective is lost.                                                                                                                                                                                                          |
| A font the snapshot cannot read, or a system font                                             | Drawn with a bundled font at its 400 regular weight, so bold and italic are lost. The widths match only for Arial, Times, Courier, Calibri and Cambria. Any other family, such as `system-ui`, Helvetica, Inter or Roboto, gets Arimo, at its own widths. |

## What makes the snapshot throw

Some designs make `snapshotBoundView` throw a `BoundViewSnapshotError`
whose `problems` say why. These are the ones caused by the design itself.

### The snapshot's own refusals

Thrown as "The preview cannot be sent as a BoundView", with these problems:

| Cause                                                                                                                                               | Message                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A fact or the signature is rotated, skewed, flipped or unevenly scaled by a CSS `transform`, `rotate` or `scale`, on it or on any element around it | `<field> is turned or slanted by a CSS transform; a BoundView draws it upright`, or `the signature is turned …` |
| A CSS background image from another site that does not allow it (CORS), or that fails to load                                                       | `a background image (<src>) could not be read: it must be served from this site, or allow it (CORS)`            |
| An `<img>` or inline SVG whose pixels cannot be read, such as one from another site without CORS                                                    | `an image (<src or inline>) could not be read: it must be served from this site, or allow it (CORS)`            |
| A character in a fact that neither the page's font nor the bundled fallback has a glyph for, such as an emoji                                       | `no font has a glyph for "<c>", which <family> shows`                                                           |
| More than 8 fonts, one for each family, weight, style and tabular figures                                                                           | `the preview uses <n> fonts; a BoundView carries at most 8`                                                     |

### Format limits the snapshot does not avoid

Thrown as "The preview made a BoundView a receiver would refuse". The
snapshot keeps under some [limits](../limits.md#boundview) itself: it
downscales images, cuts gradient stops and clamps letter spacing. It does not
keep under these:

| Limit                 | Value                               | A design that reaches it                                                                 |
| --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Images                | 8                                   | More than 8 of: `<img>` elements, `url()` background layers, and SVGs drawn as pixels    |
| Image data            | 256 KiB of base64 an image          | A photo: images travel as lossless pixels                                                |
| Text size             | 6 to 400 px                         | Any text smaller than 6 px, small capitals included, or larger than 400 px               |
| Path characters       | 20,000 a path, 100,000 in all       | A complex SVG logo path, or many shadows, dashed borders, stripes and transformed labels |
| Elements              | 2,000, of which 1,000 text elements | A long document, or many shadow layers                                                   |
| Page width            | 2,000 px                            | A preview wider than 2,000 CSS pixels, or overflowing past that                          |
| Glyphs                | 256 a font                          | More than 256 different characters in one font                                           |
| Kerning pairs         | 4,096 a font                        | A font with many kerning pairs among the characters used                                 |
| Label                 | 500 characters                      | One line of one text node longer than 500 characters                                     |
| The BoundView as JSON | 384 KiB                             | Images and paths together                                                                |

### Covered by a positioned element

Because `z-index` is ignored ([Not carried](#not-carried)), a positioned
element can end up drawn over a fact, even with `z-index: -1`. The receiver's
[Not hidden](./checks.md#not-hidden) check then refuses it, and the snapshot
throws as "A receiver would not show this BoundView".

### A signature's colour

`signatureSvg` and `signatureShapes` from `@btps/boundview/signature` take
only a hex colour or `currentColor`. Any other colour, such as `rgb(…)` or a
colour name, throws a `TypeError`.
