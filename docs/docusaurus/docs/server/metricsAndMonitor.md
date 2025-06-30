---
title: Metrics & Monitoring
description: Visibility, observability, and advanced logging for BTPS Server deployments.
sidebar_label: Metrics & Monitoring
---

# Metrics & Monitoring in BTPS Server

Effective metrics and Monitoring are essential for:
- **Visibility:** Understanding system health and message flow
- **Debugging:** Diagnosing issues and tracking errors
- **Compliance:** Meeting audit and regulatory requirements
- **Security:** Detecting anomalies and abuse

## Basic Metrics: BtpsSimpleMetricsTracker

The SDK provides a simple, console-based metrics tracker for quick setup and development:

```js
import { BtpsSimpleMetricsTracker } from 'btps-sdk';

const metrics = new BtpsSimpleMetricsTracker();

metrics.onMessageReceived('sender$domain.com', 'recipient$domain.com');
metrics.onMessageRejected('sender$domain.com', 'recipient$domain.com', 'Rate limit exceeded');
metrics.onError(new Error('Something went wrong'));
```

**What it does:**
- Logs received messages, rejections, and errors to the console.
- Useful for local development, testing, and small-scale deployments.

**Source:** See [`btpsSimpleMetricsTracker.ts`](../../src/server/libs/btpsSimpleMetricsTracker.ts)

## Advanced Metrics: Custom IMetricsTracker

For production, you should implement a custom metrics tracker by extending the `IMetricsTracker` interface. This allows you to:
- Send metrics to Prometheus, Datadog, or other observability platforms
- Integrate with cloud logging (AWS CloudWatch, GCP Logging, Azure Monitor)
- Push logs to ELK, Loki, or SIEM systems
- Trigger alerts on errors or suspicious activity

**Example: Prometheus Metrics Tracker**

```js
import { IMetricsTracker } from 'btps-sdk';
import client from 'prom-client';

class PrometheusMetricsTracker implements IMetricsTracker {
  constructor() {
    this.receivedCounter = new client.Counter({
      name: 'btps_messages_received_total',
      help: 'Total BTPS messages received',
      labelNames: ['sender', 'recipient'],
    });
    this.rejectedCounter = new client.Counter({
      name: 'btps_messages_rejected_total',
      help: 'Total BTPS messages rejected',
      labelNames: ['sender', 'recipient', 'reason'],
    });
    this.errorCounter = new client.Counter({
      name: 'btps_errors_total',
      help: 'Total BTPS errors',
    });
  }
  onMessageReceived(sender, recipient) {
    this.receivedCounter.inc({ sender, recipient });
  }
  onMessageRejected(sender, recipient, reason) {
    this.rejectedCounter.inc({ sender, recipient, reason });
  }
  onError(error) {
    this.errorCounter.inc();
    // Optionally log error details
  }
}
```

**Plugging in your tracker:**
- Pass your metrics tracker to middleware or server hooks.
- Replace the default tracker in your custom middleware:

```js
const metrics = new PrometheusMetricsTracker();

export default [
  {
    phase: 'after',
    step: 'onMessage',
    handler: async (req, res, next) => {
      metrics.onMessageReceived(req.from, req.artifact.to);
      await next();
    },
  },
  // ...other middleware
];
```

## Advanced Logging Patterns

- **Structured Logging:** Use JSON logs for easy parsing and ingestion by log management systems.
- **Distributed Logging:** Forward logs to a central system (e.g., ELK, Loki, cloud logging) for aggregation and search.
- **Log Levels:** Use levels (info, warn, error, debug) to control verbosity.
- **Correlation IDs:** Add request IDs to logs for tracing message flow across services.
- **Alerting:** Integrate with alerting systems to notify on errors, spikes, or suspicious activity.
- **Audit Logging:** Log all trust changes, message deliveries, and errors for compliance.

## Best Practices for Production

- **Use external metrics/logging for scale:** Avoid in-memory or console-only logging in production.
- **Rotate and archive logs:** Use log rotation and retention policies to manage disk usage.
- **Protect sensitive data:** Mask or redact PII and secrets in logs.
- **Monitor and alert:** Set up dashboards and alerts for key metrics and errors.
- **Test logging/metrics in staging:** Validate your observability setup before going live.

## Where to Plug In Metrics & Logging

- **Middleware:** Track message flow, rejections, and errors at each phase.
- **Server lifecycle hooks:** Log server start/stop, health checks, and resource usage.
- **Custom handlers:** Add logging to business logic, webhooks, and integrations.

---

For more, see [Middleware System](./middlewares.md) and [Debugging](./debugging.md).
