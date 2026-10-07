import { Schema, model } from 'mongoose';
const auditLogSchema = new Schema(
  {
    orgId:       { type: Schema.Types.ObjectId, default: null, index: true },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    action:      { type: String, required: true },
    entity:      { type: String, required: true },
    entityId:    { type: Schema.Types.ObjectId, default: null },
    meta:        { type: Schema.Types.Mixed, default: undefined },
    ip:          { type: String, default: null },
    requestId:   { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
export const AuditLog = model('AuditLog', auditLogSchema);