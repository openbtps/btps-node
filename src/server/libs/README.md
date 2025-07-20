# Improved Middleware Type System

This document explains the enhanced TypeScript type system for BTPS middleware that provides compile-time guarantees about artifact availability based on middleware phase and step.

## Overview

The new type system uses conditional types to ensure that middleware handlers receive the correct context based on their execution phase and step. This eliminates the need for runtime checks and provides better developer experience.

## Type Guarantees

### Artifact Availability

The `artifact` property is:

- **Optional** (may be undefined) in:
  - `before` and `after` **parsing** middleware
- **Guaranteed to be present** in:
  - `before` and `after` **signatureVerification**
  - `before` and `after` **trustVerification**
  - `before` and `after` **onMessage**

**Summary:** Only in the parsing phase is `artifact` optional. In all other phases/steps, it is always defined.

### RawPacket Availability

The `rawPacket` property is guaranteed to be present (not undefined) in the following scenario:

- **Before parsing**: `MiddlewareHandler<'before', 'parsing'>`

### Validation Status Availability

- **`isValid`** is guaranteed after signature verification:

  - `MiddlewareHandler<'after', 'signatureVerification'>`
  - `MiddlewareHandler<'before', 'trustVerification'>`
  - `MiddlewareHandler<'after', 'trustVerification'>`
  - `MiddlewareHandler<'before', 'onMessage'>`
  - `MiddlewareHandler<'after', 'onMessage'>`

- **`isTrusted`** is guaranteed after trust verification:
  - `MiddlewareHandler<'after', 'trustVerification'>`
  - `MiddlewareHandler<'before', 'onMessage'>`
  - `MiddlewareHandler<'after', 'onMessage'>`

### Error Availability

- **`error`** is optional in all stages since errors can occur and be passed to middleware at any point:
  - After parsing errors
  - After signature verification errors
  - After trust verification errors
  - Message processing errors
  - General error handlers

**Important**: The `error` property is always optional (`BTPErrorException | undefined`) because errors can be passed to middleware at any stage of the processing pipeline.

## Usage Examples

### 1. Before Parsing (RawPacket Only)

```typescript
const beforeParsingHandler: MiddlewareHandler<'before', 'parsing'> = (
  req, // req.rawPacket is guaranteed to be string, req.artifact is undefined
  res, // res.artifact is undefined
  next,
) => {
  // Only rawPacket is available - no artifact yet
  console.log('Raw packet:', req.rawPacket);
  // req.artifact is undefined here - TypeScript knows this
};
```

### 2. After Parsing Middleware

```typescript
const afterParsingHandler: MiddlewareHandler<'after', 'parsing'> = (
  req, // req.artifact is guaranteed to be BTPArtifact (not undefined)
  res, // res.artifact is guaranteed to be BTPArtifact (not undefined)
  next,
) => {
  // No need to check if artifact exists - TypeScript knows it's there!
  console.log('Artifact ID:', req.artifact.id);
  console.log('Artifact type:', req.artifact.type);
};
```

### 3. After Signature Verification

```typescript
const afterSignatureHandler: MiddlewareHandler<'after', 'signatureVerification'> = (
  req, // req.artifact is BTPArtifact, req.isValid is boolean
  res, // res.artifact is BTPArtifact
  next,
) => {
  // Both artifact and isValid are guaranteed to be present
  if (req.isValid) {
    console.log('Valid artifact:', req.artifact.id);
  }
  // req.isTrusted is still optional (not yet verified)
};
```

### 4. After Trust Verification

```typescript
const afterTrustHandler: MiddlewareHandler<'after', 'trustVerification'> = (
  req, // req.artifact is BTPArtifact, req.isValid is boolean, req.isTrusted is boolean
  res, // res.artifact is BTPArtifact
  next,
) => {
  // All properties are guaranteed to be present
  if (req.isValid && req.isTrusted) {
    console.log('Valid and trusted artifact:', req.artifact.id);
  }
};
```

### 5. Error Handler

```typescript
const errorHandler: MiddlewareHandler<'before', 'onError'> = (
  req, // req.error is optional (BTPErrorException | undefined)
  res,
  next,
) => {
  // Error is optional - need to check if it exists
  if (req.error) {
    console.error('Error occurred:', req.error.message);
    console.error('Error code:', req.error.code);
  }
};
```

### 6. After Parsing with Potential Error

```typescript
const afterParsingWithErrorHandler: MiddlewareHandler<'after', 'parsing'> = (
  req, // req.artifact is BTPArtifact, req.error is optional
  res, // res.artifact is BTPArtifact
  next,
) => {
  // Check for parsing errors
  if (req.error) {
    console.error('Parsing error:', req.error.message);
    return;
  }

  // Process the artifact if no error
  console.log('Artifact ID:', req.artifact.id);
};
```

### 7. After Signature Verification with Potential Error

```typescript
const afterSignatureWithErrorHandler: MiddlewareHandler<'after', 'signatureVerification'> = (
  req, // req.artifact is BTPArtifact, req.isValid is boolean, req.error is optional
  res, // res.artifact is BTPArtifact
  next,
) => {
  // Check for signature verification errors
  if (req.error) {
    console.error('Signature verification error:', req.error.message);
    return;
  }

  // Process if no error
  if (req.isValid) {
    console.log('Valid artifact:', req.artifact.id);
  }
};
```

## Creating Middleware Definitions

```typescript
const middlewareDefinitions: MiddlewareDefinition[] = [
  {
    phase: 'before',
    step: 'parsing',
    handler: beforeParsingHandler, // Only rawPacket available
  },
  {
    phase: 'after',
    step: 'parsing',
    handler: afterParsingWithErrorHandler, // Artifact guaranteed, error optional
  },
  {
    phase: 'after',
    step: 'signatureVerification',
    handler: afterSignatureWithErrorHandler, // Artifact + isValid guaranteed, error optional
  },
  {
    phase: 'after',
    step: 'trustVerification',
    handler: afterTrustHandler, // Artifact + isValid + isTrusted guaranteed, error optional
  },
  {
    phase: 'before',
    step: 'onError',
    handler: errorHandler, // Error optional (general error handling)
  },
];
```

## Benefits

1. **Compile-time Safety**: TypeScript will catch errors if you try to access properties that aren't guaranteed to be present.

2. **No Runtime Checks**: Eliminates the need for `if (req.artifact)` checks in middleware where the artifact is guaranteed to exist.

3. **Better Developer Experience**: IntelliSense will show the correct properties based on the middleware phase and step.

4. **Self-Documenting Code**: The type signature clearly indicates what properties are available.

5. **Backward Compatibility**: Legacy middleware using the old types will continue to work.

## Migration Guide

### From Legacy Types

If you have existing middleware using the legacy types:

```typescript
// Old way (requires runtime checks)
const oldHandler = (req: BTPRequestCtx, res: BTPResponseCtx, next: Next) => {
  if (req.artifact) {
    console.log(req.artifact.id);
  }
};

// New way (no runtime checks needed)
const newHandler: MiddlewareHandler<'after', 'parsing'> = (req, res, next) => {
  console.log(req.artifact.id); // TypeScript knows this is safe
};
```

### Step-by-Step Migration

1. Identify the phase and step of your middleware
2. Update the handler signature to use the generic types
3. Remove unnecessary runtime checks
4. Update any type annotations in your middleware definitions

## Type Reference

### Core Types

- `MiddlewareHandler<P extends Phase, S extends Step>`: Generic middleware handler with precise typing
- `BTPRequestCtx<P extends Phase, S extends Step>`: Conditional request context
- `BTPResponseCtx<P extends Phase, S extends Step>`: Conditional response context
- `MiddlewareDefinition<P extends Phase, S extends Step>`: Middleware definition with proper typing

### Type Helpers

- `HasRawPacket<P, S>`: Determines if rawPacket should be present
- `HasArtifact<P, S>`: Determines if artifact should be present
- `HasIsValid<P, S>`: Determines if isValid should be present
- `HasIsTrusted<P, S>`: Determines if isTrusted should be present
- `HasError<P, S>`: Determines if error should be present

These type helpers are used internally to construct the conditional types and provide the compile-time guarantees.
