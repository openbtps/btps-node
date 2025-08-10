import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  TrustRecord,
  TrustRecordDocument,
} from './schemas/trust-record.schema.js';
import { AbstractTrustStore, BTPTrustRecord } from '@btps/sdk/trust';

@Injectable()
export class MongoTrustStoreService extends AbstractTrustStore<BTPTrustRecord> {
  constructor(
    @InjectModel(TrustRecord.name)
    private readonly trustRecordModel: Model<TrustRecordDocument>,
  ) {
    super({ connection: null, entityName: 'trust_records' });
  }

  async getById(computedId: string): Promise<BTPTrustRecord | undefined> {
    try {
      const record = await this.trustRecordModel
        .findOne({ id: computedId })
        .exec();
      if (!record) {
        return undefined;
      }

      return this.mapToBTPTrustRecord(record);
    } catch (error) {
      console.error('Error getting trust record by ID:', error);
      return undefined;
    }
  }

  async create(
    record: Omit<BTPTrustRecord, 'id'>,
    computedId?: string,
  ): Promise<BTPTrustRecord> {
    try {
      const newRecord = new this.trustRecordModel({
        id: computedId,
        ...record,
      });

      const savedRecord = await newRecord.save();
      return this.mapToBTPTrustRecord(savedRecord);
    } catch (error) {
      console.error('Error creating trust record:', error);
      throw error;
    }
  }

  async update(
    computedId: string,
    patch: Partial<BTPTrustRecord>,
  ): Promise<BTPTrustRecord> {
    try {
      const updatedRecord = await this.trustRecordModel
        .findOneAndUpdate(
          { id: computedId },
          { $set: patch },
          { new: true, runValidators: true },
        )
        .exec();

      if (!updatedRecord) {
        throw new Error(`Trust record with ID ${computedId} not found`);
      }

      return this.mapToBTPTrustRecord(updatedRecord);
    } catch (error) {
      console.error('Error updating trust record:', error);
      throw error;
    }
  }

  async delete(computedId: string): Promise<void> {
    try {
      const result = await this.trustRecordModel
        .deleteOne({ id: computedId })
        .exec();
      if (result.deletedCount === 0) {
        throw new Error(`Trust record with ID ${computedId} not found`);
      }
    } catch (error) {
      console.error('Error deleting trust record:', error);
      throw error;
    }
  }

  async getAll(receiverId?: string): Promise<BTPTrustRecord[]> {
    try {
      const query = receiverId ? { receiverId } : {};
      const records = await this.trustRecordModel.find(query).exec();
      return records.map(record => this.mapToBTPTrustRecord(record));
    } catch (error) {
      console.error('Error getting all trust records:', error);
      return [];
    }
  }

  private mapToBTPTrustRecord(record: TrustRecordDocument): BTPTrustRecord {
    return {
      id: record.id,
      senderId: record.senderId,
      receiverId: record.receiverId,
      status: record.status,
      createdAt: record.createdAt,
      decidedBy: record.decidedBy || '',
      decidedAt: record.decidedAt || new Date().toISOString(),
      expiresAt: record.expiresAt,
      publicKeyBase64: record.publicKeyBase64,
      publicKeyFingerprint: record.publicKeyFingerprint,
      keyHistory: record.keyHistory,
      privacyType: record.privacyType,
      metadata: record.metadata,
    };
  }
}
