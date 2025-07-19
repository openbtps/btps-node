---
title: Prerequisites
sidebar_label: Prerequisites
---

# Prerequisites

Before setting up your BTPS server, you'll need to ensure your development environment meets the requirements and understand the fundamental concepts of the BTPS protocol.

## System Requirements

### Node.js Version

BTPS requires **Node.js 20.11.1 or higher** with ES module support.

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
import { getBTPKeyPair } from '@btps/sdk/crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Generate RSA key pair
const keyPair = getBTPKeyPair({
  keySize: 2048, // Default RSA key size
  format: 'pem',
  publicKeyEncoding: 'spki',
  privateKeyEncoding: 'pkcs8'
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

## DNS TXT Record Setup

BTPS uses DNS TXT records to publish public keys and server information. This enables decentralized identity verification.

### DNS Record Format

For an identity like `billing$yourdomain.com`, create a DNS TXT record at:

```
btp1._btp.billing.yourdomain.com
```

### Record Content

The TXT record should contain key-value pairs separated by semicolons:

```
k=yourdomain.com;v=1.0.0;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...;u=btps://yourdomain.com:3443
```

**Parameters:**
- `k`: Your domain name (for key verification)
- `v`: BTPS protocol version (currently "1.0.0")
- `p`: Base64-encoded public key (without PEM headers)
- `u`: BTPS server address (optional, for direct connections)

### Generate DNS Record

```typescript
import { pemToBase64 } from '@btps/sdk/utils';
import { readFileSync } from 'fs';

// Read your public key
const publicKey = readFileSync('./keys/public.pem', 'utf8');

// Convert to base64 (removes PEM headers)
const base64Key = pemToBase64(publicKey);

// Create DNS record content
const dnsRecord = `k=yourdomain.com;v=1.0.0;p=${base64Key};u=btps://yourdomain.com:3443`;

console.log('DNS TXT Record for: btp1._btp.billing.yourdomain.com');
console.log('Content:', dnsRecord);
```

### Verify DNS Setup

Test your DNS configuration:

```typescript
import { getDnsParts } from '@btps/sdk/utils';

// Test DNS resolution
const dnsInfo = await getDnsParts('billing$yourdomain.com');
console.log('DNS Info:', dnsInfo);

// Test public key resolution
const publicKey = await getDnsParts('billing$yourdomain.com', 'pem');
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
dig TXT btp1._btp.billing.yourdomain.com

# Verify record format
nslookup -type=TXT btp1._btp.billing.yourdomain.com
```

**Key Generation Fails**
```bash
# Ensure you have write permissions
chmod 755 keys/

# Check key format
openssl rsa -in keys/private.pem -check
```
