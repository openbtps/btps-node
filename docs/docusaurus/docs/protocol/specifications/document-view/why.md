---
title: Why the Document View
sidebar_label: Why it exists
slug: /protocol/specifications/document-view/why
description: Why BTPS carries a document's view - the gap between verified data and the page a person reads, how the view closes it, and what email, PDFs, e-invoicing networks and portals cannot do.
---

# Why the document view

BTPS proved who sent a document and that its data was not altered. It did
not prove that the page a person looks at matches that data. The document
view closes that gap: the sender keeps its own design, and the receiver gets
a guarantee that the page shows the signed data.

## The trust BTPS already gave

Before 1.2, BTPS promised four things about a billing document:

- **Only senders the receiver has trusted can deliver.** A sender asks first,
  and the receiver approves it ([Trust record](../../trustRecord.md)).
- **The sender is verified**, by signatures with keys published in DNS.
- **The content is encrypted** to the receiver.
- **What was signed arrives unaltered.**

That is BTPS's place: billing documents between independent parties, where
email and supplier portals are used today. It is not a replacement for TLS.
TLS protects a connection; BTPS adds proof and protection to the message
itself, and they last after delivery.

## The gap: the page a person reads

People pay from a page, not from JSON. And a business wants its documents to
look like its own. Before the view, there were two ways to show a document,
and each lost something.

| Choice | What it keeps | What it loses |
| --- | --- | --- |
| **The receiver draws its own view of the data** | Trust: the page is drawn from the signed data | The sender's design does not travel, and the document looks different on every provider |
| **The sender's own design travels**, as an HTML email, a PDF or a template | The look the sender designed | Nothing ties the amount or the bank details shown to the signed data. And the file is an attack surface: its fonts, images and scripts are parsed on the receiver's device, and remote images are used to track when it is read |

:::note Templates by reference
The earlier 1.2 release candidates had templates by reference: a template
named by its address and hash, fetched from that address. They did not
guarantee that the receiver saw what the sender saw. The document view
replaces them.
:::

## How the view closes it

Each step is already specified; follow the links for the detail.

| What | How | Specified on |
| --- | --- | --- |
| The sender keeps its design | The sender's own HTML preview is captured when the document is sent, and the canvas is signed inside the document | [Using it](./using.md), [Canvas](./canvas.md) |
| The page shows the signed data | Facts are bindings drawn from the signed fields, never text | [Bindings and formats](./bindings.md) |
| Nothing is parsed from a sender's file, nothing is fetched | Fonts travel as glyph outlines and images as pixels | [Fonts and glyphs](./fonts.md), [Images](./images.md) |
| Nothing is hidden | The receiver checks wherever the document is opened: every key fact shown, in full, not hidden. When a check fails, it shows its own view, and the document is never lost | [Checks](./checks.md) |
| The same page on every receiver | One engine draws the canvas, in a closed WebAssembly box | [Rendering](./rendering.md) |
| The view cannot pose as the sender | The verified sender, the links and the attachments are shown outside the view | [What the receiving app shows around the view](./using.md#what-the-receiving-app-shows-around-the-view) |

## What it adds to the trust claim

BTPS's claim was **who sent it, and that it is unaltered**. With the view, it
is **who sent it, that it is unaltered, and that what you see is what was
signed**.

:::warning The limit
BTPS does not claim that the content is true. A mistake the sender typed,
and the sender's own words on the view, remain the sender's. The receiver
decides whom to trust ([Security model](./security.md)).
:::

## What current systems cannot do

### Email

An invoice sent as an HTML email or as a PDF attachment.

- DKIM, SPF and DMARC can show which domain sent a message, and S/MIME can
  sign it. None of them ties the amount or the bank details a person reads
  to any checked data.
- HTML email can load remote images, commonly used to see when a message is
  opened.
- Invoice fraud that alters the payment details, or sends a lookalike
  invoice, works because the reader cannot tell.

### Signed PDFs

- A signature protects the file's bytes, not the meaning of what is shown.
  Published research showed signed PDFs whose displayed content could be
  hidden or replaced while the signature still validated: "Shadow Attacks:
  Hiding and Replacing Content in Signed PDFs" (Mainka, Mladenov, Rohlmann,
  Schwenk), NDSS 2021.
- A PDF also carries fonts, images and optional scripts that the reader's
  software must parse, and font and image parsers have been exploited in
  real attacks.

### Hybrid invoices

A PDF with embedded structured data, for example Factur-X / ZUGFeRD. The
visible page and the embedded data travel side by side. Nothing in the
format mechanically checks that the page a person reads matches the data a
machine reads.

### Structured e-invoicing networks

For example Peppol with UBL. The data is structured, and the receiver
renders it with its own stylesheet, so the sender's design does not travel.
A PDF rendition attached for people to read has the same mismatch problem
as any other PDF.

### Supplier portals

The look is kept, but the document lives on the sender's website. The
receiver has to log in to each portal, and nothing arrives in the receiver's
own system with a check on what is shown.

### TLS

TLS secures the connection in transit. After delivery it proves nothing
about the document or what is displayed.

## Side by side

✓ yes, ✗ no, **Partly** with a note, and — where the comparison does not
apply or is not made here.

| | Verified sender | Page tied to the signed data | Sender's design travels | Nothing fetched or parsed from the sender's files | Works across providers |
| --- | --- | --- | --- | --- | --- |
| **Email**, HTML or a PDF attachment | Partly: DKIM, SPF and DMARC show the sending domain, and S/MIME can sign | ✗ | ✓ | ✗ remote images, and the attachment's fonts, images and scripts | ✓ |
| **Signed PDF** | Partly: the signer's certificate, when the reader trusts its issuer | ✗ the signature covers bytes, not what is shown | ✓ | ✗ fonts, images and optional scripts | — |
| **Hybrid invoice** (Factur-X / ZUGFeRD) | — | ✗ nothing checks the page against the embedded data | ✓ | ✗ it is a PDF | — |
| **E-invoicing network** (Peppol with UBL) | — | Partly: the receiver draws the data with its own stylesheet, but an attached PDF rendition is not tied | ✗ | — | — |
| **Supplier portal** | — | ✗ | ✓ | ✗ the receiver loads the sender's website and runs its scripts | ✗ a log-in for each portal |
| **TLS** | Partly: the server it connects to, in transit, not who wrote the document | ✗ | — | — | — |
| **BTPS before 1.2**, the receiver's own view | ✓ signatures, keys in DNS | ✓ the receiver draws the data itself | ✗ | ✓ | ✓ |
| **BTPS with the document view** | ✓ shown outside the view | ✓ bindings, checked wherever it is opened | ✓ | ✓ glyph outlines and pixels, nothing fetched | ✓ |

## Next

- [Overview](./overview.md): what the view is and what BTPS promises.
- [Using the document view](./using.md): the few lines a platform needs.
- [Security model](./security.md): threats, guarantees and what a receiver must do.
