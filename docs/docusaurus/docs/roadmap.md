---
title: Roadmap
sidebar_label: Roadmap
slug: roadmap
---

# Roadmap

Where BTPS is going after 1.1, so you know what to expect and can tell us
what matters to you.

| Release | Stage                | What it means                                                                                          |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| **1.1** | **Alpha** (released) | The protocol and this SDK are usable and tested. The wire may still change before the general release. |
| **1.2** | Beta (in testing)    | What "In 1.2" lists below. The wire settles: changes after 1.2 should only add, not break.             |
| **1.3** | General release      | Stable. The SDK's unit tests cover 100% of its code.                                                   |

**Every item after 1.2 is a plan, not a promise.** Each gets a design before it
is built, and may change or move to a later release. A server refuses artifacts of
another protocol version, so a 1.2 feature never reaches a 1.1 server that
cannot understand it.

**Tell us what you need.** Open an
[issue on GitHub](https://github.com/openbtps/btps-node/issues) to ask for
something, or to say which of these matters most to you.

## In 1.2 (beta, not yet released)

1.2 is being tested before it is released. The
[changelog](https://github.com/openbtps/btps-node/blob/release/1.2/CHANGELOG.md)
lists every change, and what a 1.1 provider does to upgrade.

### Trust permissions

A trust request lists exactly what the sender asks for, and the receiver grants
it the way an app's sign-in screen shows what it will get:

- **What it may send:** each document type by name (`send:invoice`,
  `send:receipt`, `send:payslip`, `send:letter`, `send:agreement`).
- **Which details it may hold:** chosen one by one (legal name, profile, email,
  phone, address, tax number, date of birth, registration number). Each side
  gives what it asks for.
- **Required or optional:** a grant that leaves out a required permission is
  refused; optional ones can be granted or left out.
- **Kept up to date:** each side can be told when the other's details change,
  and fetch again only what it already holds. A trust can later be changed to
  ask for more, or less.

The names travel signed and readable, so a receiver's server checks them on
arrival; the values are always encrypted. A request to a 1.1 provider goes as
1.1 allows, and the sender is told what was left out.

### Agreements

A new document type, `agreement`, asks to be accepted, so a loan contract or a
phone plan can be signed over BTPS:

- it states what must be accepted (its terms, by their attachments' hashes),
  by when, and by whom, in turn or in any order;
- each signer answers `accepted` or `declined` with a signed statement, by its
  own device key or by its identity key, and which kind signed is recorded;
- an **evidence bundle** (the signed agreement, every signed answer and the
  keys used) that anyone can check offline, from the command line too;
- an optional **trusted timestamp** on each answer, so it still proves when it
  was signed after keys have rotated.

### Safer devices

- **Signals for a stolen device key:** a provider can be told when a device's
  key rotates, and when a refresh token is used twice, which suggests a copy.
  What to tell the user stays the provider's choice.
- **A grace window for a lost answer:** a device that refreshed but lost the
  answer can ask again for a short time without being taken for a thief.
- **An optional maximum key age**, off by default, for providers that want
  devices to rotate on a schedule.
- **A device's own key to its documents:** a provider can let a device open an
  encrypted document with the device's own key.

### Clearer answers and faster servers

- **A device can be told the id of what it just created** (a draft, for
  example), and a provider's malformed answer reaches the device as a clear
  error instead of a closed connection.
- **One place to cache keys:** every key lookup goes through one option, so a
  provider can cache them.
- **A 429 says how long to wait.**

## Moved from the 1.2 plan to a later release

- **A core for every platform:** `btps-core` in Rust, with bindings for Swift,
  Kotlin, React Native and the browser. The
  [golden vectors](./protocol/specifications/golden-vectors.md) remain the
  contract every implementation must pass.
- **More device key types:** P-256 (ECDSA) device keys for a phone's secure
  hardware, and Ed25519 for identities.
- **Currency symbols in addresses**, such as `bob€example.com`.
- **One pass over each artifact's JSON**, in place of several.
- **Simpler device commands:** a device acting on its own data need not name its
  own address.

## Later

- **The BTPS CLI**, being built as its own project, to try BTPS from a
  terminal.
- **A universal document envelope**, for document types beyond the ones the
  protocol defines. For now, the `letter` covers general documents.

## Already in 1.1

See the [changelog](https://github.com/openbtps/btps-node/blob/master/CHANGELOG.md)
for everything the alpha includes.
