import { Schema, Types, model, type Document } from 'mongoose';

// ─── Template ────────────────────────────────────────────────────────────────

export interface TemplateDoc extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId | null; // null = company default, visible to all orgs
  name: string;
  event: string; // e.g. Renewal, Birthday, Quotation, Payment, PaymentReminder
  channel: 'WhatsApp' | 'Email';
  body: string; // placeholders: {{name}} {{policy}} {{due}} {{amount}} {{quote}} {{link}}
  approved: boolean;
  manual: boolean; // false = used only by automatic reminders (not listed in the app)
  // WhatsApp Cloud API: the template name approved in Meta Business Manager. Its {{1}}, {{2}} …
  // are our placeholders in the order they appear in `body`.
  waTemplateName: string | null;
  waLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}

const templateSchema = new Schema<TemplateDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    event: { type: String, required: true, trim: true },
    channel: { type: String, enum: ['WhatsApp', 'Email'], required: true },
    body: { type: String, required: true }, // placeholders: {{name}} {{policy}} {{due}} {{amount}} {{quote}} {{link}}
    approved: { type: Boolean, default: true },
    manual: { type: Boolean, default: true }, // false = used only by automatic reminders (not listed in the app)
    // WhatsApp Cloud API: the template name approved in Meta Business Manager. Its {{1}}, {{2}} …
    // are our placeholders in the order they appear in `body`.
    waTemplateName: { type: String, default: null },
    waLanguage: { type: String, default: 'en' },
  },
  { timestamps: true },
);

templateSchema.index({ orgId: 1, event: 1 });
templateSchema.index({ orgId: 1, approved: 1 });

export const Template = model<TemplateDoc>('Template', templateSchema);

// ─── Message ─────────────────────────────────────────────────────────────────

export interface MessageDoc extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  customerId: Types.ObjectId;
  customerName: string;
  channel: 'WhatsApp' | 'Email';
  to: string;
  templateId: Types.ObjectId;
  templateName: string;
  text: string;
  status: 'Sent' | 'Delivered' | 'Failed';
  providerMessageId: string | null;
  error: string | null;
  deliveredAt: Date | null; // from the provider's delivery-status webhook
  sentBy: Types.ObjectId | null; // null = sent automatically by a reminder job
  automatic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<MessageDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    channel: { type: String, enum: ['WhatsApp', 'Email'], required: true },
    to: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'Template', required: true },
    templateName: { type: String, required: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['Sent', 'Delivered', 'Failed'], default: 'Sent' },
    providerMessageId: { type: String, default: null },
    error: { type: String, default: null },
    deliveredAt: { type: Date, default: null }, // from the provider's delivery-status webhook
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // null = sent automatically by a reminder job
    automatic: { type: Boolean, default: false },
  },
  { timestamps: true },
);

messageSchema.index({ orgId: 1, createdAt: -1 });
messageSchema.index({ providerMessageId: 1 }, { partialFilterExpression: { providerMessageId: { $type: 'string' } } });

export const Message = model<MessageDoc>('Message', messageSchema);
