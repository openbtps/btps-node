import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IdentityRecord,
  IdentityRecordDocument,
} from './schemas/identity-record.schema.js';
import {
  AbstractIdentityStore,
  BTPIdentityRecord,
  IdentityPubKeyRecord,
  StorageStoreOptions,
} from '@btps/sdk/storage';

@Injectable()
export class MongoIdentityStoreService extends AbstractIdentityStore<BTPIdentityRecord> {
  constructor(
    @InjectModel(IdentityRecord.name)
    private readonly identityRecordModel: Model<IdentityRecordDocument>,
  ) {
    super({
      connection: null,
      entityName: 'identity_records',
    } as StorageStoreOptions);
  }

  async getById(computedId: string): Promise<BTPIdentityRecord | undefined> {
    try {
      const record = await this.identityRecordModel
        .findOne({ id: computedId })
        .exec();
      if (!record) {
        return undefined;
      }

      return this.mapToBTPIdentityRecord(record);
    } catch (error) {
      console.error('Error getting identity record by ID:', error);
      return undefined;
    }
  }

  async create(
    record: Omit<BTPIdentityRecord, 'id'>,
    computedId?: string,
  ): Promise<BTPIdentityRecord> {
    try {
      const newRecord = new this.identityRecordModel({
        id: computedId,
        ...record,
      });

      const savedRecord = await newRecord.save();
      return this.mapToBTPIdentityRecord(savedRecord);
    } catch (error) {
      console.error('Error creating identity record:', error);
      throw error;
    }
  }

  async update(
    computedId: string,
    patch: Partial<BTPIdentityRecord>,
  ): Promise<BTPIdentityRecord> {
    try {
      const updatedRecord = await this.identityRecordModel
        .findOneAndUpdate(
          { id: computedId },
          { $set: patch },
          { new: true, runValidators: true },
        )
        .exec();

      if (!updatedRecord) {
        throw new Error(`Identity record with ID ${computedId} not found`);
      }

      return this.mapToBTPIdentityRecord(updatedRecord);
    } catch (error) {
      console.error('Error updating identity record:', error);
      throw error;
    }
  }

  async delete(computedId: string): Promise<void> {
    try {
      const result = await this.identityRecordModel
        .deleteOne({ id: computedId })
        .exec();
      if (result.deletedCount === 0) {
        throw new Error(`Identity record with ID ${computedId} not found`);
      }
    } catch (error) {
      console.error('Error deleting identity record:', error);
      throw error;
    }
  }

  async getPublicKeyRecord(
    identity: string,
    selector?: string,
  ): Promise<IdentityPubKeyRecord | undefined> {
    try {
      const query = selector
        ? { identity, 'publicKeys.selector': selector }
        : { identity };

      const record = await this.identityRecordModel.findOne(query).exec();
      if (!record) {
        return undefined;
      }

      const publicKeyRecord = selector
        ? record.publicKeys.find(pk => pk.selector === selector)
        : record.publicKeys[0]; // Get the first one if no selector specified

      if (!publicKeyRecord) {
        return undefined;
      }

      return {
        selector: publicKeyRecord.selector,
        publicKey: publicKeyRecord.publicKey,
        keyType: publicKeyRecord.keyType,
        version: publicKeyRecord.version,
        createdAt: publicKeyRecord.createdAt,
      };
    } catch (error) {
      console.error('Error getting public key record:', error);
      return undefined;
    }
  }

  private mapToBTPIdentityRecord(
    record: IdentityRecordDocument,
  ): BTPIdentityRecord {
    return {
      id: record.id,
      identity: record.identity,
      currentSelector: record.currentSelector,
      createdAt:
        (record as unknown as { createdAt?: Date }).createdAt?.toISOString() ||
        new Date().toISOString(),
      publicKeys: record.publicKeys,
      metadata: record.metadata,
    };
  }
}
