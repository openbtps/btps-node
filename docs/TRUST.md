# BTPS Trust Model & Onboarding

## Overview

BTPS uses a robust, DNS-based trust model to ensure only authorized senders can deliver billing/invoice messages. Trust is managed via DNS TXT records, local trust stores, and proof-based key rotation.

---

## Trust Model

- Trust is established per sender domain (e.g., `vendorcorp.com`)
- Trust records (`trust.json`) store trusted senders, keys, and rotation history
- Trust can be locked (immutable) or dynamic (DNS-based)

---

## Onboarding a New Sender

1. Sender publishes a DNS TXT record with their public key and inbox URL
2. Receiver resolves and verifies the sender's DNS record
3. Receiver adds sender to their trust store (`trust.json`)
4. Optionally, require manual approval or proof-based onboarding

---

## Key Rotation

- Use DNS selectors for seamless key rotation
- Proof-based rotation via `.well-known/btp-key-rotation.json`
- Rotation history is tracked in `trust.json`

---

## Security Considerations

- Use strong keys (RSA-2048+, Ed25519)
- Enable DNSSEC for integrity
- Use HTTPS for inbox endpoints
- Monitor and audit trust changes

---

## TODO

- Add code samples for onboarding and trust management
- Add diagrams for trust establishment and key rotation
- Add advanced trust policies and revocation examples
