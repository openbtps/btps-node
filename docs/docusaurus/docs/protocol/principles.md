---
id: principles
title: BTPS Principles
sidebar_label: Principles
---

# 🛰️ BTPS Principles

Design with **freedom by default**, and **monetize by value** — not control!

## 🎯 Purpose

BTPS is a federated, secure message transport protocol designed for verifiable document delivery (e.g. invoices, payslips, statements) between identities, using cryptographic signatures and DNS-based identity verification.

---

## 🧭 Core Principles

| Principle                                        | Description                                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 🔐 **Sovereignty-first**                         | Users own their keys, identities, and can operate independently without central gatekeepers.                                              |
| 🏗 **Minimal protocol, maximum extensibility**   | BTPS enforces only identity, integrity, and delivery. All business logic (e.g. quotas, features, limits) lives outside the core protocol. |
| 🌐 **Federated by design**                       | Any server can host identities. No single platform or vendor is privileged.                                                               |
| 💸 **SaaS monetization supported, not required** | SaaS providers can add delegation tools, dashboards, storage, and value-added services to monetize — but are never required for delivery. |
| ⚙️ **Offline and resilient**                     | Messages are verifiable and deliverable for end to end encryption users even if SaaS platforms are temporarily unavailable.               |
| 🧾 **Verifiable, not enforceable**               | Delegation artifacts encode signed claims, but do not require runtime validation by any third party.                                      |

---

## 👥 Key Roles

| Role              | Responsibilities                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **User (Sender)** | Owns identity, signs messages, can self-host or delegate keys to device/apps.                                                                 |
| **BTPS Client**   | Creates, signs, and sends messages (may run on phone, desktop, SaaS backend).                                                                 |
| **BTPS Server**   | Receives messages, verifies sender's signature and trust chain, delivers to inbox or webhook.                                                 |
| **SaaS Platform** | Manages user onboarding, key delegation, message analytics, dashboards, premium features.                                                     |
| **DNS Provider**  | Hosts identity records: `TXT` records with public keys, and each domain's host, selector and operator (`op=`), who alone may delegate for it. |

---

## 💸 SaaS Monetization Possibilities

| Feature                                | Enforced by Protocol?                                | Enforced by SaaS?                          |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| Which document types a sender may send | ✅ Yes, since 1.2: trust permissions (`send:<type>`) | —                                          |
| Delegation limits per device           | ❌ No                                                | ✅ Yes: the SaaS decides what it delegates |
| Monthly send quotas                    | ❌ No                                                | ✅ Client-side / dashboard                 |
| Advanced templates or analytics        | ❌ No                                                | ✅ API & frontend                          |
| Device revocation / approval flows     | ❌ No                                                | ✅ SaaS tooling                            |
| Long-term storage / inbox UX           | ❌ No                                                | ✅ Optional                                |

---

## 🔄 Protocol Flow Summary

1. **Sender signs and encrypts message**
2. **Receiver resolves sender identity via DNS**, and since 1.2 checks the key against the sender's key chain
3. **Receiver server verifies signature, delegation and trust** (and, since 1.2, the trust's permissions)
4. **Receiver delivers message to inbox or webhook**

---

## ✅ Takeaway

BTPS empowers both:

- 🧍 Individual users with full cryptographic autonomy
- 🏢 SaaS platforms with monetizable infrastructure roles
