/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A client refuses to send an artifact stamped lower than what it uses: a 1.1
 * receiver would read a 1.2 field under 1.1.0 as something else. Here the
 * version rule says every artifact needs 1.2, so the refusal is seen before
 * any 1.2 field exists.
 */

import { describe, expect, it, vi } from 'vitest';
import { BtpsClient } from './btpsClient.js';
import type { BTPTransporterArtifact } from '../server/index.js';

vi.mock('@core/server/constants/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/server/constants/index.js')>()),
  artifactVersion: () => '1.2.0',
}));

const artifact = (version: string): BTPTransporterArtifact => ({
  version,
  issuedAt: new Date().toISOString(),
  id: 'artifact-1',
  type: 'BTPS_DOC',
  from: 'alice$saas.example',
  to: 'pay$client.example',
  selector: 'btps1',
  signature: { algorithmHash: 'sha256', value: 'AA==', fingerprint: 'AA==' },
  encryption: {
    algorithm: 'aes-256-gcm',
    encryptedKey: 'AA==',
    iv: 'AA==',
    authTag: 'AA==',
    type: 'standardEncrypt',
  },
  document: 'ciphertext',
});

describe('an artifact that uses what 1.2 adds', () => {
  it('is refused before sending when stamped 1.1.0', async () => {
    const client = new BtpsClient({ to: 'pay$client.example' });
    const { error } = await client.send(artifact('1.1.0'));
    client.destroy();

    expect(error?.cause).toBe('stamped 1.1.0, but it uses what 1.2.0 adds');
  });

  it('passes the check when stamped 1.2.0', () => {
    const client = new BtpsClient({ to: 'pay$client.example' });
    const { isValid } = client['validateArtifact'](artifact('1.2.0'));
    client.destroy();

    expect(isValid).toBe(true);
  });
});
