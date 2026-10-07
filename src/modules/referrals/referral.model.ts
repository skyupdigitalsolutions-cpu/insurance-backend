import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

const referralSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    referrerCustomerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    referrerName: { type: String, required: true },
    code: { type: String, default: null },
    name: { type: String, required: true },
    mobile: { type: String, required: true },
    relationship: { type: String, required: true },
    interest: { type: String, required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
referralSchema.index({ orgId: 1, createdAt: -1 });
export type ReferralDoc = InferSchemaType<typeof referralSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Referral = model('Referral', referralSchema);
