---
title: What's new in 1.2
sidebar_label: Overview
slug: /whats-new
---

# What's new in 1.2

BTPS 1.2 is the beta: the wire settles, and changes after it should only add, not break. A 1.2 provider talks to every 1.1 provider, and nothing a 1.1 provider sends changes ([Versions and 1.1](./versions.md)).

Each page below explains one feature: what it is and why, the flow as a diagram, the exact artifacts (every example is checked against the 1.2 schemas by the SDK's own tests), code for both sides taken from the end-to-end journeys, the errors and who gives them, and what is the protocol's and what is your platform's.

| Feature                                                        | In one line                                                                                                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Trust permissions](./trustPermissions.md)                     | A trust request lists what it asks for, `send:` and `detail:` names, required or optional; the receiver grants all or part, and either side can change it later. |
| [Document types on sends](./documentTypes.md)                  | Under a trust with permissions, every send names its `documentType`, and only granted types are taken.                                                           |
| [Details refresh](./detailsRefresh.md)                         | Each side is told when the other's details change, and fetches again only what it already holds.                                                                 |
| [Verification](./verification.md)                              | A provider signs what it checked of a sender; the receiver gets the facts and decides whom to trust.                                                             |
| [Agreements](./agreements.md)                                  | A document that asks to be accepted, signed by each signer in turn or in any order.                                                                              |
| [Evidence bundles and timestamps](./evidenceBundles.md)        | One file that proves an agreement offline, with optional RFC 3161 timestamps, from code or the command line.                                                     |
| [Withdrawing proposals](./withdrawingProposals.md)             | A payer takes back an unanswered proposal, and may propose again later.                                                                                          |
| [Devices in 1.2](./devices.md)                                 | A device's own key to its documents, signed answers it can require, sync, and each send's delivery.                                                              |
| [Refresh tokens](./refreshTokens.md)                           | A token used twice revokes the device; a lost answer can be retried; a racing refresh is told to wait.                                                           |
| [Notes, discounts and templates](./notesDiscountsTemplates.md) | Notes with a format, discounts, templates by reference, payslip and letter templates, signature slots.                                                           |
| [Versions and 1.1](./versions.md)                              | How 1.1 and 1.2 talk: stamping, version refusals, shaping, and the closing signal.                                                                               |
| [Your platform's checks](./platformChecks.md)                  | What the server checks and what is yours: the four middleware, plain functions, errors, limits, key caching.                                                     |

## Upgrading a 1.1 provider

A 1.1 provider upgrades without changing what it sends. What changes in the trust and token stores, which answers a 1.1 caller now handles, the new options and their defaults, and which middleware keeps each refusal are in the changelog's [Upgrading from 1.1](https://github.com/openbtps/btps-node/blob/release/1.2/CHANGELOG.md#upgrading-from-11).

Every change is in the [changelog](https://github.com/openbtps/btps-node/blob/release/1.2/CHANGELOG.md). The rules in full are in the [specification](../protocol/specifications/overview.md).
