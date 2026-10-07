import { afterAll, beforeAll } from 'vitest';
import supertest from 'supertest';
import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/lib/mongo.js';
import { connectRedis, disconnectRedis, redis } from '../src/lib/redis.js';
import { closeJobsQueue } from '../src/jobs/queue.js';
import { app } from '../src/app.js';
import { env } from '../src/config/env.js';
import { User } from '../src/modules/users/user.model.js';
import { Organization } from '../src/modules/orgs/organization.model.js';
import { Customer } from '../src/modules/customers/customer.model.js';
import { Policy } from '../src/modules/policies/policy.model.js';
import { Product } from '../src/modules/products/product.model.js';
import { seedDemoData, seedTemplates } from '../src/scripts/demoData.js';

export const V1 = '/api/v1';
export const OTP = env.OTP_FIXED_CODE ?? '000000';

export const DEMO = {
  admin: { email: 'admin@insurance.local', password: 'Demo@1234' },
  advisor: { email: 'advisor@insurance.local', password: 'Demo@1234', name: 'Demo Advisor', mobile: '+919876543210' },
  staff: { email: 'staff@insurance.local', password: 'Demo@1234' },
};

export const api = () => supertest(app);
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function tokenOf(email: string, password = 'Demo@1234'): Promise<string> {
  const res = await api().post(`${V1}/auth/login`).send({ identifier: email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.accessToken as string;
}

export async function demoOrgId(): Promise<mongoose.Types.ObjectId> {
  const user = await User.findOne({ email: DEMO.advisor.email }).lean();
  if (!user?.orgId) throw new Error('Demo advisor org not found');
  return user.orgId;
}

export async function customerId(name: string): Promise<string> {
  const orgId = await demoOrgId();
  const c = await Customer.findOne({ orgId, name }).lean();
  if (!c) throw new Error(`Customer not found: ${name}`);
  return c._id.toString();
}

export async function productId(name: string): Promise<string> {
  const p = await Product.findOne({ name }).lean();
  if (!p) throw new Error(`Product not found: ${name}`);
  return p._id.toString();
}

export async function setDemoPlan(planId: string, opts: { expired?: boolean } = {}) {
  const orgId = await demoOrgId();
  const now = new Date();
  const end = opts.expired ? new Date(now.getTime() - 86_400_000) : new Date(now.getTime() + 30 * 86_400_000);
  const { Subscription } = await import('../src/modules/subscription/subscription.model.js');
  await Subscription.updateOne(
    { orgId },
    { $set: { planId, status: opts.expired ? 'EXPIRED' : 'ACTIVE', currentPeriodEnd: end } },
    { upsert: true },
  );
}

export async function registerAdvisor(opts: { verify?: boolean; approve?: boolean } = {}) {
  const mobile = `+91${Math.floor(7_000_000_000 + Math.random() * 999_999_999)}`;
  const input = { name: 'Test Advisor', mobile, email: `test${Date.now()}@example.com`, password: 'Test@1234', agencyName: 'Test Agency' };
  const reg = await api().post(`${V1}/auth/register`).send(input);
  if (reg.status !== 201) throw new Error(`Register failed: ${JSON.stringify(reg.body)}`);
  const challenge = reg.body as { userId: string; otpToken: string };

  if (opts.verify || opts.approve) {
    const verify = await api().post(`${V1}/auth/verify-otp`).send({ userId: challenge.userId, otpToken: challenge.otpToken, code: OTP });
    if (verify.status !== 200) throw new Error(`OTP verify failed: ${JSON.stringify(verify.body)}`);
  }

  if (opts.approve) {
    const adminToken = await tokenOf(DEMO.admin.email);
    const approve = await api().post(`${V1}/admin/registrations/${challenge.userId}/approve`).set(bearer(adminToken));
    if (approve.status !== 200) throw new Error(`Approve failed: ${JSON.stringify(approve.body)}`);
  }

  return { input, challenge };
}

export async function resetDatabase(): Promise<void> {
  await connectMongo();
  await connectRedis();

  // Drop all collections
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));

  // Flush Redis
  await redis.flushdb();

  // Seed
  await seedTemplates();
  await seedDemoData('Demo@1234', 'Demo@1234');

  // Seed demo customers and policies for tests
  const orgId = await demoOrgId();
  const advisorUser = await User.findOne({ email: DEMO.advisor.email }).lean();

  await Customer.insertMany([
    { orgId, name: 'Ravi Kumar', mobile: '+919876543210', email: 'ravi@example.com', dob: '1986-04-15', consentGiven: true, createdBy: advisorUser!._id },
    { orgId, name: 'Sneha Rao', mobile: '+919876543211', email: null, dob: '1990-07-20', consentGiven: false, createdBy: advisorUser!._id },
  ]);

  const products = await Product.find({}).lean();
  const raviCustomer = await Customer.findOne({ orgId, name: 'Ravi Kumar' }).lean();
  const snehaCustomer = await Customer.findOne({ orgId, name: 'Sneha Rao' }).lean();
  const product = products[0]!;

  await Policy.insertMany([
    { orgId, policyNumber: 'POL-2025-00418', customerId: raviCustomer!._id, customerName: 'Ravi Kumar', productId: product._id.toString(), productName: product.name, companyName: product.companyName, premium: 8500, status: 'ACTIVE', startDate: '2025-01-01', endDate: '2026-04-15', createdBy: advisorUser!._id },
    { orgId, policyNumber: 'POL-2025-01127', customerId: snehaCustomer!._id, customerName: 'Sneha Rao', productId: product._id.toString(), productName: product.name, companyName: product.companyName, premium: 12000, status: 'ACTIVE', startDate: '2025-01-01', endDate: '2026-04-15', createdBy: advisorUser!._id },
    { orgId, policyNumber: 'POL-2025-00090', customerId: raviCustomer!._id, customerName: 'Ravi Kumar', productId: product._id.toString(), productName: product.name, companyName: product.companyName, premium: 6000, status: 'ACTIVE', startDate: '2024-01-01', endDate: '2026-04-15', createdBy: advisorUser!._id },
  ]);
}

export async function closeConnections(): Promise<void> {
  await closeJobsQueue();
  await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
}
