/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * BTPS 1.2: details refresh, as a device asks for it. details.changed,
 * details.request and details.respond name their details; a response names
 * the request it answers and is always encrypted; a request may name the
 * notice it follows.
 */

import { describe, expect, it } from 'vitest';
import { BtpsAgentCommandCallSchema } from '../../../client/libs/schema.js';

const encryption = { algorithm: 'aes-256-gcm', mode: 'standardEncrypt' };
const call = (actionType: string, document: object, options: object) =>
  BtpsAgentCommandCallSchema.safeParse({
    actionType,
    to: 'billing$acme.example',
    document,
    options: { signature: { algorithmHash: 'sha256' }, ...options },
  }).success;

describe('a details refresh, asked for by a device', () => {
  it('is a notice naming the details that changed', () => {
    expect(call('details.changed', {}, { details: ['detail:address'] })).toBe(true);
  });

  it('is a request, on its own or naming the notice it follows', () => {
    expect(call('details.request', {}, { details: ['detail:address'] })).toBe(true);
    expect(
      call('details.request', {}, { details: ['detail:address'], relatesTo: 'notice-1' }),
    ).toBe(true);
  });

  it('is an encrypted response naming the request it answers', () => {
    const values = { 'detail:address': '2 Rata Road, Auckland' };
    expect(
      call('details.respond', values, {
        details: ['detail:address'],
        relatesTo: 'req-1',
        encryption,
      }),
    ).toBe(true);
  });

  it('is refused without the details it is about', () => {
    expect(call('details.changed', {}, {})).toBe(false);
  });

  it('is refused naming a detail that is not one', () => {
    expect(call('details.changed', {}, { details: ['detail:nickname'] })).toBe(false);
  });

  it('is refused as a response naming no request, or unencrypted', () => {
    const values = { 'detail:address': '2 Rata Road, Auckland' };
    expect(call('details.respond', values, { details: ['detail:address'], encryption })).toBe(
      false,
    );
    expect(
      call('details.respond', values, { details: ['detail:address'], relatesTo: 'req-1' }),
    ).toBe(false);
  });

  it('is refused as a notice naming another artifact', () => {
    expect(call('details.changed', {}, { details: ['detail:address'], relatesTo: 'x' })).toBe(
      false,
    );
  });

  it('never puts details on any other action', () => {
    expect(call('trust.fetch', {}, { details: ['detail:address'] })).toBe(false);
  });
});
