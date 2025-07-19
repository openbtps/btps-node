---
title: Debugging & Troubleshooting
description: Troubleshooting, diagnostics, and operational best practices for the BTPS Server SDK.
sidebar_label: Debugging
---

# Debugging & Troubleshooting

This guide helps you diagnose, debug, and resolve common issues with the BTPS Server SDK. It covers error codes, health checks, logging, and operational best practices for production environments.

## Common Issues & Solutions

### 1. Server Fails to Start
- **Check:** Port is in use, or TLS cert/key is missing or invalid.
- **Solution:**
  - Ensure the port is free (`lsof -i :3443`).
  - Double-check your TLS certificate and key paths.
  - Review error logs for stack traces.

### 2. Middleware Not Loaded
- **Check:** Wrong `middlewarePath` or missing `btps.middleware.mjs` in root.
- **Solution:**
  - Confirm the middleware file exists at the expected path.
  - If using a custom path, set `middlewarePath` in the server options.

### 3. Trust Store Errors
- **Check:** File/database permissions, connection string, or schema issues.
- **Solution:**
  - Ensure the process has read/write access to the trust store backend.
  - For file-based stores, check file path and permissions.
  - For DB stores, verify connection string and table/collection names.

### 4. TLS/Certificate Errors
- **Check:** Invalid, expired, or misconfigured certificates.
- **Solution:**
  - Use valid, non-expired certificates.
  - Set correct `cert` and `key` in the `options` object.
  - Use tools like `openssl` to verify certificate files.

### 5. Rate Limiting or Blocking Unexpected
- **Check:** Middleware logic or rate limiter configuration.
- **Solution:**
  - Review your rate limiting middleware for correct keying and limits.
  - Log rate limit events for debugging.

### 6. Messages Not Processed or Forwarded
- **Check:** No handler registered, or error in middleware.
- **Solution:**
  - Ensure you use `server.onMessage()` or `server.forwardTo()`/`forwardToWebhook()`.
  - Check middleware for early `res.sendError()` calls.

### 7. High Latency or Resource Usage
- **Check:** Blocking operations in middleware, slow trust store queries, or synchronous file I/O.
- **Solution:**
  - Avoid blocking/synchronous code in middleware.
  - Use indexes and efficient queries in your trust store.
  - Monitor server resource usage and scale horizontally if needed.

## Diagnostics & Health Checks

- **Enable verbose logging** in your middleware and error handlers.
- **Test middleware in isolation** to catch logic errors early.
- **Use health checks** to monitor server readiness and liveness.
- **Check server logs** for stack traces and error details.
- **Use tools like `curl` or `openssl s_client`** to test TLS and connectivity.

## Error Codes

| Code | Meaning                  |
|------|--------------------------|
| 400  | Malformed request        |
| 401  | Signature verification   |
| 403  | Trust not allowed        |
| 429  | Rate limited             |
| 500  | Internal server error    |

## FAQ

**Q: How do I debug middleware execution?**
- Add logging to each handler and use the `onError` phase for error tracing.

**Q: How do I check if the server is healthy?**
- Add a health check endpoint via middleware or use a sidecar process.

**Q: How do I see why a message was rejected?**
- Check logs for error codes and messages. Use `onError` middleware for detailed diagnostics.

**Q: How do I rotate TLS certificates without downtime?**
- Use a process manager (e.g., systemd, PM2) and reload the server with new certs.

## Operational Best Practices

- **Monitor logs and metrics** for errors and performance.
- **Automate health checks** and integrate with your orchestrator.
- **Backup trust store data** regularly.
- **Test failover and recovery** procedures.
- **Keep SDK and dependencies up to date.**

---

For more, see [Server Overview](/docs/server/overview) and [Security Best Practices](/docs/protocol/security/best-practices).
