---
title: Prerequisites
sidebar_label: Prerequisites
---

# Prerequisites

Before setting up your BTPS server, you'll need to ensure your development environment meets the requirements and understand the fundamental concepts of the BTPS protocol.

## System Requirements

### Node.js Version

BTPS requires **Node.js 16 or higher** with ES module support.

```bash
# Check your Node.js version
node --version

# If you need to install or update Node.js, use nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20.11.1
nvm use 20.11.1
```

### Package Manager

The BTPS SDK uses ES modules, so ensure your `package.json` includes:

```json
{
  "type": "module"
}
```

## Cryptographic Key Generation

BTPS uses RSA key pairs for signing and encrypting messages. You'll need to generate keys for your server identity.

### Generate Key Pair

Use the BTPS SDK's built-in key generation utility:

```bash
# Install the BTPS SDK
npm install @btps/sdk

# Generate keys for your server identity
npx @btps/sdk generate-keys your-server-identity
```

Or programmatically:

```typescript
import { getBTPKeyPair, generateKeys } from '@btps/sdk/crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Method 1: Generate keys with automatic file creation
await generateKeys('your-server-identity');
// Creates: keys/your-server-identity/your-server-identity-private.pem
// Creates: keys/your-server-identity/your-server-identity-public.pem

// Method 2: Generate keys programmatically
const keyPair = getBTPKeyPair({
  keySize: 2048, // Default RSA key size
  format: 'pem',
  publicKeyEncoding: 'spki',
  privateKeyEncoding: 'pkcs8',
});

// Create keys directory
const keysDir = join(process.cwd(), 'keys');
mkdirSync(keysDir, { recursive: true });

// Save keys to files
writeFileSync(join(keysDir, 'private.pem'), keyPair.privateKey);
writeFileSync(join(keysDir, 'public.pem'), keyPair.publicKey);

console.log('✅ Keys generated successfully');
console.log('Public Key Fingerprint:', keyPair.fingerprint);
```

### Key Security

- **Private Key**: Keep your private key secure and never share it
- **Public Key**: Will be published in DNS TXT records for verification
- **Backup**: Store keys securely and create backups

## DNS TXT Identity Record Setup

BTPS uses DNS TXT records to publish public keys and server information. This enables decentralized identity verification.

### DNS Record Format

For an identity like `billing$yourdomain.com`, create a DNS TXT record at:

Name:

```
btps1._btps.identity.billing.yourdomain.com
```

### Record Content

Value:

The TXT record should contain key-value pairs separated by semicolons:

```
k=rsa;v=1.0.0;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...
```

**Parameters:**

- `k`: key type (for key signature and encryption eg: rsa)
- `v`: BTPS protocol version (currently "1.0.0")
- `p`: Base64-encoded public key (without PEM headers)

## DNS TXT Host and Selector Record

BTPS uses DNS TXT records to discover the btps server host and selector currently active in operation.

### DNS Record Format

For an static record to resolve the host and selector address, create a DNS TXT record at:

Name:

```
_btps.host.yourdomain.com
```

### Record Content

Value:

The TXT record should contain key-value pairs separated by semicolons:

```
v=1.0.0;u=btps://btps.yourdomain.com:3443;s=btps1
```

**Parameters:**

- `u`: btps server host running address followed by port. If port is not present default 3443 will be used
- `v`: BTPS protocol version (currently "1.0.0")
- `s`: selector. This is for key rotation feature. This is required

### Generate DNS Record

```typescript
import { pemToBase64 } from '@btps/sdk';
import { readFileSync } from 'fs';

// Read your public key
const publicKey = readFileSync('./keys/public.pem', 'utf8');

// Convert to base64 (removes PEM headers)
const base64Key = pemToBase64(publicKey);

// Create DNS record content
const dnsRecord = `k=rsa;v=1.0.0;p=${base64Key}`;

console.log('DNS TXT Record for: btps1._btps.billing.yourdomain.com');
console.log('Content:', dnsRecord);
```

### Verify DNS Setup

Test your DNS configuration:

```typescript
import { getHostAndSelector, getDnsIdentityParts } from '@btps/sdk';

// Test host and selector resolution
const hostInfo = await getHostAndSelector('billing$yourdomain.com');
console.log('Host Info:', hostInfo);
// Output: { version: '1.0.0', host: 'btps://btps.yourdomain.com:3443', selector: 'btps1' }

// Test public key resolution
const publicKey = await getDnsIdentityParts('billing$yourdomain.com', 'btps1', 'pem');
console.log('Resolved Public Key:', publicKey);
```

## Identity Format

BTPS identities follow the format: `account$domain.com`

**Examples:**

- `billing$company.com` - Billing department
- `finance$enterprise.org` - Finance department
- `hr$startup.io` - Human resources

**Rules:**

- Account name: lowercase letters, numbers, hyphens
- Domain: valid domain name
- Separator: `$` character

## TLS Certificate (Optional)

For production deployments, you'll need TLS certificates for secure communication:

```bash
# Generate self-signed certificate for development
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# For production, use Let's Encrypt or your CA
```

## Next Steps

With these prerequisites in place, you're ready to:

1. **[Setup Basic Server](./setup.md)** - Create your first BTPS server
2. **[Configure Data Storage](./dataStorageSupport.md)** - Set up trust record storage
3. **[Add Authentication](./authenticationSupport.md)** - Implement identity verification

## Troubleshooting

### Common Issues

**Node.js Version Too Old**

```bash
# Error: SyntaxError: Unexpected token 'export'
# Solution: Update to Node.js 20.11.1+
```

**DNS Resolution Fails**

```bash
# Check if DNS record is published
dig TXT btps1._btps.identity.billing.yourdomain.com

# Verify record format
nslookup -type=TXT btps1._btps.identity.billing.yourdomain.com

# Test with BTPS SDK
import { getHostAndSelector } from '@btps/sdk';
const hostInfo = await getHostAndSelector('billing$yourdomain.com');
console.log('Host Info:', hostInfo);
```

**Key Generation Fails**

```bash
# Ensure you have write permissions
chmod 755 keys/

# Check key format
openssl rsa -in keys/private.pem -check
```
