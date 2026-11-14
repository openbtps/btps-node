---
title: Using the Document View
sidebar_label: Using it
slug: /protocol/specifications/document-view/using
description: For platforms. Send a document with its view and show a received one with @btps/view, in a few lines and with no format to learn.
---

# Using the document view

For platforms that send documents or show them. `@btps/view` does the work:
you keep designing your preview in HTML, and you never write or read a
canvas yourself. The [specification](./overview.md#the-specification) is
for implementers and you do not need it.

| Step | Where it runs | What you call |
| --- | --- | --- |
| [Send a document with its view](#send-a-document-with-its-view) | The browser where your preview is shown | `snapshotLayout(previewElement, document)` |
| Check a received view | The receiving server, or the device that holds the key | Nothing: the SDK checks it whenever the document is opened |
| [Show a received view](#show-a-received-view) | Wherever your app displays documents | `renderLayout(openedDocument)` |

## Send a document with its view

Hand the preview's HTML element and the document it shows to
`snapshotLayout`, in the browser where the preview is shown. Put what it
returns in `template.layout`, and send the document as usual.

```ts
import { snapshotLayout } from '@btps/view';

// The preview you already show, and the document it shows
const layout = await snapshotLayout(previewElement, document);
await agent.command('artifact.send', to, { ...document, template: { layout } });
```

`snapshotLayout` captures the preview as a canvas. Text that shows a signed
value is recorded as a [binding](./bindings.md) to that field, fonts as the
outlines of the characters used, and images as their pixels. No
instructions are needed from you.

It then checks the result. The sender's SDK runs the same
[checks](./checks.md) a receiver runs before it signs, so a problem is found
before sending, not after. It also warns, without refusing, when a label's
text looks like an amount, a date, an account number or an address but is
not bound: most often an example left in a design by mistake.

### A preview that passes

Design the preview as you like. A receiver shows the view only when it
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

## Show a received view

The SDK checks the view whenever the document is opened, on the server or
on the device, with nothing to call. To show it, call `renderLayout` with the
opened document. It gives back a finished picture, a PNG, and the app only
displays it.

```ts
import { renderLayout } from '@btps/view';

// A PNG to display, or null when the view failed a check
const png = await renderLayout(openedDocument);
```

When `renderLayout` gives `null`, show your own view of the signed data
instead, with a notice saying why. The document is still accepted: only its
view is not shown.

:::note Drawing is always done by `@btps/view`
The drawing engine is part of `@btps/view`, not an option: every receiver
that draws a view draws it with the same code, in a browser, on a server
and in an app. It runs in a [closed box](./rendering.md#the-engine-a-closed-box):
validated values in, a PNG out, nothing fetched.
:::

## What the receiving app shows around the view

Some of a document is shown by the receiving app itself, around the view,
never by the view:

- **Who sent it**: the verified sender, with its trust status.
- **Its title.**
- **Its attachments**, as files the receiver can open or save.
- **Its references** to other documents, and its **payment link**, each
  with the address it goes to.
- **All its details**: a way to see every signed field, including any the
  view does not draw.

So a view cannot pose as the sender, hide an attachment, or disguise where
a link goes.

:::warning A receiver must show these
Showing the verified sender, the title, the attachments, the references and
the payment link outside the view, and offering the all-details view, is
part of what a receiver must do ([Security model](./security.md#what-a-receiver-must-do)).
The all-details view is offered whether a view is shown or not.
:::

## When a check fails

| What is wrong | What happens | What the app shows |
| --- | --- | --- |
| The canvas breaks its schema or a limit, or binds a field the document does not have | The **document is refused**, as a document with any other malformed field is, with `BTP_ERROR_VALIDATION` | Nothing: the document was not accepted |
| The canvas is well formed but fails a [check](./checks.md#the-checks) | The **document is accepted** and the **view is not shown** | Its own view of the signed data, with a notice saying why |

A view that fails a check is never shown in part, and the document behind it
is never lost.

## Versions

A view travels in `1.2.0` artifacts only. A `1.1.0` artifact's `template`
keeps its 1.1 form, and a 1.2 receiver draws nothing from it
([Versions](./overview.md#versions)).

## Next

- [What BTPS promises](./overview.md#what-btps-promises), and what it does not.
- [Notes, discounts and the document view](../../../features/notesDiscountsTemplates.md),
  the feature guide, with the errors a sender's SDK and a receiver return.
- The [examples](./examples.md): a complete invoice and a letter, with their views.
