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
| **1.2** | Beta (planned)       | Everything below that is ready. The wire settles: changes after 1.2 should only add, not break.        |
| **1.3** | General release      | Stable. The SDK's unit tests cover 100% of its code.                                                   |

**Every item below is a plan, not a promise.** Each gets a design before it is
built, and may change or move to a later release. A server refuses artifacts of
another protocol version, so a 1.2 feature never reaches a 1.1 server that
cannot understand it.

**Tell us what you need.** Open an
[issue on GitHub](https://github.com/openbtps/btps-node/issues) to ask for
something, or to say which of these matters most to you.

## Planned for 1.2 (beta)

### Trust permissions

Today a trust is a single yes or no: the receiver accepts the sender, or does
not. In 1.2 a trust request lists exactly what the sender asks for, and the
receiver sees it the way an app's sign-in screen shows what it will get:

- **What it may send:** invoices only, payslips and invoices, letters, and so on.
- **Which personal details it may see:** chosen field by field (email, phone,
  address, date of birth). A bank might ask for full details; a plumber for none.
- **Required or optional:** the receiver cannot remove a required permission,
  only reject the request; optional ones can be granted or left out.

The request and its answer are always encrypted, because they carry personal
details. Still to design: standard permission names every provider shows the
same way, how granted details reach the sender, and how to ask for more later.

### Letters that can be agreed to

1.1 already carries letters. 1.2 lets a letter ask to be **accepted**, so
agreements (a loan contract, a phone plan) can be signed over BTPS:

- the letter states what must be accepted (its terms, by their attachments'
  hashes) and by when;
- the receiver answers `accepted` or `declined`, **signed by their own device
  key**, never by the provider on their behalf;
- an **evidence bundle** (the signed letter, the signed answer and the keys
  used) that anyone can verify offline, without trusting any vendor;
- proof that still verifies years later, after keys have rotated;
- several signers, in order (the customer accepts, then the bank countersigns).

### A core for every platform

BTPS is for any app: mobile, desktop and web, in any language. 1.2 starts
**`btps-core` in Rust**: canonical JSON, signing, encryption, addresses and
the document rules, written once. Then bindings for Swift (iOS, macOS), Kotlin
(Android), React Native and the browser (WebAssembly). This is how Signal and
Matrix ship one protocol to every platform.

The [golden vectors](./protocol/specifications/golden-vectors.md) are the
contract: the Rust core, this SDK and any other implementation must pass the
same vectors.

### More device key types

BTPS 1.1 keys are RSA. An iPhone's Secure Enclave holds only P-256 keys, so a
1.1 device key on an iPhone lives in the Keychain, not in hardware. 1.2 plans
**P-256 (ECDSA) device keys**, so a phone's key never leaves its hardware, and
**Ed25519** for identities, whose signatures are much cheaper to verify.

### Safer devices

- **Signals for a stolen device key:** a provider can be told when a device's
  key rotates, and when a refresh token is used twice, which suggests a copy.
  What to tell the user stays the provider's choice.
- **An optional maximum key age**, off by default, for providers that want
  devices to rotate on a schedule.

### Currency symbols in addresses

Addresses may use a currency symbol as the separator: `bob€example.com` and
`bob£example.com` as well as `bob$example.com`. Still to settle: the exact
list of symbols, and whether `bob€example.com` and `bob$example.com` are the
same address.

### Clearer answers and faster servers

- **A device can be told the id of what it just created** (a draft, for
  example), and a provider's malformed answer reaches the device as a clear
  error instead of a closed connection.
- **Less work per artifact:** one pass that checks and canonicalises the JSON
  instead of four, and a cache of parsed keys, measured with benchmarks first.
- **Simpler device commands:** a device acting on its own data need not name
  its own address.

## Later

- **The BTPS CLI**, being built as its own project, to try BTPS from a
  terminal.
- **A universal document envelope**, for document types beyond the ones the
  protocol defines. For now, the `letter` covers general documents.

## Already in 1.1

See the [changelog](https://github.com/openbtps/btps-node/blob/master/CHANGELOG.md)
for everything the alpha includes.
