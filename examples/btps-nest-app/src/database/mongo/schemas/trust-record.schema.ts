import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TrustRecordDocument = TrustRecord & Document;

@Schema({ timestamps: true })
export class TrustRecord {
  @Prop({ required: true, unique: true, index: true })
  id!: string; // computedId from BTPS SDK

  @Prop({ required: true, index: true })
  senderId!: string;

  @Prop({ required: true, index: true })
  receiverId!: string;

  @Prop({
    required: true,
    enum: ['pending', 'accepted', 'rejected'],
    index: true,
  })
  status: 'pending' | 'accepted' | 'rejected' = 'pending';

  @Prop({ required: true })
  createdAt!: string;

  @Prop()
  decidedBy?: string;

  @Prop()
  decidedAt?: string;

  @Prop({ index: true })
  expiresAt?: string;

  @Prop({ required: true })
  publicKeyBase64!: string;

  @Prop({ required: true, index: true })
  publicKeyFingerprint!: string;

  @Prop({ type: [Object], default: [] })
  keyHistory: Array<{
    fingerprint: string;
    firstSeen: string;
    lastSeen: string;
  }> = [];

  @Prop({ enum: ['unencrypted', 'encrypted', 'mixed'], default: 'encrypted' })
  privacyType: 'unencrypted' | 'encrypted' | 'mixed' = 'encrypted';

  @Prop({ type: Object })
  metadata?: Record<string, unknown>;
}

export const TrustRecordSchema = SchemaFactory.createForClass(TrustRecord);
