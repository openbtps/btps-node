/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Deep-freezes a document and returns the same reference. A signed document
 * is immutable: a status change is a separate `BTPS_EVENT`, never a write
 * into the document, and a frozen document makes an in-place write throw
 * (in strict mode) instead of silently changing it. This does not stand in
 * for the storage layer's own guarantee that a stored artifact is never
 * overwritten.
 */
export function freezeDocument<T extends object>(doc: T): Readonly<T> {
  deepFreeze(doc);
  return doc;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
}
