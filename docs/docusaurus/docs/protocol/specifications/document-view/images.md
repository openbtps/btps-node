---
title: Images
sidebar_label: Images
slug: /protocol/specifications/document-view/images
description: A view's images travel as lossless pixels, never as an image file, and are checked against their stated size.
---

# Images

:::info Reference for implementers
Part of the document view specification, for building your own builder or
renderer, or checking one. A platform that uses `@btps/view` does not need
it: see [Using the document view](./using.md).
:::

A view's images, a logo or anything else the sender's preview showed, travel
as their **pixels**: every pixel, full colour with transparency, compressed
without loss. A canvas never carries an image file, and a receiver never
decodes one from a sender.

:::note Why pixels, not image files
Image decoders have been a route for attacks, through crafted PNG, JPEG,
WebP and SVG files. Pixels are numbers a receiver checks against their
stated size. So the view gets the sender's exact image, and a receiver reads
nothing it cannot check completely.
:::

## An image

A canvas's `images` holds up to eight images, each by a key the canvas
chooses. An [`image` element](./elements.md#image) names its image by that
key.

```json
{ "logo": { "width": 320, "height": 120, "encoding": "rgba8-deflate", "data": "eJztwTEBAAAAwqD1T20…" } }
```

| Field | Type | Required | What it says |
| --- | --- | --- | --- |
| `width`, `height` | number | Yes | Its size in pixels. |
| `encoding` | `rgba8-deflate` | Yes | The pixels row by row from the top-left, four bytes each (red, green, blue, alpha, 0 to 255, alpha not premultiplied), compressed with zlib's deflate (RFC 1950). |
| `data` | string | Yes | The compressed bytes, in base64. |

:::warning Check the length while inflating
A receiver inflates `data` and refuses an image whose inflated length is not
exactly `width × height × 4`, stopping as soon as it passes that length.
:::

An [`image` element](./elements.md#image) draws it, scaled to fill its box.
`snapshotLayout` captures an image at twice its box's size where the source
allows, so it stays sharp on high-resolution screens. That is capture
guidance, not a rule: a receiver does not check an image's resolution, and
scales the image to its box. How it is drawn is on
[Rendering](./rendering.md#images).

## A logo drawn as shapes

A logo that is drawn as outlines in the sender's preview (an SVG logo) may
travel as [`path`](./elements.md#path) elements instead of pixels: sharper at
any size, and usually smaller. Only the outline commands of a path and its
paints are carried; none of SVG's other features.

## Limits

| What | Limit |
| --- | --- |
| Images | 8 |
| `width`, `height` | 1 to 1,024 |
| Pixels an image | 262,144 (`width × height`) |
| `data` | 256 KiB of base64 |

All of them are on [Limits](../limits.md#document-view).
