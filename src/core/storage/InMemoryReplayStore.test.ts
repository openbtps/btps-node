/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { InMemoryReplayStore } from './InMemoryReplayStore.js';
import { computeReplayKey } from './AbstractReplayStore.js';
import { BTP_ERROR_RATE_LIMITER } from '@core/error/constant.js';

const FROM = 'billing$acme.example';
const T0 = Date.parse('2026-10-16T12:00:00.000Z');

const clock = () => {
  let now = T0;
  return { now: () => now, set: (ms: number) => (now = ms) };
};

describe('item F: InMemoryReplayStore', () => {
  it('remembers a pair once', async () => {
    const store = new InMemoryReplayStore();
    const until = new Date(Date.now() + 60_000);
    expect(await store.seen(FROM, 'id-1')).toBe(false);
    expect(await store.remember(FROM, 'id-1', until)).toBe(true);
    expect(await store.seen(FROM, 'id-1')).toBe(true);
    expect(await store.remember(FROM, 'id-1', until)).toBe(false);
  });

  it('keys from case-insensitively and id exactly', async () => {
    const store = new InMemoryReplayStore();
    const until = new Date(Date.now() + 60_000);
    await store.remember(FROM, 'id-1', until);
    expect(await store.seen('Billing$ACME.example', 'id-1')).toBe(true);
    expect(await store.seen(FROM, 'ID-1')).toBe(false);
    expect(computeReplayKey('A$b.example', 'x')).toBe(computeReplayKey('a$b.example', 'x'));
  });

  it('holds the same id from different senders apart', async () => {
    const store = new InMemoryReplayStore();
    const until = new Date(Date.now() + 60_000);
    expect(await store.remember(FROM, 'id-1', until)).toBe(true);
    expect(await store.remember('finance$client.example', 'id-1', until)).toBe(true);
  });

  it('does not confuse pairs that join to the same text', async () => {
    expect(computeReplayKey('a$b.c', 'd:e')).not.toBe(computeReplayKey('a$b.c:d', 'e'));
  });

  it('forgets a pair when asked', async () => {
    const store = new InMemoryReplayStore();
    const until = new Date(Date.now() + 60_000);
    await store.remember(FROM, 'id-1', until);
    await store.forget(FROM, 'id-1');
    expect(await store.seen(FROM, 'id-1')).toBe(false);
    expect(await store.remember(FROM, 'id-1', until)).toBe(true);
  });

  it('lets an entry go once its expiry has passed', async () => {
    const c = clock();
    const store = new InMemoryReplayStore({ now: c.now });
    await store.remember(FROM, 'id-1', new Date(T0 + 300_000));
    c.set(T0 + 300_000);
    expect(await store.seen(FROM, 'id-1')).toBe(true);
    c.set(T0 + 300_001);
    expect(await store.seen(FROM, 'id-1')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('sweeps expired entries rather than grow', async () => {
    const c = clock();
    const store = new InMemoryReplayStore({ now: c.now, maxEntries: 3 });
    for (const id of ['a', 'b', 'c']) await store.remember(FROM, id, new Date(T0 + 1_000));
    c.set(T0 + 2_000);
    expect(await store.remember(FROM, 'd', new Date(T0 + 10_000))).toBe(true);
    expect(store.size).toBe(1);
  });

  it('refuses rather than forget an unexpired pair when full', async () => {
    const c = clock();
    const store = new InMemoryReplayStore({ now: c.now, maxEntries: 2 });
    await store.remember(FROM, 'a', new Date(T0 + 60_000));
    await store.remember(FROM, 'b', new Date(T0 + 60_000));
    await expect(store.remember(FROM, 'c', new Date(T0 + 60_000))).rejects.toMatchObject({
      code: BTP_ERROR_RATE_LIMITER.code,
    });
    expect(await store.seen(FROM, 'a')).toBe(true);
  });

  it('refuses a maxEntries that is not a positive whole number', () => {
    expect(() => new InMemoryReplayStore({ maxEntries: 0 })).toThrow();
    expect(() => new InMemoryReplayStore({ maxEntries: 1.5 })).toThrow();
  });
});
