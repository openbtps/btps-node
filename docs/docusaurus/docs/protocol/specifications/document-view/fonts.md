---
title: Fonts and Glyphs
sidebar_label: Fonts and glyphs
slug: /protocol/specifications/document-view/fonts
---

# Fonts and glyphs

A view's text is drawn from **glyph outlines**: the shape of each character
the document needs, as data. A canvas never carries a font file, and a
receiver never reads one from a sender.

A font file is a complex format, and the code that reads fonts has been a
route for attacks. An outline is a list of points a receiver checks like
the rest of the canvas. So the view gets the sender's exact letters, and a
receiver reads nothing it cannot check completely.

## A font

```json
{
  "body": {
    "unitsPerEm": 1000,
    "ascent": 940,
    "descent": 240,
    "glyphs": {
      "A": { "advance": 640, "path": "M12 0L292 -712L348 -712L628 0L548 0L478 -190L162 -190L92 0Z M186 -256L454 -256L320 -620Z" },
      " ": { "advance": 250 }
    },
    "kerning": { "AV": -48, "Te": -60 },
    "fallback": ["arimo", "sans-serif"]
  }
}
```

| Field | What it says |
| --- | --- |
| `unitsPerEm` | The font's own unit: an outline is drawn at `size / unitsPerEm` pixels per unit. 16 to 16,384. |
| `ascent`, `descent` | How far the font reaches above and below the baseline, in its units. A text's box is its baseline minus `ascent` to its baseline plus `descent`. |
| `glyphs` | One entry per character, keyed by the character itself. |
| `glyphs.<char>.advance` | How far the next character starts after this one, in the font's units. |
| `glyphs.<char>.path` | Optional (a space has none). The character's outline, in the font's units, with the baseline at 0 and `y` growing down. The same commands as a [path](./elements.md#path). |
| `kerning` | Optional. Adjustments for pairs of characters, keyed by the two characters, in the font's units. |
| `fallback` | Optional. What to draw a character with when the font has no glyph for it (below). |

A glyph is the character as the sender's text showed it. Where the sender's
text used a font's alternative forms, such as tabular figures, the glyph is
that form.

## Which characters

A font carries the characters its labels show, the characters of every value
bound to it, and the digits `0` to `9` with `.`, `,`, `-` and the characters
of its money prefixes and suffixes. A receiver can then draw any value the
document's bindings name with the same glyphs.

## Fallbacks

When a font has no glyph for a character, the receiver draws it with the
first name in the font's `fallback` it holds:

| Name | What it is |
| --- | --- |
| `arimo` | An open font with Arial's and Helvetica's widths |
| `tinos` | An open font with Times New Roman's widths |
| `cousine` | An open font with Courier New's widths |
| `carlito` | An open font with Calibri's widths |
| `caladea` | An open font with Cambria's widths |
| `sans-serif`, `serif`, `monospace` | A receiver's own font of that kind |

The first five are bundled with the BTPS renderer, so they look the same on
every receiver; the last three are a receiver's own. A font that is only
`fallback`, with no `glyphs`, is how a sender says "draw this text with
Arial's widths" when it could not capture the font it used.

## Limits

| What | Limit |
| --- | --- |
| Fonts | 4 |
| Glyphs a font | 256 |
| A glyph's `path` | 4,000 characters |
| Kerning pairs a font | 4,096 |
| A `fallback` | 4 names |
