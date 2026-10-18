---
title: Delegation Revocation
sidebar_label: Revocation
---

# BTPS Delegation Revocation

BTPS delegation revocation provides real-time control over device access by removing the device's record at its provider. This ensures immediate security when devices are lost, compromised, or no longer needed.

## 🎯 Purpose

Delegation revocation addresses critical security needs:

- **Device Loss**: Immediately revoke access when devices are lost or stolen
- **Security Breach**: Remove compromised device access
- **Access Control**: Manage device permissions and access lifecycle
- **Compliance**: Meet regulatory requirements for access termination

## Revocation process

Revocation process differs slightly based on the type of users that is fully managed vs partially managed users such as E2E users

### 🔄 Revocation Flow Overview (Fully managed Users)

**Users under SaaS domain**:

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant BTPS Server
    participant Device Agent

    User->>SaaS Portal: Revoke Device Agent
    SaaS Portal->>SaaS Portal: Validate User Permissions
    SaaS Portal->>SaaS Portal: Remove the device record and its refresh token
    Device Agent->>BTPS Server: Any later message or refresh
    BTPS Server-->>Device Agent: Refused: BTP_ERROR_SIG_VERIFICATION (device unknown)
```

If the portal keeps the record but marks it revoked or lets it expire, the refusal is `BTP_ERROR_TRUST_NOT_ALLOWED` instead.

### Process Flow (Fully Managed Users)

The revocation process for fully managed users follows these steps:

1. **User Initiation**: The user initiates device revocation through the SaaS portal interface, selecting the specific device agent to revoke.

2. **Permission Validation**: The SaaS portal validates the user's permissions to ensure they have the authority to revoke the specified device agent. This includes checking user roles, ownership of the device, and any organizational policies.

3. **Device Removal**: Upon successful permission validation, the SaaS portal removes the device agent from the system. This includes:
   - Removing the device from the user's device list
   - Revoking any active authentication tokens
   - Updating internal delegation records
   - Clearing device-specific permissions

4. **Message Rejection**: If the revoked device attempts to send messages after revocation, the BTPS server will reject these messages due to the device no longer being authorized in the system.

This process provides immediate security control for SaaS-managed users, where all delegation records are centrally managed through the SaaS portal.

### 🔄 Revocation Flow Overview (Partially managed Users)

This flow applies for these users. A device has no DNS record of its own: it is a record at the SaaS, and its key travels inside each delegation. Revoking one device is therefore always done at the SaaS portal, which removes the device record and its refresh token. Changing DNS (the domain's `op=` operator, or the identity's key) stops every delegated send for that identity, from every device, so use it only to cut the SaaS off entirely.

- Users with Custom domain with Keys managed by SaaS
- E2E Users who manages their own Key with Custom domain and only inbox managed by SaaS

```mermaid
sequenceDiagram
    participant User
    participant SaaS Portal
    participant DNS
    participant BTPS Server
    participant Device Agent

    User->>SaaS Portal: Revoke Device Agent
    SaaS Portal->>SaaS Portal: Validate User Permissions
    SaaS Portal->>SaaS Portal: Remove the device record and its refresh token
    Device Agent->>BTPS Server: Any later message or refresh
    BTPS Server-->>Device Agent: Refused: BTP_ERROR_SIG_VERIFICATION (device unknown)
    opt Cut the SaaS off entirely
        User->>DNS: Remove the SaaS as op= operator, or change the identity's key
        Note over DNS,BTPS Server: Every delegated send for the identity now fails at receivers
    end
```

### Process Flow (Partially Managed Users)

The revocation process for partially managed users (such as those with custom domains or E2E users) follows these steps:

1. **SaaS Portal Revocation**: The user initiates device revocation through the SaaS portal, so that the device's record and refresh token are removed. Without this, the device can still authenticate and read messages until its record expires.

2. **Permission Validation**: The SaaS portal validates the user's permissions to perform the revocation, checking roles and device ownership as needed.

3. **Device Removal**: The SaaS portal removes the device agent from its records, revokes tokens, and updates any internal delegation or access lists.

4. **Message Rejection**: If the revoked device attempts to send messages after these steps, the BTPS server refuses them, because it no longer has a record for the device.

5. **Optional, DNS**: To stop the SaaS sending for the identity at all, remove it as the domain's `op=` operator or change the identity's key. This affects every device, not one.

This keeps per-device revocation at the SaaS, where the device records live, and DNS for the domain-wide decision of who may send on the identity's behalf.

## 🛡️ Security Best Practices

### **Revocation Policies**

1. **Immediate Action**: Revoke devices immediately upon security incident
2. **Regular Review**: Periodically review and clean up unused delegations
3. **Audit Logging**: Log all revocation actions with timestamps and reasons
4. **User Notification**: Notify users of device revocations via email/SMS
5. **Recovery Procedures**: Provide clear re-authentication instructions

### **DNS Security**

1. **Low TTL**: Use short TTL (60-300 seconds) for fast revocation propagation
2. **Monitoring**: Monitor DNS propagation and alert on failures
3. **Backup Records**: Maintain backup of delegation records for recovery

### **Client Security**

1. **Token Validation**: Regularly validate access tokens
2. **Revocation Detection**: Implement revocation detection in clients
3. **Secure Storage**: Store credentials securely with encryption
4. **Auto-Cleanup**: Clear credentials when revocation detected
