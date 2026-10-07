import { Schema, Types, model, type Document } from 'mongoose';

export interface QuotationAddOn {
  id: string;
  name: string;
  premium: number;
}

export interface QuotationDoc extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  quoteNumber: string;
  customerId: Types.ObjectId;
  productId: string;
  productName: string;
  companyName: string;
  addOns: QuotationAddOn[];
  comparedProductIds: string[];
  frequency: 'Monthly' | 'Quarterly' | 'Yearly';
  basePremium: number;
  addOnsPremium: number;
  discountPercent: number;
  discountAmount: number;
  premium: number; // final premium after discount
  status: 'DRAFT' | 'GENERATED' | 'SENT' | 'ACCEPTED' | 'CANCELLED';
  validUntil: string; // YYYY-MM-DD
  sentAt: Date | null;
  acceptedAt: Date | null;
  cancelReason: string | null; // e.g. "Expired" (set by the nightly clean-up job)
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const quotationSchema = new Schema<QuotationDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    quoteNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    companyName: { type: String, required: true },
    addOns: [{ id: String, name: String, premium: Number }],
    comparedProductIds: [{ type: String }],
    frequency: { type: String, enum: ['Monthly', 'Quarterly', 'Yearly'], required: true },
    basePremium: { type: Number, required: true },
    addOnsPremium: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    premium: { type: Number, required: true },
    status: { type: String, enum: ['DRAFT', 'GENERATED', 'SENT', 'ACCEPTED', 'CANCELLED'], default: 'DRAFT' },
    validUntil: { type: String, required: true },
    sentAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    cancelReason: { type: String, default: null }, // e.g. "Expired" (set by the nightly clean-up job)
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

quotationSchema.index({ orgId: 1, createdAt: -1 });
quotationSchema.index({ orgId: 1, customerId: 1 });
quotationSchema.index({ orgId: 1, quoteNumber: 1 }, { unique: true });
quotationSchema.index({ status: 1, validUntil: 1 }); // nightly expiry job

export const Quotation = model<QuotationDoc>('Quotation', quotationSchema);
