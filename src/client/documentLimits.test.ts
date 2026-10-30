/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

// An unmodified SDK cannot send a document over a protocol limit: the client
// and the transporter both refuse it before anything is written to a socket.

import { describe, it, expect, vi, afterEach } from 'vitest';
import tls from 'tls';
import { BtpsClient } from './btpsClient.js';
import { BtpsTransporter } from './btpsTransporter.js';
import { BTP_PROTOCOL_VERSION } from '../core/server/constants/index.js';
import { BTPS_FIELD_LIMITS } from '../core/server/constants/limits.js';
import type { BTPTransporterArtifact } from '../core/server/types.js';

const invoiceWithRows = (rows: number) => ({
  type: 'invoice',
  title: 'Invoice',
  id: 'INV-1',
  issuedAt: '2025-01-01T00:00:00.000Z',
  totalAmount: { amount: 100, currency: 'AUD' },
  lineItems: { columns: ['a'], rows: Array.from({ length: rows }, () => ({ a: 1 })) },
});

const artifactWith = (document: unknown) =>
  ({
    version: BTP_PROTOCOL_VERSION,
    issuedAt: new Date().toISOString(),
    id: 'artifact-1',
    type: 'BTPS_DOC',
    from: 'billing$vendor.com',
    to: 'billing$customer.com',
    selector: 'btps1',
    signature: { algorithmHash: 'sha256', value: 'sig', fingerprint: 'fp' },
    encryption: null,
    document,
  }) as unknown as BTPTransporterArtifact;

describe('a document over a protocol limit is never sent', () => {
  const overLimit = artifactWith(invoiceWithRows(BTPS_FIELD_LIMITS.lineItems.rows + 1));

  afterEach(() => vi.restoreAllMocks());

  it('by BtpsClient', async () => {
    const connect = vi.spyOn(tls, 'connect');
    const client = new BtpsClient({ to: 'billing$customer.com' });

    const { error } = await client.send(overLimit);

    expect(error?.code).toBe('BTP_ERROR_VALIDATION');
    expect(connect).not.toHaveBeenCalled();
    client.destroy();
  });

  it('by BtpsTransporter', async () => {
    const connect = vi.spyOn(tls, 'connect');
    const transporter = new BtpsTransporter({});

    const { error } = await transporter.transport('billing$customer.com', overLimit);

    expect(error?.message).toContain('Invalid artifact');
    expect(connect).not.toHaveBeenCalled();
    transporter.destroy();
  });

  it('while one at the limit is valid', () => {
    const atLimit = artifactWith(invoiceWithRows(BTPS_FIELD_LIMITS.lineItems.rows));
    const client = new BtpsClient({ to: 'billing$customer.com' });

    expect(client['validateArtifact'](atLimit).isValid).toBe(true);
    client.destroy();
  });
});
