import { BTPTrustRecord } from '../../../types';
import { TrustStoreOptions } from '../../types';

export abstract class AbstractTrustStore<T extends BTPTrustRecord> {
  protected connection: unknown;
  protected entityName?: string;

  constructor({ connection, entityName }: TrustStoreOptions) {
    this.connection = connection;
    this.entityName = entityName;
  }

  abstract getBySender(receiverId: string, senderId: string): Promise<T | undefined>;
  abstract create(receiverId: string, senderId: string, record: T): Promise<T>;
  abstract update(receiverId: string, senderId: string, patch: Partial<T>): Promise<T>;
  abstract delete(receiverId: string, senderId: string): Promise<void>;
  abstract getAll(receiverId?: string): Promise<T[]>;
}
