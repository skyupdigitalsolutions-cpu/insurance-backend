import { Types } from 'mongoose';
import { badRequest, notFound } from '../../lib/errors.js';
import type { AuthContext } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';
import { sms } from '../auth/sms.js';
import { Organization } from '../orgs/organization.model.js';
import { Subscription } from '../subscription/subscription.model.js';
import { User, type UserDoc } from '../users/user.model.js';

const TRIAL_DAYS = 14;

const toRegistration = (u: UserDoc, org?: { name: string; irdaiNumber?: string | null }) => ({
  userId: u._id.toString(),
  name: u.name,
  email: u.email ?? null,
  mobile: u.mobile,
  irdaiNumber: org?.irdaiNumber ?? null,
  status: u.status,
  registeredAt: u.createdAt,
  mobileVerifiedAt: u.mobileVerifiedAt ?? null,
});

export async function listRegistrations(query: { status: string; page: number; limit: number }) {
  const filter = { status: query.status, isPlatformAdmin: { $ne: true } };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(((query?.page ?? 1) - 1) * (query?.limit ?? 20)).limit(query?.limit ?? 20).lean<UserDoc[]>(),
    User.countDocuments(filter),
  ]);
  const orgIds = users.map((u) => u.orgId).filter((id): id is Types.ObjectId => !!id);
  const orgs = await Organization.find({ _id: { $in: orgIds } }).lean();
  const orgMap = new Map(orgs.map((o) => [o._id.toString(), o]));
  return {
    items: users.map((u) => toRegistration(u, u.orgId ? orgMap.get(u.orgId.toString()) : undefined)),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function approveRegistration(auth: AuthContext, userId: string) {
  const user = await User.findOne({ _id: userId, status: 'PENDING_VERIFICATION' }).lean<UserDoc>();
  if (!user) throw notFound('Registration not found or already processed');

  await User.updateOne({ _id: userId }, { $set: { status: 'ACTIVE' } });

  // Start a free trial subscription for the org
  if (user.orgId) {
    const now = new Date();
    await Subscription.updateOne(
      { orgId: user.orgId },
      {
        $setOnInsert: {
          planId: 'trial',
          status: 'TRIAL',
          cycle: 'monthly',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
          autoRenew: false,
          trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
        },
      },
      { upsert: true },
    );
  }

  await audit({ orgId: null, actorUserId: auth.userId, action: 'registration.approved', entity: 'User', entityId: new Types.ObjectId(userId) });
  await sms.send(user.mobile, 'account_approved', {});
}

export async function rejectRegistration(auth: AuthContext, userId: string, reason: string) {
  const user = await User.findOne({ _id: userId, status: 'PENDING_VERIFICATION' }).lean<UserDoc>();
  if (!user) throw notFound('Registration not found or already processed');
  if (!reason?.trim()) throw badRequest('A reason is required to reject a registration.', 'REASON_REQUIRED');

  await User.updateOne({ _id: userId }, { $set: { status: 'REJECTED', rejectionReason: reason.trim() } });
  await audit({ orgId: null, actorUserId: auth.userId, action: 'registration.rejected', entity: 'User', entityId: new Types.ObjectId(userId), meta: { reason } });
}


