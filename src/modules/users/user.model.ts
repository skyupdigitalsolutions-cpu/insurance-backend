import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
export const USER_STATUSES = ['PENDING_OTP', 'PENDING_VERIFICATION', 'ACTIVE', 'REJECTED', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
const userSchema = new Schema(
  {
    orgId:              { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    roleId:             { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    name:               { type: String, required: true, trim: true, maxlength: 80 },
    email:              { type: String, required: true, lowercase: true, trim: true, unique: true },
    mobile:             { type: String, required: true, unique: true },
    passwordHash:       { type: String, required: true, select: false },
    status:             { type: String, enum: USER_STATUSES, required: true },
    isPlatformAdmin:    { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
    mobileVerifiedAt:   { type: Date, default: null },
    approvedAt:         { type: Date, default: null },
    approvedBy:         { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedReason:     { type: String, default: null },
    lastLoginAt:        { type: Date, default: null },
  },
  { timestamps: true },
);
userSchema.index({ status: 1, createdAt: -1 });
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = model('User', userSchema);