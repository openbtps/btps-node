---
title: Document View Security Model
sidebar_label: Security model
slug: /protocol/specifications/document-view/security
---

# Security model

:::note Reference
`@btps/view` makes and draws views for you, from the HTML preview you
already have ([Overview](./overview.md#you-do-not-build-any-of-this)). This
page is the specification, for building your own builder or renderer.
:::

What a view guarantees, against whom, and what a receiver must do for those
guarantees to hold.

## What BTPS answers for, and what it does not

BTPS answers for **delivery and a faithful view**: what was signed arrives
unchanged, from the sender it says, with nothing that runs or reports back,
and its view shows the document's signed facts as they are.

BTPS does not answer for **whether the content is true**. A sender can type a
wrong amount, and a sender's own words, its labels and its notes, say what
the sender chose. The receiver trusts a sender or does not, and can reject,
block or stop trusting one. A trust request is needed before a sender can
send at all.

## Threats

| Who | What they try | What stops it |
| --- | --- | --- |
| Anyone between sender and receiver | Change the view or the data | The artifact's signature covers both. Any change and the document is refused. |
| A dishonest sender | Show an amount, date or name the document does not carry | Facts are drawn from the signed fields, never from the canvas. A bound element cannot show anything else. |
| A dishonest sender | Hide or shrink a fact, or leave one out | [Key facts](./checks.md#key-facts), [shown in full](./checks.md#shown-in-full) and [not hidden](./checks.md#not-hidden). The all-details view shows every other field. |
| A dishonest sender | Pose as someone else in the view | The receiving app shows the verified sender outside the view. A view saying "Telstra" in large letters is the sender's design; the verified line beside it says who sent it. |
| A dishonest sender | Hide where a link goes, or what a file is | Links and attachments are shown by the receiving app, never by the view. |
| A crafted font or image | Attack the receiver's font or image decoder | A view carries no font or image file: glyph outlines and pixels only. |
| A crafted canvas | Inject markup, or exhaust the receiver | Strict schema, closed lists, limits on every count and size; values are never passed to anything that reads markup. |
| A crafted canvas | Break the renderer to reach the device | The engine runs as WebAssembly in a [closed box](./rendering.md#the-engine-a-closed-box): no network, no files, no page, only validated values in and a PNG out. A fault stays inside it, and the receiver shows its own view instead. |
| A view that tracks its reader | Learn when, or whether, a document is read | Nothing in a view is fetched: no address, no font, no image from anywhere. |

## What a receiver must do

- Run [`checkLayout`](./checks.md) wherever the document is opened, before
  showing the view, and show its own view of the data when a check fails.
- Show the verified sender, the title, the attachments, the references and
  the payment link outside the view, and offer the all-details view.
- Draw a view by the [rendering rules](./rendering.md), or not at all.
- Never place a canvas value into HTML, SVG or CSS as markup. The reference
  renderer builds its picture from validated numbers and colours only.

## What remains

- A view shows the document truthfully; it cannot make the document true. A
  key that is stolen signs documents as its owner; a sender's notes can
  carry anything the sender writes.
- A sender's labels, shapes and images can say anything the sender designs,
  as an email or a printed letter can. They are never presented as facts the
  protocol has checked.
- A receiving app that does not follow these rules is outside the protocol's
  reach, as one that shows the wrong amount from plain data would be.
