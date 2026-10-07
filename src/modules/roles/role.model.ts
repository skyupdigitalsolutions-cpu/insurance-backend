import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
const roleSchema = new Schema(
  {
    orgId:       { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    key:         { type: String, default: null },
    name:        { type: String, required: true, trim: true, maxlength: 50 },
    nameKey:     { type: String, required: true },
    permissions: { type: [String], default: [] },
    system:      { type: Boolean, default: false },
  },
  { timestamps: true },
);
roleSchema.index({ orgId: 1, nameKey: 1 }, { unique: true });
export type RoleDoc = InferSchemaType<typeof roleSchema> & { _id: Types.ObjectId };
export const Role = model('Role', roleSchema);