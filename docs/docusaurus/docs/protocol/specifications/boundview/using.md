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
| [Send a document with its BoundView](#send-a-document-with-its-boundview) | The browser where your preview is shown | `snapshotBoundView(previewElement, document)` |
| Check a received BoundView | The receiving server, or the device that holds the key | Nothing: the SDK checks it whenever the document is opened |
| [Show a received BoundView](#show-a-received-boundview) | Wherever your app displays documents | `renderBoundView(openedDocument)` |

## Send a document with its BoundView

Hand the preview's HTML element and the document it shows to
`snapshotBoundView`, in the browser where the preview is shown. Put what it
returns in the document's `boundView` field, and send the document as usual.

```ts
import { snapshotBoundView } from '@btps/boundview';

// The preview you already show, and the document it shows
const boundView = await snapshotBoundView(previewElement, document);
await agent.command('artifact.send', to, { ...document, boundView });
```

`snapshotBoundView` captures the preview as a canvas. Text that shows a
signed value is recorded as a [binding](./bindings.md) to that field, fonts
as the outlines of the characters used, and images as their pixels. No
instructions are needed from you.

It then checks the result. The sender's SDK runs the same
[checks](./checks.md) a receiver runs before it signs, so a problem is found
before sending, not after. It also warns, without refusing, when a label's
text looks like an amount, a date, an account number or an address but is
not bound: most often an example left in a design by mistake.

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

// A PNG to display, or null when the view failed a check
const png = await renderBoundView(openedDocument);
```

When `renderBoundView` gives `null`, show your own view of the signed data
instead, with a notice saying why. The document is still accepted: only its
BoundView is not shown.

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
