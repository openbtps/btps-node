# BTPS Trust Model & Onboarding

## Overview

The BTPS protocol uses a trust system to make sure that only approved and verified senders can deliver important business documents (like invoices or bills) to your company.  
This trust system is designed to be secure, easy to manage, and flexible for both small businesses and large enterprises.

---

## What is "Trust" in BTPS?

- **Trust** means you have decided to accept documents from a specific sender (like a supplier, partner, or customer).
- You can think of it like a "safe senders" list for your business documents.
- Only senders on your trust list can deliver documents to you through BTPS.

---

## How is Trust Established?

1. **Sender Identity:**  
   Every sender has a unique BTPS identity (like `billing@vendorcorp.com`).
2. **Public Key:**  
   The sender publishes a public key (like a digital signature) in their DNS records. This key proves their identity.
3. **Trust Request:**  
   When a sender wants to connect, they send a trust request to you (the receiver).
4. **Verification:**  
   Your BTPS server checks the sender's DNS record and public key to make sure they are who they say they are.
5. **Approval:**  
   You (or your system) can approve, reject, or block the sender. If approved, they are added to your trust list.

---

## Where is Trust Stored?

- **Trust Store:**  
  Your BTPS server keeps a list of trusted senders in a "trust store." This can be a simple file (`trust.json`) or a database for larger companies.
- **DNS Records:**  
  The sender's public key and inbox address are published in DNS, so you can always verify their identity.

---

## What Happens After Trust is Established?

- Once a sender is trusted, they can send you business documents securely.
- If you ever want to stop receiving from a sender, you can remove or block them in your trust store.

---

## How Does Key Rotation Work?

- **Key rotation** means changing the sender's public key (for security or staff changes).
- The sender updates their DNS record with a new key.
- Your server will automatically detect and verify the new key the next time the sender connects.

---

## Security Features

- **Strong Encryption:**  
  All messages are encrypted and signed, so only the intended recipient can read them.
- **DNSSEC Support:**  
  If you use DNSSEC, it's even harder for attackers to fake sender identities.
- **Audit Trail:**  
  All trust changes (add, remove, block) are logged for security and compliance.

---

## Typical Trust Lifecycle

1. **Onboarding:**  
   Sender requests trust, you approve.
2. **Active:**  
   Sender can send documents.
3. **Key Rotation:**  
   Sender updates their key, you verify automatically.
4. **Revocation:**  
   You can remove or block a sender at any time.

---

## Why is This Important?

- **Prevents fraud:** Only approved senders can deliver documents.
- **Reduces spam:** No more unwanted or fake invoices.
- **Easy to manage:** You control who can send to you, and can automate approvals if you want.

---

## Trust Establishment Flow (Diagram)

```
+-------------------+         1. Trust Request         +-------------------+
|   Sender Company  |  ----------------------------->  |   Receiver Company|
| (billing@vendor)  |                                  |  (your business)  |
+-------------------+                                  +-------------------+
         |                                                      |
         | 2. Receiver checks sender's DNS record & public key   |
         |----------------------------------------------------->|
         |                                                      |
         | 3. Receiver approves, rejects, or blocks sender      |
         |<-----------------------------------------------------|
         |                                                      |
         | 4. If approved, sender is added to trust list        |
         |<-----------------------------------------------------|
         |                                                      |
         | 5. Sender can now send business documents securely   |
         |----------------------------------------------------->|
```

**Legend:**

- **Trust Request:** Sender asks to be trusted.
- **DNS Check:** Receiver verifies sender's identity using DNS.
- **Approval:** Receiver decides to trust, reject, or block.
- **Trust List:** Approved senders are added to the receiver's trust store.
- **Secure Delivery:** Only trusted senders can deliver documents.

---
