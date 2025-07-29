/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

import { AbstractStorageStore } from '@core/storage/AbstractStorageStore.js';
import { BTPTrustRecord } from '../types.js';

export abstract class AbstractTrustStore<T extends BTPTrustRecord> extends AbstractStorageStore<T> {
  abstract getAll(receiverId?: string): Promise<T[]>;
}
