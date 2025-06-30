---
title: BTPS Protocol Best Practices
sidebar_label: Best practices
---

# BTPS Best Practices

Following security best practices is critical for maintaining the integrity and trust of the BTPS protocol. This section outlines recommendations and compliance considerations for encryption and verification.

## Best Practices & Compliance in BTPS

- **Key Rotation:** Rotate cryptographic keys regularly and update DNS/.well-known records promptly.
- **Private Key Protection:** Never share private keys; store them securely (e.g., HSM, encrypted disk).
- **Strong Algorithms:** Use only strong, industry-standard algorithms (e.g., AES-256-CBC, RSA-2048+, SHA-256).
- **Signature Verification:** Always verify digital signatures before processing any message.
- **Audit Logging:** Log all cryptographic operations and key management events for audit and compliance.
- **Access Control:** Restrict access to cryptographic material and key management interfaces.
- **Automate Where Possible:** Automate key rotation, revocation, and monitoring to reduce human error.

## Compliance Considerations

- **GDPR:** Ensure encryption of personal data in transit and at rest.
- **PCI DSS:** Use strong encryption for payment data and maintain audit trails.
- **SOX:** Maintain records of all key management and cryptographic operations.
- **ISO 27001:** Follow information security management best practices.

## Monitoring & Incident Response

- Monitor for unauthorized access or failed decryption/signature verification attempts.
- Have a clear incident response plan for key compromise or cryptographic failures.
- Notify affected parties promptly in the event of a breach.

> Adhering to these best practices ensures BTPS remains secure, trustworthy, and compliant with industry standards.
