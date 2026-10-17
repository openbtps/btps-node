/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import * as client from './index.js';
import { BtpsAgent } from './btpsAgent.js';
import { BtpsClient } from './btpsClient.js';
import { BtpsTransporter } from './btpsTransporter.js';

describe('@btps/sdk/client', () => {
  it('exports the agent, the client and the transporter', () => {
    expect(client.BtpsAgent).toBe(BtpsAgent);
    expect(client.BtpsClient).toBe(BtpsClient);
    expect(client.BtpsTransporter).toBe(BtpsTransporter);
  });
});
