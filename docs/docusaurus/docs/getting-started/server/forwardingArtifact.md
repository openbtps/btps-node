---
title: Forwarding Artifacts
description: Forward processed artifacts to external systems, webhooks, or different applications for flexible processing.
sidebar_label: Forwarding Artifacts
slug: forwarding-artifacts
---

# Forwarding Artifacts

BTPS server provides a forwarding mechanism that allows you to send processed artifacts to external systems, webhooks, or different applications. This gives you flexibility to keep processing logic separate from the BTPS server.

## Understanding Artifact Forwarding

Artifact forwarding provides:

- **External Processing**: Send artifacts to different systems for processing
- **Webhook Integration**: Trigger webhook endpoints with processed artifacts
- **Microservice Architecture**: Keep processing logic in separate applications
- **Flexible Infrastructure**: Adapt to your existing system architecture

## How Forwarding Works

The BtpsServer automatically forwards all processed artifacts (after verification) to a handler function you specify. This happens after:

1. **Artifact Parsing**: JSON parsing and validation
2. **Signature Verification**: Cryptographic signature verification
3. **Trust Verification**: Trust relationship verification
4. **Event Emission**: Agent/Transporter event handlers
5. **Artifact Forwarding**: Forward to your handler function

## Setting Up Artifact Forwarding

### Step 1: Configure Forwarding Handler

```typescript
// src/index.ts
import { BtpsServer } from '@btps/sdk/server';
import { JsonTrustStore } from '@btps/sdk/trust';

const server = new BtpsServer({
  port: 3443,
  trustStore: new JsonTrustStore({
    connection: './trust.json',
    entityName: 'trusted_senders',
  }),
  middlewarePath: './btps.middleware.mjs',
});

// Set up forwarding handler
server.forwardTo(async (processedArtifact) => {
  // Handle the processed artifact
  await handleProcessedArtifact(processedArtifact);
});
```

### Step 2: Implement Forwarding Handler

```typescript
// Handle processed artifacts
async function handleProcessedArtifact(processedArtifact) {
  const { artifact, isAgentArtifact } = processedArtifact;

  try {
    if (isAgentArtifact) {
      // Handle agent artifacts
      await handleAgentArtifact(artifact);
    } else {
      // Handle transporter artifacts
      await handleTransporterArtifact(artifact);
    }
  } catch (error) {
    console.error('Error handling processed artifact:', error);
  }
}

// Handle agent artifacts
async function handleAgentArtifact(artifact) {
  console.log('Processing agent artifact:', artifact.id);

  // Forward to your processing system
  await forwardToProcessingSystem(artifact);

  // Or trigger webhook
  await triggerWebhook(artifact);
}

// Handle transporter artifacts
async function handleTransporterArtifact(artifact) {
  console.log('Processing transporter artifact:', artifact.id);

  // Forward to your processing system
  await forwardToProcessingSystem(artifact);
}
```

## Forwarding to External Systems

### Step 3: Forward to Processing System

```typescript
// Forward to internal processing system
async function forwardToProcessingSystem(artifact) {
  const { id, type, from, to, document } = artifact;

  // Example: Forward to internal API
  const response = await fetch('http://your-processing-api/artifacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.API_TOKEN}`,
    },
    body: JSON.stringify({
      artifactId: id,
      artifactType: type,
      from: from,
      to: to,
      document: document,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to forward artifact: ${response.statusText}`);
  }

  console.log('Artifact forwarded successfully:', id);
}
```

### Step 4: Trigger Webhooks

```typescript
// Trigger webhook endpoints
async function triggerWebhook(artifact) {
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': generateWebhookSignature(artifact),
      },
      body: JSON.stringify({
        event: 'artifact.processed',
        artifact: artifact,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('Webhook failed:', response.statusText);
    } else {
      console.log('Webhook triggered successfully');
    }
  } catch (error) {
    console.error('Webhook error:', error);
  }
}

// Generate webhook signature for security
function generateWebhookSignature(artifact) {
  const crypto = require('crypto');
  const secret = process.env.WEBHOOK_SECRET;
  const payload = JSON.stringify(artifact);

  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
```

## Forwarding to Message Queues

### Step 5: Queue for Processing

```typescript
// Forward to message queue
async function forwardToMessageQueue(artifact) {
  const { id, type } = artifact;

  // Example: Forward to Redis queue
  const redis = require('redis');
  const client = redis.createClient();

  await client.connect();

  try {
    await client.lPush(
      'btps-artifacts',
      JSON.stringify({
        id: id,
        type: type,
        artifact: artifact,
        timestamp: new Date().toISOString(),
      }),
    );

    console.log('Artifact queued successfully:', id);
  } finally {
    await client.disconnect();
  }
}

// Example: Forward to RabbitMQ
async function forwardToRabbitMQ(artifact) {
  const amqp = require('amqplib');

  const connection = await amqp.connect('amqp://localhost');
  const channel = await connection.createChannel();

  try {
    await channel.assertQueue('btps-artifacts', { durable: true });

    channel.sendToQueue('btps-artifacts', Buffer.from(JSON.stringify(artifact)), {
      persistent: true,
    });

    console.log('Artifact sent to RabbitMQ:', artifact.id);
  } finally {
    await connection.close();
  }
}
```

## Error Handling

### Step 6: Handle Forwarding Errors

```typescript
// Enhanced forwarding handler with error handling
server.forwardTo(async (processedArtifact) => {
  try {
    await handleProcessedArtifact(processedArtifact);
  } catch (error) {
    console.error('Forwarding error:', error);

    // Log error for monitoring
    await logForwardingError(processedArtifact, error);

    // Optionally retry or send to dead letter queue
    await handleForwardingFailure(processedArtifact, error);
  }
});

// Log forwarding errors
async function logForwardingError(artifact, error) {
  const errorLog = {
    artifactId: artifact.artifact.id,
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };

  // Log to your monitoring system
  console.error('Forwarding error log:', errorLog);
}

// Handle forwarding failures
async function handleForwardingFailure(artifact, error) {
  // Send to dead letter queue
  await sendToDeadLetterQueue(artifact, error);

  // Or retry with exponential backoff
  // await retryWithBackoff(artifact);
}
```

## Environment Configuration

### Environment Variables

```bash
# Forwarding Configuration
FORWARDING_ENABLED=true
PROCESSING_API_URL=http://your-processing-api/artifacts
API_TOKEN=your-api-token

# Webhook Configuration
WEBHOOK_URL=https://your-webhook-endpoint.com/webhook
WEBHOOK_SECRET=your-webhook-secret

# Message Queue Configuration
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://localhost

# Error Handling
DEAD_LETTER_QUEUE_ENABLED=true
RETRY_ATTEMPTS=3
```

## Testing Forwarding

### Test Forwarding Handler

```typescript
// Test forwarding with sample artifacts
const testAgentArtifact = {
  id: 'msg_123',
  type: 'BTPS_DOC',
  from: 'alice$saas.com',
  to: 'bob$client.com',
  document: {
    /* invoice data */
  },
  signature: {
    /* signature */
  },
};

const testTransporterArtifact = {
  id: 'msg_124',
  type: 'BTPS_DOC',
  from: 'alice$saas.com',
  to: 'bob$client.com',
  document: {
    /* invoice data */
  },
  signature: {
    /* signature */
  },
};

// Test the forwarding handler
await handleProcessedArtifact({
  artifact: testAgentArtifact,
  isAgentArtifact: true,
});

await handleProcessedArtifact({
  artifact: testTransporterArtifact,
  isAgentArtifact: false,
});
```

## Key Integration Points

### Forwarding Features

- **Automatic Forwarding**: All processed artifacts are automatically forwarded
- **Flexible Handlers**: Forward to any system or service
- **Error Handling**: Comprehensive error handling and retry mechanisms
- **Monitoring**: Log and monitor forwarding operations

### Forwarding Flow

1. **Artifact Processing**: Server processes and verifies artifact
2. **Event Handling**: Agent/Transporter event handlers execute
3. **Forwarding**: Artifact is forwarded to your handler function
4. **External Processing**: Your handler forwards to external systems
5. **Error Handling**: Handle any forwarding failures

## Next Steps

With artifact forwarding configured, you can now:

1. **[Add Transporter Support](./transporterSupport.md)** - Send artifacts to other parties
2. **[Add Authentication Support](./authenticationSupport.md)** - Handle user authentication
3. **[Add Delegation Support](./delegationSupport.md)** - Handle delegated artifacts

## See Also

- [Event Handlers](./eventHandlers.md)
- [Middleware Integration](./middlewares.md)
- [Server Setup](./setup.md)
