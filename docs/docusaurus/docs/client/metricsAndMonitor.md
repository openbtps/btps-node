---
title: Metrics & Monitoring
sidebar_label: Metrics & Monitoring
slug: metrics-and-monitoring
---

# BTPS Client Metrics & Monitoring

This guide explains how to monitor, track, and analyze BTPS Client SDK operations for reliability, performance, and troubleshooting.

## 1. What the SDK Gives You

The client SDK collects no metrics and logs nothing on its own: you choose what to measure and where it goes. It gives you three things to build on:

- **Results**: every `send()`, `transport()` and `command()` resolves with `{ response }` or `{ error }`, so one wrapper sees every outcome. (`transport()` can also throw when it cannot open a new connection, such as when `maxConnections` is reached.)
- **Events**: `BtpsClient` emits `connected`, `error`, `end`, `close` and `message`; `BtpsTransporter` emits the same per connection (`connectionConnected`, `connectionError`, ...), plus `connectionCreated`, `connectionUpdated` and `connectionDestroyed`.
- **Pool counts**: `transporter.getMetrics()` returns `{ totalConnections, activeConnections }`.

## 2. Measuring Sends

Wrap the call you make, and time it:

```js
const timedTransport = async (transporter, to, artifact) => {
  const started = performance.now();
  let result;
  try {
    result = await transporter.transport(to, artifact);
  } catch (error) {
    result = { error }; // no connection could be opened
  }
  const latencyMs = performance.now() - started;

  if (result.error) {
    metrics.increment('btps.send.error', { code: result.error.code });
  } else {
    metrics.observe('btps.send.latency_ms', latencyMs);
  }
  return result;
};
```

`metrics` is your own client: Prometheus, Datadog, CloudWatch or another.

## 3. Watching Connections

```js
transporter.on('connectionError', (connectionId, errorInfo) => {
  metrics.increment('btps.connection.error', {
    code: errorInfo.error.code,
    willRetry: String(errorInfo.willRetry),
  });
});

transporter.on('connectionDestroyed', () => {
  metrics.increment('btps.connection.destroyed');
});

setInterval(() => {
  const { totalConnections, activeConnections } = transporter.getMetrics();
  metrics.gauge('btps.pool.total', totalConnections);
  metrics.gauge('btps.pool.active', activeConnections);
}, 15000);
```

## 4. Best Practices for Observability

- Always track both successes and failures
- Tag errors by `error.code`, never by message text
- Use the artifact `id` to correlate a send across your logs and the receiver's answer
- Avoid logging documents, keys or tokens
- Set up alerts for error spikes or high latency; a reply near `replyTimeoutMs` (20 s by default) means the receiver is struggling

## 5. Troubleshooting Monitoring Issues

- If a counter never moves, check that every send goes through your wrapper
- Register event listeners before the first send, so the first connection is seen
- Validate that your monitoring backend is reachable

---

For more, see [Debugging](/docs/client/debugging) or [Best Practices](/docs/client/best-practices).
