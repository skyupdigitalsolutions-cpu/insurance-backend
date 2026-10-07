import { Types } from 'mongoose';
import { hashPassword } from '../modules/auth/auth.service.js';
import { Template } from '../modules/communications/communication.models.js';
import { Organization } from '../modules/orgs/organization.model.js';
import { Product } from '../modules/products/product.model.js';
import { Subscription } from '../modules/subscription/subscription.model.js';
import { User } from '../modules/users/user.model.js';

// waTemplateName = the same template submitted for approval in Meta WhatsApp Manager
// (its body uses {{1}}, {{2}} … in place of our placeholders, in the same order).
export const DEFAULT_TEMPLATES = [
  { name: 'Renewal reminder', event: 'Renewal', channel: 'WhatsApp', waTemplateName: 'renewal_reminder', body: 'Dear {{name}}, your policy {{policy}} is due for renewal on {{due}}. Reply YES and I will share the renewal quote.' },
  { name: 'Birthday wishes', event: 'Birthday', channel: 'WhatsApp', waTemplateName: 'birthday_wishes', body: 'Happy birthday {{name}}! Wishing you good health and happiness.' },
  { name: 'Quotation follow-up', event: 'Quotation', channel: 'Email', body: 'Dear {{name}}, following up on the quotation I shared. Happy to answer any questions.' },
  { name: 'Payment received', event: 'Payment', channel: 'Email', body: 'Dear {{name}}, we have received your payment. Your policy documents will follow shortly.' },
  // Part 5: used only by the automatic payment reminder job (not listed in the app)
  { name: 'Payment reminder', event: 'PaymentReminder', channel: 'WhatsApp', waTemplateName: 'payment_reminder', manual: false, body: 'Dear {{name}}, a gentle reminder to complete the payment of {{amount}} for quotation {{quote}}. Pay securely here: {{link}} (the link is valid for a limited time).' },
] as const;

// Adds missing company templates and fills new fields on older ones (safe to run many times)
export async function seedTemplates(): Promise<number> {
  let added = 0;
  for (const t of DEFAULT_TEMPLATES) {
    const r = await Template.updateOne(
      { orgId: null, name: t.name },
      { $setOnInsert: { ...t, orgId: null, approved: true } },
      { upsert: true },
    );
    added += r.upsertedCount;
    if ('waTemplateName' in t) await Template.updateOne({ orgId: null, name: t.name, waTemplateName: null }, { $set: { waTemplateName: t.waTemplateName } });
  }
  return added;
}

export const DEMO_PRODUCTS = [
  {
    name: 'Car Secure Comprehensive',
    companyName: 'National Insurance',
    type: 'Motor',
    basePremium: 8500,
    coverage: '₹5 lakh own damage',
    features: ['Zero depreciation', 'Roadside assistance', 'Engine protection'],
    addOns: [{ name: 'Zero Depreciation', premium: 1200 }, { name: 'Engine Protection', premium: 800 }],
    exclusions: 'Wear and tear, electrical breakdown',
    eligibility: 'Vehicles up to 5 years old',
    minAge: null,
    maxAge: null,
    source: 'National Insurance product brochure',
    active: true,
    version: 1,
  },
  {
    name: 'Family Health Shield',
    companyName: 'Star Health',
    type: 'Health',
    basePremium: 12000,
    coverage: '₹10 lakh family floater',
    features: ['Cashless at 6000+ hospitals', 'Pre & post hospitalization', 'No room rent limit'],
    addOns: [{ name: 'Critical Illness Rider', premium: 2500 }, { name: 'OPD Cover', premium: 1800 }],
    exclusions: 'Pre-existing diseases (2-year waiting period)',
    eligibility: 'Family up to 4 members',
    minAge: 18,
    maxAge: 65,
    source: 'Star Health website',
    active: true,
    version: 1,
  },
  {
    name: 'Term Life Plus',
    companyName: 'LIC of India',
    type: 'Life',
    basePremium: 6000,
    coverage: '₹1 crore sum assured',
    features: ['Pure term plan', 'Tax benefit under 80C', 'Online discount 5%'],
    addOns: [{ name: 'Accidental Death Benefit', premium: 500 }, { name: 'Waiver of Premium', premium: 300 }],
    exclusions: 'Suicide within 1 year',
    eligibility: 'Age 18–55, non-smoker',
    minAge: 18,
    maxAge: 55,
    source: 'LIC product page',
    active: true,
    version: 1,
  },
];

export async function seedDemoData(adminPassword: string, advisorPassword: string): Promise<void> {
  // Admin user
  const adminId = new Types.ObjectId();
  await User.updateOne(
    { email: 'admin@insurance.local' },
    {
      $setOnInsert: {
        _id: adminId,
        name: 'Platform Admin',
        email: 'admin@insurance.local',
        mobile: '+910000000001',
        passwordHash: await hashPassword(adminPassword),
        role: 'platform_admin',
        isPlatformAdmin: true,
        status: 'ACTIVE',
      },
    },
    { upsert: true },
  );

  // Demo advisor org + user
  const orgId = new Types.ObjectId();
  await Organization.updateOne(
    { name: 'Demo Advisory' },
    { $setOnInsert: { _id: orgId, name: 'Demo Advisory', irdaiNumber: 'DEMO12345' } },
    { upsert: true },
  );

  const advisorId = new Types.ObjectId();
  await User.updateOne(
    { email: 'advisor@insurance.local' },
    {
      $setOnInsert: {
        _id: advisorId,
        orgId,
        name: 'Demo Advisor',
        email: 'advisor@insurance.local',
        mobile: '+919000000100',
        passwordHash: await hashPassword(advisorPassword),
        role: 'owner',
        status: 'ACTIVE',
      },
    },
    { upsert: true },
  );

  await Organization.updateOne({ _id: orgId }, { $set: { ownerUserId: advisorId } });

  // Pro plan subscription for demo advisor
  const now = new Date();
  await Subscription.updateOne(
    { orgId },
    {
      $setOnInsert: {
        planId: 'pro',
        status: 'ACTIVE',
        cycle: 'monthly',
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        autoRenew: true,
      },
    },
    { upsert: true },
  );

  // Products
  for (const p of DEMO_PRODUCTS) {
    await Product.updateOne({ name: p.name }, { $setOnInsert: p }, { upsert: true });
  }
}
