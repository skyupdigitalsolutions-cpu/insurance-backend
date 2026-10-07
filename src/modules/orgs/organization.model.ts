import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
const organizationSchema = new Schema(
  {
    name:           { type: String, required: true, trim: true, maxlength: 120 },
    ownerUserId:    { type: Schema.Types.ObjectId, ref: 'User', default: null },
    irdaiNumber:    { type: String, trim: true, default: null },
    trialStartedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
export type OrganizationDoc = InferSchemaType<typeof organizationSchema> & { _id: Types.ObjectId };
export const Organization = model('Organization', organizationSchema);