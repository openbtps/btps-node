/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryQueue } from './InMemoryQueue.js';
import type { BTPArtifact } from '@core/server/types.js';

const transporter = { id: 't1', type: 'BTPS_DOC', from: 'alice$a.test', to: 'bob$b.test' };
const lookup = { id: 'l1', identity: 'bob$b.test', from: 'alice$a.test', hostSelector: 'btps1' };
const agent = { id: 'a1', action: 'inbox.fetch', agentId: 'btps_ag_1', to: 'bob$b.test' };
const control = { id: 'c1', action: 'QUIT', version: '1.1.0' };

const add = (queue: InMemoryQueue, message: object) => queue.add(message as BTPArtifact);

describe('InMemoryQueue', () => {
  it('queues each artifact under who it is for, and tells its listeners', async () => {
    const queue = new InMemoryQueue();
    const heard = vi.fn();
    queue.on('message', heard);

    for (const message of [transporter, lookup, agent, control]) await add(queue, message);

    expect(await queue.getPending('bob$b.test')).toEqual([transporter]);
    expect(await queue.getPending('alice$a.test')).toEqual([lookup]);
    expect(await queue.getPending('btps_ag_1')).toEqual([agent]);
    expect(await queue.getPending('unknown-control-request')).toEqual([control]);
    expect(await queue.getPending()).toHaveLength(4);
    expect(heard).toHaveBeenCalledTimes(4);
  });

  it('has nothing pending for an identity it never queued for', async () => {
    expect(await new InMemoryQueue().getPending('nobody$x.test')).toEqual([]);
  });

  it('drops an artifact once it is handled', async () => {
    const queue = new InMemoryQueue();
    await add(queue, transporter);

    await queue.markHandled('t1');

    expect(await queue.getPending()).toEqual([]);
  });
});
