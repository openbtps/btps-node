---
title: Images
sidebar_label: Images
slug: /protocol/specifications/document-view/images
---

# Images

:::note Reference
`@btps/view` makes and draws views for you, from the HTML preview you
already have ([Overview](./overview.md#you-do-not-build-any-of-this)). This
page is the specification, for building your own builder or renderer.
:::

A view's images, a logo or anything else the sender's preview showed, travel
as their **pixels**: every pixel, full colour with transparency, compressed
without loss. A canvas never carries an image file, and a receiver never
decodes one from a sender.

Image decoders have been a route for attacks, through crafted PNG, JPEG,
WebP and SVG files. Pixels are numbers a receiver checks against their
stated size. So the view gets the sender's exact image, and a receiver reads
nothing it cannot check completely.

## An image

```json
{ "logo": { "width": 320, "height": 120, "encoding": "rgba8-deflate", "data": "eJztwTEBAAAAwqD1T20…" } }
```

| Field | What it says |
| --- | --- |
| `width`, `height` | Its size in pixels. |
| `encoding` | `rgba8-deflate`: the pixels row by row from the top-left, four bytes each (red, green, blue, alpha, 0 to 255, alpha not premultiplied), compressed with zlib's deflate (RFC 1950). |
| `data` | The compressed bytes, in base64. |

A receiver inflates `data` and refuses an image whose inflated length is not
exactly `width × height × 4`, stopping as soon as it passes that length.

An [`image` element](./elements.md#image) draws it, scaled to fill its box.
An image is drawn at twice its box's size or more, so it stays sharp on
high-resolution screens.

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
