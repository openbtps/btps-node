/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BTPErrorException, BTP_ERROR_VALIDATION } from '@core/error/index.js';
import { BtpsSimpleMetricsTracker } from './btpsSimpleMetricsTracker.js';
import type { IMetricsTracker } from './type.js';

describe('BtpsSimpleMetricsTracker.onError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs any error the interface passes it, without throwing', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tracker: IMetricsTracker = new BtpsSimpleMetricsTracker();

    expect(() => tracker.onError(new Error('socket hang up'))).not.toThrow();
    expect(logged).toHaveBeenCalledWith('[Metrics] Error:', {
      name: 'Error',
      message: 'socket hang up',
    });
  });

  it('logs a BTPS error as its JSON', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = new BTPErrorException(BTP_ERROR_VALIDATION);

    new BtpsSimpleMetricsTracker().onError(error);

    expect(logged).toHaveBeenCalledWith('[Metrics] Error:', error.toJSON());
  });
});
