import { Types } from 'mongoose';
import type { AuthContext } from '../../middleware/auth.js';
import type { PolicyDoc } from '../policies/policy.model.js';
import { Policy } from '../policies/policy.model.js';
import { RenewalState } from './renewal.model.js';

export interface RenewalView {
  policyId: string;
  policyNumber: string | null;
  productName: string;
  customerId: string;
  customerName: string;
  endDate: string | null;
  premium: number;
  status: 'Due' | 'Renewed' | 'Closed';
  closedReason: string | null;
}

// Export required so reminder jobs can call this directly
export async function buildRenewals(orgId: Types.ObjectId, policies: PolicyDoc[]): Promise<RenewalView[]> {
  const policyIds = policies.map((p) => p._id);
  const states = await RenewalState.find({ orgId, policyId: { $in: policyIds } }).lean();
  const stateMap = new Map(states.map((s) => [s.policyId.toString(), s]));

  return policies.map((p) => {
    const state = stateMap.get(p._id.toString());
    const status: RenewalView['status'] = state?.renewedPolicyId
      ? 'Renewed'
      : state?.closedReason
      ? 'Closed'
      : 'Due';
    return {
      policyId: p._id.toString(),
      policyNumber: p.policyNumber ?? null,
      productName: p.productName,
      customerId: p.customerId.toString(),
      customerName: p.customerName,
      endDate: p.endDate ?? null,
      premium: p.premium,
      status,
      closedReason: state?.closedReason ?? null,
    };
  });
}

export async function listRenewals(auth: AuthContext, orgId: Types.ObjectId) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const policies = await Policy.find({
    orgId,
    status: 'ACTIVE',
    endDate: { $gte: today, $lte: cutoff },
  })
    .sort({ endDate: 1 })
    .lean<PolicyDoc[]>();

  return { items: await buildRenewals(orgId, policies) };
}

export async function closeRenewal(auth: AuthContext, orgId: Types.ObjectId, policyId: string, reason: string) {
  const policy = await Policy.findOne({ _id: policyId, orgId }).lean<PolicyDoc>();
  if (!policy) throw new Error('Policy not found');
  await RenewalState.updateOne(
    { orgId, policyId: policy._id },
    { $set: { closedReason: reason, closedAt: new Date(), closedBy: auth.userId } },
    { upsert: true },
  );
}

// ─── Compatibility helpers for autodial and renewals routes ──────────────────

export async function getRenewal(auth: AuthContext, orgId: Types.ObjectId, policyId: string) {
  const { Policy } = await import('../policies/policy.model.js');
  const pol = Types.ObjectId.isValid(policyId) ? await Policy.findOne({ _id: policyId, orgId }).lean() : null;
  if (!pol) { const { notFound } = await import('../../lib/errors.js'); throw notFound('Policy not found'); }
  const items = await buildRenewals(orgId, [pol as any]);
  return items[0];
}

export async function logRenewalContact(auth: AuthContext, orgId: Types.ObjectId, policyId: string, outcome: string, notes?: string) {
  const { logContact } = await import('../activities/activities.service.js');
  const { Policy } = await import('../policies/policy.model.js');
  const pol = await Policy.findOne({ _id: policyId, orgId }).lean();
  if (!pol) { const { notFound } = await import('../../lib/errors.js'); throw notFound('Policy not found'); }
  await logContact({ orgId, entityType: 'Policy', entityId: pol._id, actorUserId: auth.userId, type: 'Call', outcome, notes, text: `Renewal call with ${pol.customerName}: ${outcome}` });
  return getRenewal(auth, orgId, policyId);
}
