---
title: Using BoundView
sidebar_label: Using it
slug: /protocol/specifications/boundview/using
description: For platforms. Send a document with its BoundView and show a received one with @btps/boundview, in a few lines and with no format to learn.
---

# Using BoundView

For platforms that send documents or show them. `@btps/boundview` does the
work: you keep designing your preview in HTML, and you never write or read a
canvas yourself. The [specification](./overview.md#the-specification) is
for implementers and you do not need it.

| Step | Where it runs | What you call |
| --- | --- | --- |
| [Install and load the engine](#install) | Once, where you capture or draw | `initBoundViewEngine(...)` in a browser or app; automatic in Node |
| [Send a document with its BoundView](#send-a-document-with-its-boundview) | The browser where your preview is shown | `snapshotBoundView(previewElement, document)` |
| Check a received BoundView | The receiving server, or the device that holds the key | Nothing: the SDK checks it whenever the document is opened |
| [Show a received BoundView](#show-a-received-boundview) | Wherever your app displays documents | `renderBoundView(openedDocument)` |

## Install

```bash
npm install @btps/boundview
```

`@btps/boundview` needs `@btps/sdk` 1.2.0-rc.3 or later beside it. It draws
with one engine, compiled to WebAssembly and shipped in the package as
`@btps/boundview/engine.wasm`. In Node it loads by itself. In a browser or
an app, serve that file with your app and load it once, before the first
snapshot or picture:

```ts
import { initBoundViewEngine } from '@btps/boundview';

// Or whatever URL your bundler gives @btps/boundview/engine.wasm
await initBoundViewEngine(new URL('@btps/boundview/engine.wasm', import.meta.url));
```

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
    onWarning: (message) => console.warn(message), // the default
  });
  await agent.command('artifact.send', to, { ...document, boundView });
} catch (error) {
  if (error instanceof BoundViewSnapshotError) {
    // error.problems: why a receiver would not accept or show it,
    // e.g. "subtotalAmount: … not shown"
  }
  throw error;
}
```

| Option | What it does |
| --- | --- |
| `engine` | Where your app serves `@btps/boundview/engine.wasm`. With it, an SVG logo can travel as outlines; without it, as pixels. |
| `onWarning` | Told about a label that looks like a fact but is not bound, and about a font with no readable font file, whose text is then drawn with the bundled font of the same widths. `console.warn` when absent. |

`snapshotBoundView` captures the preview as a canvas. Text that shows a
signed value is recorded as a [binding](./bindings.md) to that field, fonts
as the outlines of the characters used, and images as their pixels. No
instructions are needed from you.

It then checks the result. The sender's SDK runs the same
[checks](./checks.md) a receiver runs before it signs, so a problem is found
before sending, not after. When the preview cannot make a BoundView a
receiver would accept and show, `snapshotBoundView` throws a
`BoundViewSnapshotError` whose `problems` say why. It also warns, without
refusing, when a label's text looks like an amount, a date, an account
number or an address but is not bound: most often an example left in a
design by mistake.

### What the snapshot reads

It reads the preview as the browser laid it out:

- **Text:** each line, and each character's position.
- **Boxes:** solid backgrounds, CSS `linear-gradient` backgrounds, rounded
  corners, and uniform or per-side borders. Decoration it cannot carry, such
  as `box-shadow` or filters, is simply not captured.
- **Images:** `<img>` and CSS background images, as pixels at twice their
  size within the [limits](./images.md#limits). An image must come from the
  same site or allow it (CORS); otherwise the snapshot throws, naming the
  image.
- **SVG:** inline `<svg>` and SVG `<img>`. A logo travels as outlines when
  the engine's picture of the outlines matches the browser's picture of the
  SVG: over white at 2×, a mean difference of at most 3 a channel, and at
  most 1% of pixels differing by more than 64. Anything else (filters,
  masks, clip paths, text, embedded images, gradients by reference, dashes)
  travels as pixels. This is how the builder chooses, not a rule a receiver
  checks.
- **Fonts:** read from the page's own `@font-face` files. A woff, ttf or otf
  source is needed: a font offered only as woff2 is drawn with the bundled
  font of the same widths, with a warning. A preview uses at most 4 fonts.

**Facts are found by their value.** Every way a field may be written is
tried: money separators, prefix and suffix, the nine date patterns,
percents, groups, and ranges for wrapped text. A binding is kept only when
the receiver would write the field exactly as shown. A line item's amount is
taken only on its own row's band, so it is never mistaken for a total.

### A preview that passes

Design the preview as you like. A receiver shows the BoundView only when it
passes the [checks](./checks.md), and these are the ones a design can
break:

- **Every key fact is on it.** The number, the dates, the amounts, the
  names, the note and each line's description and total for an invoice;
  each document type has its own list ([Key facts](./checks.md#key-facts)).
  A fact must show the document's value, not text typed into the design.
- **Every fact is shown in full.** A value is never cut short, wrapped or
  hidden. A receiver may draw it smaller to fit its box, down to three
  quarters of its size and never below 6 pixels, and no further
  ([Shown in full](./checks.md#shown-in-full)).
- **Nothing covers a fact.** No element is drawn over it and no image lies
  under it, it lies wholly on the page, and its colour has a contrast of at
  least 3:1 with what is behind it ([Not hidden](./checks.md#not-hidden)).

Labels, shapes and images are your design, and may go anywhere.

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
fails a check. Then show your own view of the signed data instead, with a
notice saying why. The document is still accepted: only its BoundView is not
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
`boundValue`, `bindingProblem`, `checkBoundView`, `boundViewResultOf`,
`writtenValue`, `CONTRAST_WORK_LIMIT` and the types.

Advanced: `boundViewToSvg(document, boundView)` from `@btps/boundview`
gives the drawing the engine reads, for a BoundView that already passed the
checks ([What the engine reads](./rendering.md#what-the-engine-reads)).
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

:::warning A receiver must show these
Showing the verified sender, the title, the attachments, the references and
the payment link outside the BoundView, and offering the all-details view,
is part of what a receiver must do
([Security model](./security.md#what-a-receiver-must-do)). The all-details
view is offered whether a BoundView is shown or not.
:::

## When a check fails

| What is wrong | What happens | What the app shows |
| --- | --- | --- |
| The canvas breaks its schema or a limit, or binds a field the document does not have | The **document is refused**, as a document with any other malformed field is, with `BTP_ERROR_VALIDATION` | Nothing: the document was not accepted |
| The canvas is well formed but fails a [check](./checks.md#the-checks) | The **document is accepted** and the **BoundView is not shown** | Its own view of the signed data, with a notice saying why |

A BoundView that fails a check is never shown in part, and the document
behind it is never lost.

## Versions

`boundView` travels in `1.2.0` artifacts only. `template` keeps its 1.1
form in any version, and a receiver draws nothing from it
([Versions](./overview.md#versions)).

## Next

- [What BTPS promises](./overview.md#what-btps-promises), and what it does not.
- [Notes, discounts and BoundView](../../../features/notesDiscountsTemplates.md),
  the feature guide, with the errors a sender's SDK and a receiver return.
- The [examples](./examples.md): a complete invoice and a letter, each with
  its BoundView.
