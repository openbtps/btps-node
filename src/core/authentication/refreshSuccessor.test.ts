/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { openSuccessor, sealSuccessor } from './refreshSuccessor.js';

const identity = 'alice$saas.example';
const at = '2026-01-01T00:00:00.000Z';
const answer = {
  agentId: 'agent-1',
  refreshToken: 'new-token',
  expiresAt: '2026-01-08T00:00:00.000Z',
  decryptBy: identity,
};

describe('a refresh answer sealed under its old token', () => {
  const sealed = sealSuccessor('old-token', identity, answer, at);

  it('opens with the old token, for the same device and user', () => {
    expect(openSuccessor('old-token', 'agent-1', identity, sealed)).toEqual(answer);
  });

  it('holds no part of the answer in plain text', () => {
    expect(JSON.stringify(sealed)).not.toContain('new-token');
  });

  it('opens with no other token', () => {
    expect(openSuccessor('other-token', 'agent-1', identity, sealed)).toBeUndefined();
  });

  it('cannot be moved to another device or user', () => {
    expect(openSuccessor('old-token', 'agent-2', identity, sealed)).toBeUndefined();
    expect(openSuccessor('old-token', 'agent-1', 'bob$saas.example', sealed)).toBeUndefined();
  });

  it('refuses a tag shorter than 16 bytes, which GCM would otherwise check only in part', () => {
    const tag = Buffer.from(sealed.tag, 'base64');
    for (const length of [4, 8, 12, 15]) {
      const truncated = { ...sealed, tag: tag.subarray(0, length).toString('base64') };
      expect(openSuccessor('old-token', 'agent-1', identity, truncated)).toBeUndefined();
    }
  });

  it('cannot have its rotation time moved, to stretch the window', () => {
    const later = { ...sealed, at: '2026-01-01T00:10:00.000Z' };
    expect(openSuccessor('old-token', 'agent-1', identity, later)).toBeUndefined();
  });
});
