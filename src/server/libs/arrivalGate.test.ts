/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BtpsArrivalGate,
  DEFAULT_MAX_ARTIFACTS_WAITING,
  resolveArrivalGate,
  type BTPArrivalLeave,
  type BTPArrivalTicket,
} from './arrivalGate.js';

const leaveOf = (ticket: BTPArrivalTicket): BTPArrivalLeave => {
  if (ticket.state !== 'in') throw new Error(`expected a place, got ${ticket.state}`);
  return ticket.leave;
};

describe('BtpsArrivalGate', () => {
  it('gives places up to its limit, then queues up to its own, then refuses', () => {
    const gate = new BtpsArrivalGate(2, 1);

    expect(gate.enter().state).toBe('in');
    expect(gate.enter().state).toBe('in');
    expect(gate.enter().state).toBe('waiting');
    expect(gate.enter().state).toBe('full');
    expect(gate.inFlight).toBe(2);
    expect(gate.waiting).toBe(1);
  });

  it('hands a place given up to the first waiting, in order of arrival', async () => {
    const gate = new BtpsArrivalGate(1, 2);
    const first = leaveOf(gate.enter());
    const second = gate.enter();
    const third = gate.enter();
    if (second.state !== 'waiting' || third.state !== 'waiting') throw new Error('expected waits');

    first();
    const secondLeave = await second.admitted;
    expect(secondLeave).toBeTypeOf('function');
    expect(gate.inFlight).toBe(1);
    expect(gate.waiting).toBe(1);

    // A place given up twice frees one place, not two.
    first();
    expect(gate.waiting).toBe(1);

    secondLeave!();
    expect(await third.admitted).toBeTypeOf('function');
    expect(gate.waiting).toBe(0);
  });

  it('takes a newcomer once the queue drops below its limit', () => {
    const gate = new BtpsArrivalGate(1, 1);
    const first = leaveOf(gate.enter());
    gate.enter();
    expect(gate.enter().state).toBe('full');

    first();
    expect(gate.waiting).toBe(0);
    expect(gate.enter().state).toBe('waiting');
  });

  it('lets a wait be cancelled, so its turn goes to the next', async () => {
    const gate = new BtpsArrivalGate(1, 2);
    const first = leaveOf(gate.enter());
    const gone = gate.enter();
    const next = gate.enter();
    if (gone.state !== 'waiting' || next.state !== 'waiting') throw new Error('expected waits');

    gone.cancel();
    expect(await gone.admitted).toBeUndefined();
    first();
    expect(await next.admitted).toBeTypeOf('function');
  });

  it('frees its places once every one is given up', () => {
    const gate = new BtpsArrivalGate(2, 0);
    const a = leaveOf(gate.enter());
    const b = leaveOf(gate.enter());
    a();
    b();
    expect(gate.inFlight).toBe(0);
  });
});

describe('resolveArrivalGate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is none without maxArtifactsInFlight, as before', () => {
    expect(resolveArrivalGate(undefined, undefined)).toBeUndefined();
  });

  it('warns of maxArtifactsWaiting set alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveArrivalGate(undefined, 10)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('waits the default when only maxArtifactsInFlight is set', () => {
    const gate = resolveArrivalGate(1, undefined)!;
    gate.enter();
    for (let i = 0; i < DEFAULT_MAX_ARTIFACTS_WAITING; i++)
      expect(gate.enter().state).toBe('waiting');
    expect(gate.enter().state).toBe('full');
  });

  it('warns and uses what it can for values it cannot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const one = resolveArrivalGate(0, -3)!;
    expect(one.enter().state).toBe('in');
    expect(one.enter().state).toBe('full');

    const byDefault = resolveArrivalGate(2.5, 1.5)!;
    byDefault.enter();
    expect(byDefault.enter().state).toBe('waiting');
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
