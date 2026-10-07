import { Schema, Types, model, type Document } from 'mongoose';

export interface PaymentAttempt {
  providerLinkId: string;
  url: string;
  createdAt: Date;
}

export interface PaymentDoc extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  quotationId: Types.ObjectId;
  quoteNumber: string;
  customerId: Types.ObjectId;
  amount: number; // rupees
  method: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  provider: string;
  providerLinkId: string | null;
  link: string | null;
  linkExpiresAt: Date | null;
  attempts: PaymentAttempt[];
  paidAt: Date | null;
  transactionRef: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const attemptSchema = new Schema<PaymentAttempt>(
  {
    providerLinkId: { type: String, required: true },
    url: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const paymentSchema = new Schema<PaymentDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    quotationId: { type: Schema.Types.ObjectId, ref: 'Quotation', required: true },
    quoteNumber: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'], default: 'PENDING' },
    provider: { type: String, required: true },
    providerLinkId: { type: String, default: null },
    link: { type: String, default: null },
    linkExpiresAt: { type: Date, default: null },
    attempts: { type: [attemptSchema], default: [] },
    paidAt: { type: Date, default: null },
    transactionRef: { type: String, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);

paymentSchema.index({ orgId: 1, createdAt: -1 });
paymentSchema.index({ orgId: 1, quotationId: 1 });
paymentSchema.index({ 'attempts.providerLinkId': 1 });
paymentSchema.index({ status: 1, linkExpiresAt: 1 }); // expiry and reminder jobs

export const Payment = model<PaymentDoc>('Payment', paymentSchema);
