import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { formatDate, indianDateOf } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import type { AuthContext } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';
import { sms } from '../auth/sms.js';
import { claimReminder } from '../jobs/reminderLog.model.js';
import { Organization } from '../orgs/organization.model.js';
import { paymentProvider } from '../payments/provider.js';
import { User } from '../users/user.model.js';
import { planById, PLANS, type FeatureKey, type Plan as PlanDef } from './plans.js';
import { Subscription, SubscriptionCheckout, type BillingCycle, type CheckoutDoc, type Plan, type SubscriptionDoc } from './subscription.model.js';

const DAY = 86_400_000;
const GRACE_DAYS = 3;
const SUBSCRIPTION_GST_RATE = 0.18;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toCheckout = (c: CheckoutDoc) => ({
  id: c._id.toString(),
  orgId: c.orgId.toString(),
  planId: c.planId,
  cycle: c.cycle,
  amount: c.amount,
  gst: c.gst,
  total: c.total,
  url: c.url,
  status: c.status,
});

// Creates a plan payment link for the account owner (used by the app and by the renewal reminder job)
async function createCheckout(input: {
  orgId: Types.ObjectId; ownerUserId: Types.ObjectId; plan: PlanDef; cycle: BillingCycle; expiresAt: Date; automatic: boolean;
}): Promise<CheckoutDoc> {
  const { orgId, plan, cycle } = input;
  const planId = plan.id;
  if (planId === 'trial') throw badRequest('Choose a paid plan.', 'INVALID_PLAN');
  const amount = cycle === 'monthly' ? plan.monthly : plan.yearly;
  const gst = Math.round(amount * SUBSCRIPTION_GST_RATE);
  const owner = await User.findById(input.ownerUserId).lean();
  if (!owner) throw notFound('Account owner not found');
  const checkoutId = new Types.ObjectId();
  const link = await paymentProvider.createLink({
    referenceId: checkoutId.toString(),
    amountRupees: amount + gst,
    description: `Insurance Advisor ${plan.name} plan (${cycle}) incl. 18% GST`,
    customer: { name: owner.name, mobile: owner.mobile, email: owner.email ?? null },
    expiresAt: input.expiresAt,
  });
  const c = await SubscriptionCheckout.create({
    _id: checkoutId, orgId, ownerUserId: owner._id, planId, cycle, amount, gst, total: amount + gst,
    provider: paymentProvider.name, providerLinkId: link.linkId, url: link.url, expiresAt: input.expiresAt, automatic: input.automatic,
  });
  return c.toObject<CheckoutDoc>();
}

// ─── Feature check ───────────────────────────────────────────────────────────

export async function featuresOf(orgId: Types.ObjectId): Promise<{ plan: PlanDef | null; status: string; features: FeatureKey[] }> {
  const sub = await Subscription.findOne({ orgId }).lean<SubscriptionDoc>();
  if (!sub) return { plan: null, status: 'NONE', features: [] };
  const plan = planById(sub.planId);
  if (!plan) return { plan: null, status: sub.status, features: [] };
  const graceMs = sub.status === 'TRIAL' ? 0 : GRACE_DAYS * DAY;
  const active = sub.currentPeriodEnd.getTime() + graceMs >= Date.now();
  if (!active) return { plan, status: 'EXPIRED', features: [] };
  return { plan, status: sub.status, features: plan.features };
}

// ─── App-facing: start a checkout ────────────────────────────────────────────

export async function startCheckout(auth: AuthContext, orgId: Types.ObjectId, planId: string, cycle: BillingCycle) {
  const plan = planById(planId as Plan);
  if (!plan || plan.id === 'trial') throw badRequest('Choose a paid plan.', 'INVALID_PLAN');
  const c = await createCheckout({ orgId, ownerUserId: auth.userId, plan, cycle, expiresAt: new Date(Date.now() + DAY), automatic: false });
  return toCheckout(c);
}

export async function applyCheckoutResult(input: {
  providerLinkId: string; outcome: 'PAID' | 'FAILED'; amountPaise?: number;
}): Promise<'applied' | 'ignored'> {
  const checkout = await SubscriptionCheckout.findOne({ providerLinkId: input.providerLinkId }).lean<CheckoutDoc>();
  if (!checkout || checkout.status !== 'PENDING') return 'ignored';

  if (input.outcome === 'PAID') {
    await SubscriptionCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'SUCCESS', paidAt: new Date() } });
    const plan = planById(checkout.planId);
    if (!plan) return 'ignored';
    const sub = await Subscription.findOne({ orgId: checkout.orgId }).lean<SubscriptionDoc>();
    const periodStart = sub?.currentPeriodEnd && sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
    const periodEnd = new Date(periodStart.getTime() + (checkout.cycle === 'monthly' ? 30 : 365) * DAY);
    await Subscription.updateOne(
      { orgId: checkout.orgId },
      { $set: { planId: checkout.planId, status: 'ACTIVE', cycle: checkout.cycle, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } },
      { upsert: true },
    );
    await audit({ orgId: checkout.orgId, action: 'subscription.activated', entity: 'SubscriptionCheckout', entityId: checkout._id, meta: { planId: checkout.planId, cycle: checkout.cycle, total: checkout.total } });
    return 'applied';
  }

  await SubscriptionCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'FAILED' } });
  return 'applied';
}

export async function getSubscription(orgId: Types.ObjectId) {
  const [sub, pending] = await Promise.all([
    Subscription.findOne({ orgId }).lean<SubscriptionDoc>(),
    SubscriptionCheckout.findOne({ orgId, status: 'PENDING' }).sort({ createdAt: -1 }).lean<CheckoutDoc>(),
  ]);
  const { plan, status, features } = await featuresOf(orgId);
  return {
    planId: sub?.planId ?? 'trial',
    planName: plan?.name ?? 'Trial',
    status,
    cycle: sub?.cycle ?? 'monthly',
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    autoRenew: sub?.autoRenew ?? true,
    features,
    pendingCheckout: pending ? toCheckout(pending) : null,
  };
}

export async function updateAutoRenew(orgId: Types.ObjectId, autoRenew: boolean) {
  await Subscription.updateOne({ orgId }, { $set: { autoRenew } });
}

// ─── Background jobs ─────────────────────────────────────────────────────────

// Daily: paid plans with auto-renew get a payment link by SMS a few days before the renewal date;
// trials get a "your trial ends on …" SMS. Each reminder is sent once (ReminderLog key).
export async function runPlanReminders(now = new Date()) {
  const until = new Date(now.getTime() + env.PLAN_REMINDER_DAYS * DAY);
  const subs = await Subscription.find({ status: { $in: ['ACTIVE', 'TRIAL'] }, currentPeriodEnd: { $gt: now, $lte: until } }).lean<SubscriptionDoc[]>();
  const result = { renewalLinks: 0, trialReminders: 0, skipped: 0 };
  for (const s of subs) {
    const org = await Organization.findById(s.orgId).lean();
    const owner = org?.ownerUserId ? await User.findById(org.ownerUserId).lean() : null;
    const plan = planById(s.planId);
    if (!owner || owner.status !== 'ACTIVE' || !plan) { result.skipped += 1; continue; }
    const date = formatDate(indianDateOf(s.currentPeriodEnd));

    if (s.status === 'TRIAL') {
      if (!(await claimReminder(`trial:${s._id.toString()}`, s.orgId, 'trial', 'sms'))) continue;
      await sms.send(owner.mobile, 'trial_ending', { date });
      result.trialReminders += 1;
      continue;
    }
    if (!s.autoRenew) continue; // the owner switched reminders off
    if (!(await claimReminder(`plan:${s._id.toString()}:${indianDateOf(s.currentPeriodEnd)}`, s.orgId, 'plan', 'sms'))) continue;
    // The link keeps working through the grace days after the renewal date
    const c = await createCheckout({
      orgId: s.orgId, ownerUserId: owner._id, plan, cycle: s.cycle, automatic: true,
      expiresAt: new Date(s.currentPeriodEnd.getTime() + GRACE_DAYS * DAY),
    });
    await sms.send(owner.mobile, 'plan_renewal', { plan: plan.name, date, link: c.url });
    await audit({ orgId: s.orgId, action: 'subscription.renewal_link', entity: 'SubscriptionCheckout', entityId: c._id, meta: { planId: plan.id, cycle: s.cycle, total: c.total } });
    result.renewalLinks += 1;
  }
  return result;
}

// Plan payment links that ran out without payment
export async function expireCheckouts(now = new Date()) {
  const r = await SubscriptionCheckout.updateMany(
    { status: 'PENDING', $or: [{ expiresAt: { $lt: now } }, { expiresAt: null, createdAt: { $lt: new Date(now.getTime() - DAY) } }] },
    { $set: { status: 'FAILED' } },
  );
  return r.modifiedCount;
}

// ─── Helpers for Parts 1-4 compatibility ─────────────────────────────────────

const TRIAL_DAYS = 14;

export async function createTrial(orgId: Types.ObjectId, start = new Date()): Promise<void> {
  await Subscription.updateOne(
    { orgId },
    {
      $setOnInsert: {
        planId: 'trial', cycle: 'monthly', status: 'TRIAL',
        currentPeriodEnd: new Date(start.getTime() + TRIAL_DAYS * 86_400_000),
        autoRenew: false,
      },
    },
    { upsert: true },
  );
}

export async function requireFeature(orgId: Types.ObjectId, feature: string): Promise<void> {
  const { features, status } = await featuresOf(orgId);
  if (!features.includes(feature as any)) {
    const { forbidden } = await import('../../lib/errors.js');
    throw forbidden(
      status === 'EXPIRED'
        ? 'Your plan has expired. Renew it in Subscription to continue.'
        : `Your current plan does not include ${feature}. Upgrade to Pro to use it.`,
      'PLAN_FEATURE_MISSING',
    );
  }
}

export async function assertSeatAvailable(orgId: Types.ObjectId): Promise<void> {
  const { plan, status } = await featuresOf(orgId);
  if (status === 'EXPIRED') {
    const { forbidden } = await import('../../lib/errors.js');
    throw forbidden('Your plan has expired.', 'PLAN_EXPIRED');
  }
  const { User } = await import('../users/user.model.js');
  const active = await User.countDocuments({ orgId, status: 'ACTIVE' });
  if (plan && active >= plan.users) {
    const { forbidden } = await import('../../lib/errors.js');
    throw forbidden(`Your plan allows ${plan.users} user${plan.users === 1 ? '' : 's'}. Upgrade to add more.`, 'USER_LIMIT');
  }
}

// -- Aliases for subscription.routes.ts compatibility --
export const listPlans = () => ({ items: PLANS });
export const mySubscription = getSubscription;
export const setAutoRenew = updateAutoRenew;

export async function getCheckout(orgId: Types.ObjectId, checkoutId: string) {
  const { SubscriptionCheckout } = await import('./subscription.model.js');
  const c = await SubscriptionCheckout.findOne({ _id: checkoutId, orgId }).lean();
  if (!c) { const { notFound } = await import('../../lib/errors.js'); throw notFound('Checkout not found'); }
  return { checkoutId: c._id.toString(), planName: c.planId, cycle: c.cycle, amount: c.amount, gst: c.gst, total: c.total, url: c.url, status: c.status };
}
