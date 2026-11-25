---
title: Using BoundView
sidebar_label: Using it
slug: /protocol/specifications/boundview/using
description: For platforms. Send a document with its BoundView and show a received one with @btps/boundview, in a few lines and with no format to learn.
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Using BoundView

For platforms that send documents or show them. `@btps/boundview` does the
work: you keep designing your preview in HTML, and you never write or read a
canvas yourself. The [specification](./overview.md#the-specification) is
for implementers and you do not need it.

A BoundView is optional. If you do not want your design to travel, send
none: the receiver shows its own view of the document's data.

| Step                                                                      | Where it runs                                          | What you call                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| [Install and load the engine](#install)                                   | Once, where you capture or draw                        | `initBoundViewEngine(...)` in a browser or app; automatic in Node |
| [Send a document with its BoundView](#send-a-document-with-its-boundview) | The browser where your preview is shown                | `snapshotBoundView(previewElement, document)`                     |
| Check a received BoundView                                                | The receiving server, or the device that holds the key | Nothing: the SDK checks it whenever the document is opened        |
| [Show a received BoundView](#show-a-received-boundview)                   | Wherever your app displays documents                   | `renderBoundView(openedDocument)`                                 |

## Install

<Tabs groupId="package-manager">
<TabItem value="npm" label="npm">

```bash
npm install @btps/boundview@next
```

</TabItem>
<TabItem value="yarn" label="yarn">

```bash
yarn add @btps/boundview@next
```

</TabItem>
<TabItem value="pnpm" label="pnpm">

```bash
pnpm add @btps/boundview@next
```

</TabItem>
</Tabs>

:::note
BoundView is part of 1.2, which is the `next` release until 1.2.0 ships: without `@next`, a package manager installs `@btps/boundview` 0.0.0, not the 1.2 release. See [Migrating from 1.1 to 1.2](../../../whats-new/version-1-2-migration.md).
:::

`@btps/boundview` depends on `@btps/sdk` (`^1.2.0-rc.3.2`), so installing it
alone brings what it needs, with any package manager. It uses only the SDK's
browser-safe entry, `@btps/sdk/boundview` (schema, bindings and checks), so a
frontend bundle never includes the SDK's server or client code.

`@btps/boundview` draws with one engine, compiled to WebAssembly and shipped in the package as
`@btps/boundview/engine.wasm`. In Node it loads by itself. In a browser or
an app, serve that file with your app and load it once, before the first
snapshot or picture:

```ts
import { initBoundViewEngine } from '@btps/boundview';

// Or whatever URL your bundler gives @btps/boundview/engine.wasm
await initBoundViewEngine(new URL('@btps/boundview/engine.wasm', import.meta.url));
```

## Frontend and backend apps

`@btps/boundview` is kept apart from `@btps/sdk` so the SDK stays small: the
drawing engine is about 2.5 MB of WebAssembly, the bundled glyph outlines are
about 800 KB for Latin and about 3.2 MB more for other scripts and symbols,
and opentype.js is used only when sending. A platform that
never draws or captures a BoundView never downloads them. Received
BoundViews are still checked automatically by `@btps/sdk` alone
(`decryptVerify`'s `boundView` result, the server handler's second argument).

| Platform                                       | Install                           |
| ---------------------------------------------- | --------------------------------- |
| Sends or receives documents, no BoundView      | `@btps/sdk` only                  |
| Sends with a BoundView, or draws received ones | `@btps/sdk` and `@btps/boundview` |

### What an app downloads

`@btps/boundview` is tree-shakable (`sideEffects: false`), so an app's
bundle holds only what it imports. Measured minified, with code splitting,
as Vite and Next.js bundle:

| The app calls            | Loaded up front                                                | Gzipped      |
| ------------------------ | -------------------------------------------------------------- | ------------ |
| `renderBoundView` only   | About 106 KB, with no snapshot code and no font reader         | About 33 KB  |
| `snapshotBoundView` only | About 384 KB, mostly opentype.js, which reads the page's fonts | About 115 KB |
| Both                     | The same as `snapshotBoundView` alone                          | The same     |

Three things are never in that up-front load:

- **The engine's WebAssembly** (about 2.5 MB) is never in a bundle. It is
  fetched from the URL the app passes to `initBoundViewEngine`, and only
  when the engine is used. For a sender, that means only when the preview
  has an SVG logo and `engine` was given.
- **The bundled fonts** (Arimo, Tinos, Cousine, Carlito and Caladea for
  label fallbacks, Caveat for typed signatures, with Arimo for a typed
  signature's characters Caveat lacks) are each two chunks of their own. The
  first holds Latin and Latin-1, with kerning, from about 75 KB to 310 KB
  (20 KB to 100 KB gzipped). The second holds the font's other characters,
  from about 100 KB to 875 KB (25 KB to 270 KB gzipped), and is downloaded
  only when a text needs one of them ([Bundled fonts](./rendering.md#bundled-fonts)).
  A drawing downloads a font only when it uses it: a label character missing
  from its own font, a typed signature, or a page font the snapshot couldn't
  read. Most BoundViews need none.
- **The Brotli decoder** that reads a woff2 font, about 88 KB (59 KB
  gzipped), is in a chunk of its own, and `snapshotBoundView` loads it only
  when it reads a woff2 file.

`snapshotBoundView` needs a browser, because it reads the browser's layout.
`renderBoundView` runs in a browser, an app, or Node. A platform with a
separate frontend app and backend API splits the work like this:

1. **Frontend** shows the preview and calls `snapshotBoundView`. It needs
   `@btps/boundview`.
2. The frontend sends the returned `boundView` JSON with the draft to its own
   API.
3. **Backend** puts it in the document's `boundView` field, then signs and
   sends with `@btps/sdk`. The SDK checks it again before signing.
4. **Receiving:** the checks run where the document is opened (the backend's
   server, or the device that decrypts), with `@btps/sdk`.
5. **Drawing a received one:** either the frontend calls `renderBoundView`
   (the frontend has `@btps/boundview`), or the backend calls
   `renderBoundView` in Node and serves the PNG (then the backend installs
   `@btps/boundview` too).

Keep the frontend's and the backend's BTPS packages on the same 1.2 release,
so the checks a sender's frontend runs and the checks its backend runs before
signing never disagree.

## Send a document with its BoundView

Hand the preview's HTML element and the document it shows to
`snapshotBoundView`, in the browser where the preview is shown. Put what it
returns in the document's `boundView` field, and send the document as usual.

```ts
import { snapshotBoundView, BoundViewSnapshotError } from '@btps/boundview';

try {
  // The preview you already show, and the document it shows
  const boundView = await snapshotBoundView(previewElement, document, {
    engine: new URL('@btps/boundview/engine.wasm', import.meta.url), // optional
    onWarning: (message) => console.warn(message), // optional: by default, console.warn('[BoundView] ' + message)
  });
  // A document with a BoundView is stamped 1.2.0 for you
  await agent.command('artifact.send', to, { ...document, boundView }, { encryption });
} catch (error) {
  if (error instanceof BoundViewSnapshotError) {
    // error.problems: why a receiver would not accept or show it,
    // e.g. "taxAmount: taxAmount is a key fact and is not shown"
    // error.view: the BoundView a receiver would not show, when one was made
  }
  throw error;
}
```

| Option      | What it does                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine`    | Where your app serves `@btps/boundview/engine.wasm`. With it, an SVG logo can travel as outlines; without it, as pixels.                                                                                               |
| `onWarning` | Told about a label that looks like a fact but is not bound, and about a font with no readable font file, whose text is then drawn with a bundled font ([Fonts](#what-the-snapshot-reads)). `console.warn` when absent. |

`snapshotBoundView` captures the preview as a canvas. Text that shows a
signed value is recorded as a [binding](./bindings.md) to that field, fonts
as the outlines of the characters used, and images as their pixels. No
instructions are needed from you.

It then checks the result. The sender's SDK runs the same
[checks](./checks.md) a receiver runs before it signs, so a problem is found
before sending, not after. When the preview cannot make a BoundView a
receiver would accept and show, `snapshotBoundView` throws a
`BoundViewSnapshotError` whose `problems` say why. When it made a well-formed
BoundView that fails a check, the error's `view` holds it, so you can see
which element a problem names. It also warns, without
refusing, when a label's text looks like an amount, a date, an account
number or an address but is not bound: most often an example left in a
design by mistake.

### What the snapshot reads

It reads the preview as the browser laid it out:

- **Text:** each line, and each character's position.
- **Boxes:** solid backgrounds, linear, radial and repeating linear
  gradients, background images, rounded corners, uniform or per-side borders
  (dashed, dotted and double included), outlines, and `box-shadow`, drawn
  approximately. Filters, blends and clip paths are carried on images only;
  on any other element they are ignored. Some CSS is not carried at all, or
  only approximately ([What BoundView does not support](./not-supported.md)).
- **Images:** `<img>` and CSS background images, as pixels at twice their
  size or at their own resolution, whichever is larger, within the
  [limits](./images.md#limits): at most 1,024 pixels a side and 262,144 in
  all. An image must come from the
  same site or allow it (CORS); otherwise the snapshot throws, naming the
  image.
- **SVG:** inline `<svg>` and SVG `<img>`. A logo travels as outlines when
  the engine's picture of the outlines matches the browser's picture of the
  SVG: over white at 2×, a mean difference of at most 3 a channel, and at
  most 1% of pixels differing by more than 64. Anything else (filters,
  masks, clip paths, text, embedded images, gradients by reference, dashes)
  travels as pixels. This is how the builder chooses, not a rule a receiver
  checks.
- **Fonts:** read from the page's own `@font-face` files, as woff, woff2,
  ttf or otf. Where a rule offers woff2 and another source, the other is
  read; a woff2 file is decompressed with Brotli first. A variable font is
  read at the page's weight, at its italic where it has an italic axis, and
  at its optical size for the text's size. A family split into several
  files by `unicode-range` is read as the browser chose: of the files whose
  range holds a character, the last rule first, then the next when that
  file has no glyph for it. A character none of the page's fonts has is
  drawn with a bundled font, as the browser drew it with a fallback; only a
  bound value with a character no font can draw fails. A system font with no
  `@font-face` file, or a file that cannot be read, is drawn with a bundled
  font, with a warning. The bundled font is chosen by family name, and has
  the same widths only for Arial, Times, Courier, Calibri and Cambria; any
  other family is drawn with Arimo, at its own widths. Bundled fonts are
  400 regular only, so bold and italic are lost
  ([Carried approximately](./not-supported.md#carried-approximately)).
  Every style drawn that way with the same bundled font shares one font in
  the BoundView, which carries every glyph they draw. A font the snapshot
  can read is one font for each style: family, weight, style and tabular
  figures. A preview uses at most 8 fonts, counted after sharing.
- **The page:** the preview's box, and whatever overflows it where the
  preview's overflow is not clipped (`overflow: visible`).
- **A visual signature:** where the page draws the document's
  `signatory.visualSignature`, the snapshot puts a `signature` element, which
  the receiver draws from the signed data. A drawn signature is found only
  when the page draws it by the one rule the engine uses
  ([A visual signature](#a-visual-signature)). A typed one is found as a
  line of text that is exactly its text; of several, the one in the page's
  rarest typeface, the one it sets the fewest characters in, and the last
  where they tie.

**Facts are found by their value.** Every way a field may be written is
tried: money separators, prefix and suffix, the nine date patterns,
percents and groups. A binding is kept only when the receiver would write
the field exactly as shown.

- **Across elements and lines.** A value is found whole however the page
  lays it out: "300 Empire" written as an `<h1>` "300" and an `<h2>`
  "Empire", "INV-" and "0042" in two touching spans, a description wrapped
  over two lines. It is bound in the pieces it is drawn in, each by its
  [range](./bindings.md#ranges) of the value as written.
- **The longest match wins a place.** A value found inside a longer one is
  the longer one's: "2026-12-17" in "INV-2026-12-17" is the invoice
  number's, and "1,452" in "A$1,452.00" is the amount's.
- **Line items first.** A line is placed where most of its cells stand,
  nearest them, before the order of the page, so a large heading that
  repeats a line's description is not taken for the line. Each cell is
  looked for in the line's own stretch of the page, from just after the line
  before it to just before the next, so a cell set beside, above or below
  the description is found, as a table row or a card lays it out. Each cell
  is bound once, in the order the document lists its columns, so a line's
  amount is never mistaken for a total. A cell is never taken from inside a
  longer match of another field: a quantity "10" is not the "10" of
  "10/02/2026". An amount is judged by its digits, so "A1" is an invoice
  number, not the amount 1 with a prefix "A".
- **Equal values share.** Fields written alike, such as a receipt's total
  and the amount paid, share the places they are written
  ([When a key fact is shown](./checks.md#when-a-key-fact-is-shown)). Where
  a place could be either of two fields, such as `02/01/2026` for one date
  written day first and another month first, a key fact takes it first.

### A visual signature

A drawn signature has one rule, on its 1,000 by 300 canvas: each stroke's
points in order, a point repeated immediately counted once; a stroke of one
point is a disc as wide as the pen; any other stroke is a line through its
points; all those lines are one path, 8 units wide (`SIGNATURE_STROKE`),
with round caps and joins ([Signatures](./rendering.md#signatures)). The
engine draws a `signature` element by this rule. Show the signature on your
page by the same rule, and your page and the receiver's picture cannot
differ, whatever the strokes.

`@btps/boundview` gives you the rule. Import it from
`@btps/boundview/signature`, a small entry with no engine, safe to load in
any page:

| Export                                           | What it gives                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SIGNATURE_STROKE`                               | The pen's width, 8 units of the canvas. A dot is this wide.                                                                                            |
| `signatureDrawing(strokes)`                      | `{ dots: { cx, cy, r }[], line: { d, strokeWidth } \| null }`, every attribute as the exact string the drawing writes.                                 |
| `signatureSvg(strokes, colour = 'currentColor')` | A whole `<svg viewBox="0 0 1000 300">` string.                                                                                                         |
| `signatureShapes(strokes, at, scale, colour)`    | The same shapes as SVG markup strings, each canvas point placed by `at(x, y)` and the pen `scale` times its width: what the engine draws inside a box. |
| `n(value)`                                       | A number as the drawing writes it: at most four decimals, `'0'` when not finite.                                                                       |

<Tabs groupId="signature-markup">
<TabItem value="react" label="React">

```tsx
import { signatureDrawing } from '@btps/boundview/signature';

export function Signature({ strokes }: { strokes: number[][] }) {
  const { dots, line } = signatureDrawing(strokes);
  return (
    <svg viewBox="0 0 1000 300" width={220} height={66}>
      {dots.map((dot, i) => (
        <circle key={i} cx={dot.cx} cy={dot.cy} r={dot.r} fill="currentColor" />
      ))}
      {line && (
        <path
          d={line.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={line.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
```

</TabItem>
<TabItem value="dom" label="Plain DOM">

```ts
import { signatureSvg } from '@btps/boundview/signature';

// The svg has no size of its own: size it with CSS, e.g. width: 220px
signatureBox.innerHTML = signatureSvg(document.signatory.visualSignature.strokes);
```

</TabItem>
</Tabs>

The snapshot finds the signature by comparing your SVG with what
`signatureSvg` draws for the signed strokes, shape for shape: each shape's
tag and its `d`, `cx`, `cy`, `r` and `stroke-width`, in order. The SVG's
`viewBox` must be `0 0 1000 300`. The ink colour is read from the first
shape: its stroke, or its fill for a dot. Use your page's text colour
(`currentColor`) or any colour you set. `signatureSvg` takes its colour
only as `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or `currentColor`, and throws
a `TypeError` on anything else.

:::warning Any other drawing is not the signature
Polylines, another pen width, a rounded or moved point: any other drawing of
the strokes is not taken as the signature. A signature is a key fact when
the document carries one, so `snapshotBoundView` then throws. You can still
send the document without a BoundView.
:::

### A preview that passes

Design the preview as you like. A receiver shows the BoundView only when it
passes the [checks](./checks.md), and these are the ones a design can
break:

- **Every key fact is on it.** For an invoice: the number, the due date,
  the total, the tax, the note, and each line's description and total. Each
  document type has its own list, and what may be left out
  ([Key facts](./checks.md#key-facts)). A fact must show the document's
  value, not text typed into the design. A design may show more.
- **Every fact is shown in full.** A value is never cut short, wrapped or
  hidden. A receiver may draw it smaller to fit its box, down to three
  quarters of its size and never below 6 pixels, and no further
  ([Shown in full](./checks.md#shown-in-full)).
- **Nothing covers a fact.** No element is drawn over it, it lies wholly on
  the page, and its colour has a contrast of at least 3:1 with what is
  behind it, an image's pixels included: a faint watermark behind a fact is
  fine, a dark one is not ([Not hidden](./checks.md#not-hidden)).

Labels, shapes and images are your design, and may go anywhere. But
`z-index` is ignored: an element with `position` set is drawn after the
text outside it, so it can cover a fact and fail this check. The design can
also make the snapshot throw, by a transformed fact, an image without CORS
or a format limit
([What makes the snapshot throw](./not-supported.md#what-makes-the-snapshot-throw)).

## Show a received BoundView

The SDK checks the BoundView whenever the document is opened, on the server
or on the device, with nothing to call. To show it, call `renderBoundView`
with the opened document. It gives back a finished picture, a PNG, and the
app only displays it.

```ts
import { renderBoundView } from '@btps/boundview';

// PNG bytes (Uint8Array) at 2× by default, or null
const png = await renderBoundView(openedDocument, { scale: 2 });
if (png) {
  img.src = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
}
```

`renderBoundView` gives `null` when the document has no BoundView or it
fails a check, and throws if the engine cannot draw it (or, in a browser,
was not loaded with `initBoundViewEngine`). Either way, show your own view
of the signed data instead, with a notice saying why. The document is still accepted: only its BoundView is not
shown.

### The check's result

The SDK hands you the result of its check with the document, so your app
knows before drawing whether the BoundView may be shown. It is
`{ show: true }`, or `{ show: false, problems }`, and it is absent when the
document carries no BoundView. Each problem names its `check`
(`wellFormed`, `keyFacts`, `shownInFull` or `notHidden`), a `message`, and
the `field` or `element` it is about ([The result](./checks.md#the-result)).

**On a device or a platform**, `decryptVerify(...)` returns it beside the
document:

```ts
const { payload, error, boundView } = await decryptVerify(/* … */);
if (boundView && !boundView.show) {
  // show your own view of the signed data, with a notice from boundView.problems
}
```

**On a server**, a transporter handler gets it as a second argument, and a
`forwardTo` handler gets it as `data.boundView`. It is checked once the
artifact's signature and trust are, for a document the server can read. A
document encrypted to a device is checked by `decryptVerify` on that device.

```ts
server.onIncomingArtifact('Transporter', (artifact, boundView) => {
  // boundView: { show: true }, { show: false, problems }, or undefined
});
```

:::tip Checking or drawing yourself
`checkBoundView(document, boundView)` and `writtenValue(value, bind)`, the
exact string a binding draws, are exported from `@btps/sdk/server` and
`@btps/sdk/client`, for anyone checking or drawing a BoundView themselves.
A browser or app that draws or captures a BoundView without the rest of the
SDK can import from `@btps/sdk/boundview`, which is browser-safe and holds
only the schema, bindings and checks: `BtpBoundViewSchema`, `isPathData`,
`boundValue`, `bindingProblem`, `markdownHidden`, `checkBoundView`,
`keyFacts`, `boundViewResultOf`, `writtenValue`, `CONTRAST_WORK_LIMIT` and
the types.

Advanced: `boundViewToSvg(document, boundView, bundled?)` from
`@btps/boundview` gives the drawing the engine reads, for a BoundView that
already passed the checks
([What the engine reads](./rendering.md#what-the-engine-reads)). Its
optional third argument is the bundled fonts the drawing needs:
`await loadBundledFonts(bundledFontsFor(document, boundView), bundledCharactersFor(document, boundView))`.
`bundledFontsFor` names the fonts, and `bundledCharactersFor` the characters
they may be asked for, so a font's second file is loaded only when one of
them needs it. All three helpers are exported from `@btps/boundview`, and
`renderBoundView` does this itself.
:::

:::note Drawing is always done by `@btps/boundview`
The drawing engine is part of `@btps/boundview`, not an option: every
receiver that draws a BoundView draws it with the same code, in a browser, on
a server and in an app. It runs in a
[closed box](./rendering.md#the-engine-a-closed-box): validated values in, a
PNG out, nothing fetched.
:::

## What the receiving app shows around a BoundView

Some of a document is shown by the receiving app itself, around the
BoundView, never by it:

- **Who sent it**: the verified sender, with its trust status.
- **Its title.**
- **Its attachments**, as files the receiver can open or save.
- **Its references** to other documents, and its **payment link**, each
  with the address it goes to.
- **All its details**: a way to see every signed field, including any the
  BoundView does not draw.

So a BoundView cannot pose as the sender, hide an attachment, or disguise
where a link goes.

Your own view of the signed data is the truth, not the BoundView. Every fact
on a BoundView is written from the signed fields, but the shapes of its
characters are drawn from the sender's glyph outlines, and nothing checks
that a glyph's shape is the character it stands for
([Glyph shapes are the sender's](./security.md#glyph-shapes-are-the-senders)).
Show your own view alongside the BoundView or a press away, and say near the
BoundView that amounts and other facts are confirmed there. eBill, for
example, shows a note to confirm amounts in its own view.

:::warning A receiver must show these
Showing the verified sender, the title, the attachments, the references and
the payment link outside the BoundView, and offering the all-details view,
is part of what a receiver must do
([Security model](./security.md#what-a-receiver-must-do)). The all-details
view is offered whether a BoundView is shown or not.
:::

## When a check fails

| What is wrong                                                                        | What happens                                                                                              | What the app shows                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| The canvas breaks its schema or a limit, or binds a field the document does not have | The **document is refused**, as a document with any other malformed field is, with `BTP_ERROR_VALIDATION` | Nothing: the document was not accepted                    |
| The canvas is well formed but fails a [check](./checks.md#the-checks)                | The **document is accepted** and the **BoundView is not shown**                                           | Its own view of the signed data, with a notice saying why |

A BoundView that fails a check is never shown in part, and the document
behind it is never lost.

## Versions

`boundView` travels in `1.2.0` artifacts only, and it is optional. Without
one, the receiver shows its own view of the data.

`template` is `1.1.0` only. A document that carries one and nothing from 1.2
is still sent as `1.1.0` and works as before. Once you add anything from
1.2 to it, a BoundView included, it is stamped `1.2.0`, and your own SDK
refuses it before sending until `template` is removed. To keep the
document's look, send a BoundView instead
([Versions](./overview.md#versions)).

## Next

- [What BTPS promises](./overview.md#what-btps-promises), and what it does not.
- [Notes, discounts and BoundView](../../../features/notesDiscountsTemplates.md),
  the feature guide, with the errors a sender's SDK and a receiver return.
- The [examples](./examples.md): a complete invoice and a letter, each with
  its BoundView.
