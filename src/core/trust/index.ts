/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// The trust rules live in trustUtils.ts, apart from the file store, so code a
// client or a phone runs can use them without bundling JsonTrustStore.
export { default as JsonTrustStore } from './storage/JsonTrustStore.js';
export { AbstractTrustStore } from './storage/AbstractTrustStore.js';
export * from './types.js';
export * from './trustUtils.js';
// The permission names a trust carries, for a client as well as a server.
export * from '@core/server/constants/permissions.js';
export type {
  BTPDocumentType,
  BTPEntityType,
  BTPSendPermission,
  BTPDetailPermission,
  BTPPermissionName,
  BTPPermission,
  BTPTrustPermissions,
} from '@core/server/types.js';
// A platform checks an opened trust request's or answer's values with these, as decryptVerify does.
export { trustRequestProblem, trustResponseProblem } from '@core/server/schemas/trustValues.js';
