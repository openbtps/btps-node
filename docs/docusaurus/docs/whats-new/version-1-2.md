---
title: What's new in 1.2
sidebar_label: 1.2
slug: /whats-new/1-2
---

# What's new in 1.2

BTPS 1.2 is the beta: the wire settles, and changes after it should only add, not break. A 1.2 provider talks to every 1.1 provider, and nothing a 1.1 provider sends changes. Each feature below has its own guide, with its flow, its artifacts, code for both sides, and its errors.

:::tip Upgrading from 1.1?

Start with [Migrating from 1.1 to 1.2](./version-1-2-migration.md): what changes for you, the steps in a safe order with rollback at each, and the order to adopt each feature in.

:::

**[Trust permissions](../features/trustPermissions.md).** A trust request lists what it asks for, `send:` and `detail:` names, each required or optional. The receiver grants all of it or part of it, and either side can change it later. A trust is no longer all or nothing.

**[Document types on sends](../features/documentTypes.md).** Under a trust with permissions, every send names its `documentType` on the envelope, and the receiving server takes only the types the trust grants, without opening the document.

**[Details refresh](../features/detailsRefresh.md).** Each side is told when the other's details change, and fetches again only the details it already holds by the trust, instead of sending a new trust request.

**[Verification](../features/verification.md).** A provider signs what it checked of a sender, and the sender's trust request carries it. The receiver gets the facts and decides whose verifications it trusts; BTPS verifies no one.

**[Agreements](../features/agreements.md).** A new document type that asks to be accepted, such as a contract or a phone plan, signed by each signer in turn or in any order.

**[Evidence bundles and timestamps](../features/evidenceBundles.md).** One file that proves an agreement offline, with optional RFC 3161 timestamps and the signers' key chains, made and checked from code or the command line.

**[Key rotation](../features/keyRotation.md).** An identity's keys form a signed chain its host serves, and every server checks each arriving key against it: a key rotated away is taken for a day's grace, a compromised one is refused at once, whatever DNS still has. Old keys can be retired and deleted, and what they signed stays verifiable.

**[Withdrawing proposals](../features/withdrawingProposals.md).** A payer takes back an unanswered proposal (`paid`, `disputed`, …) and may propose again later, with the chain kept traceable.

**[Devices](../features/devices.md).** A device's own key to its documents, signed answers it can require from its provider, sync between a user's devices, and each send's delivery.

**[Refresh tokens](../features/refreshTokens.md).** A token used twice revokes the device; a lost answer can be retried within a grace window; a racing refresh is told to wait; keys can be rotated with a proof.

**[Notes, discounts and templates](../features/notesDiscountsTemplates.md).** Notes with a format, discounts before tax, templates by reference, payslip and letter templates, and signature slots.

**[Protocol versions](../features/versions.md).** How 1.1 and 1.2 talk: each artifact stamped with the lowest version that can say it, version refusals, trust requests shaped for a 1.1 receiver, and the closing signal.

**[Your platform's checks](../features/platformChecks.md).** What the server checks and what is the platform's: four middleware and their plain functions, what a sender is told of an error, the server's limits, and key caching.

## Upgrading from 1.1

A 1.1 provider upgrades without changing what it sends. What changes in the trust and token stores, which answers a 1.1 caller now handles, which middleware to register, and the order to adopt each feature in: [Migrating from 1.1 to 1.2](./version-1-2-migration.md).

Every change is in the [changelog](https://github.com/openbtps/btps-node/blob/release/1.2/CHANGELOG.md). The rules in full are in the [specification](../protocol/specifications/overview.md).
