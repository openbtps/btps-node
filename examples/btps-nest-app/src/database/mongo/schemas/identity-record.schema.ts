import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IdentityRecordDocument = IdentityRecord & Document;

@Schema({ timestamps: true })
export class IdentityRecord {
  @Prop({ required: true, unique: true })
  id!: string; // computedId from BTPS SDK

  @Prop({ required: true })
  identity!: string;

  @Prop({ required: true })
  currentSelector!: string;

  @Prop({ type: [Object], required: true, default: [] })
  publicKeys: Array<{
    selector: string;
    publicKey: string;
    keyType: 'rsa';
    version: string;
    createdAt: string;
  }> = [];

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const IdentityRecordSchema =
  SchemaFactory.createForClass(IdentityRecord);

// Create indexes for better performance
IdentityRecordSchema.index({ identity: 1 });
IdentityRecordSchema.index({ currentSelector: 1 });
IdentityRecordSchema.index({ 'publicKeys.selector': 1 });
