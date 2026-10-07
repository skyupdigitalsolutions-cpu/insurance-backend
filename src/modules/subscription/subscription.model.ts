import { Schema, Types, model, type Document } from 'mongoose';

export type Plan = 'trial' | 'basic' | 'pro';
export type BillingCycle = 'monthly' | 'yearly';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface SubscriptionDoc extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  planId: Plan;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  autoRenew: boolean;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<SubscriptionDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    planId: { type: String, enum: ['trial', 'basic', 'pro'], required: true },
    status: { type: String, enum: ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED'], default: 'TRIAL' },
    cycle: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    autoRenew: { type: Boolean, default: true },
    trialEndsAt: { type: Date, default: null },
  },
  { timestamps: true },
);

subscriptionSchema.index({ orgId: 1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

export const Subscription = model<SubscriptionDoc>('Subscription', subscriptionSchema);

// ─── Checkout (plan payment link) ────────────────────────────────────────────

export interface CheckoutDoc extends Document {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  planId: Plan;
  cycle: BillingCycle;
  amount: number;
  gst: number;
  total: number;
  provider: string;
  providerLinkId: string | null;
  url: string;
  expiresAt: Date | null; // when the payment link stops working (older checkouts: 1 day after creation)
  automatic: boolean; // true = created by the plan-renewal reminder job
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const checkoutSchema = new Schema<CheckoutDoc>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: String, enum: ['trial', 'basic', 'pro'], required: true },
    cycle: { type: String, enum: ['monthly', 'yearly'], required: true },
    amount: { type: Number, required: true },
    gst: { type: Number, required: true },
    total: { type: Number, required: true },
    provider: { type: String, required: true },
    providerLinkId: { type: String, default: null },
    url: { type: String, required: true },
    expiresAt: { type: Date, default: null }, // when the payment link stops working (older checkouts: 1 day after creation)
    automatic: { type: Boolean, default: false }, // true = created by the plan-renewal reminder job
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

checkoutSchema.index({ orgId: 1, status: 1 });
checkoutSchema.index({ providerLinkId: 1 });

export const SubscriptionCheckout = model<CheckoutDoc>('SubscriptionCheckout', checkoutSchema);
