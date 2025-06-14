import { BTPTrustRecord } from '../../../types';
import { TrustStoreOptions } from '../../types';

export abstract class AbstractTrustStore<T extends BTPTrustRecord> {
  protected connection: unknown;
  protected entityName?: string;

  constructor({ connection, entityName }: TrustStoreOptions) {
    this.connection = connection;
    this.entityName = entityName;
  }

  abstract getBySender(to: string, from: string): Promise<T | undefined>;
  abstract create(to: string, from: string, record: T): Promise<T>;
  abstract update(to: string, from: string, patch: Partial<T>): Promise<T>;
  abstract delete(to: string, from: string): Promise<void>;
  abstract getAll(to?: string): Promise<T[]>;
}
