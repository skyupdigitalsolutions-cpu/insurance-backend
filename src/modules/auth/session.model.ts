import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
const sessionSchema = new Schema(
  {
    userId:            { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash:  { type: String, required: true, unique: true },
    previousTokenHash: { type: String, default: null, index: true },
    rotatedAt:         { type: Date, default: null },
    expiresAt:         { type: Date, required: true },
    revokedAt:         { type: Date, default: null },
    revokedReason:     { type: String, default: null },
    userAgent:         { type: String, default: null },
    ip:                { type: String, default: null },
    lastUsedAt:        { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
export type SessionDoc = InferSchemaType<typeof sessionSchema> & { _id: Types.ObjectId };
export const Session = model('Session', sessionSchema);