import type { Types } from 'mongoose';
import { startOfIndianDay, todayInIndia } from '../../lib/dates.js';
import type { AuthContext } from '../../middleware/auth.js';
import { Customer } from '../customers/customer.model.js';
import { CustomerDocument } from '../documents/document.model.js';
import { Lead } from '../leads/lead.model.js';
import { Payment } from '../payments/payment.model.js';
import { Policy } from '../policies/policy.model.js';
import { Quotation } from '../quotations/quotation.model.js';
import { listRenewals } from '../renewals/renewals.service.js';
import { Task } from '../tasks/task.model.js';

export type DateRange = 'today' | '7d' | '30d' | 'month';

function rangeStart(range: DateRange): Date {
  const today = todayInIndia();
  if (range === '7d') return startOfIndianDay(todayInIndia(-6));
  if (range === '30d') return startOfIndianDay(todayInIndia(-29));
  if (range === 'month') return startOfIndianDay(today.slice(0, 8) + '01');
  return startOfIndianDay(today);
}

export async function dashboardSummary(auth: AuthContext, orgId: Types.ObjectId, range: DateRange) {
  const from = rangeStart(range);
  const since = (field: string) => ({ [field]: { $gte: from } });
  const [totalLeads, quotes, paid, activeCustomers] = await Promise.all([
    Lead.countDocuments({ orgId, ...since('createdAt') }),
    Quotation.countDocuments({ orgId, ...since('createdAt') }),
    Payment.countDocuments({ orgId, status: 'SUCCESS', ...since('paidAt') }),
    Customer.countDocuments({ orgId }),
  ]);
  let renewalsDue = 0;
  try {
    const r = await listRenewals(auth, orgId);
    renewalsDue = (r.items as any[]).filter((x: any) => x.status !== 'Renewed' && x.status !== 'Closed').length;
  } catch {}
  return { totalLeads, quotes, paid, activeCustomers, renewalsDue };
}

type Pending = {
  id: string; type: string; title: string; customerName: string;
  dueLabel: string; isOverdue: boolean; target: string; targetId: string;
};

export async function pendingActions(orgId: Types.ObjectId, limit: number) {
  const endOfToday = startOfIndianDay(todayInIndia(1));
  const startOfToday = startOfIndianDay(todayInIndia());
  const [failed, toIssue, docs, tasks] = await Promise.all([
    Payment.find({ orgId, status: 'FAILED' }).sort({ updatedAt: -1 }).limit(10).lean(),
    Policy.find({ orgId, status: 'PENDING_ISSUANCE' }).sort({ createdAt: 1 }).limit(10).lean(),
    CustomerDocument.find({ orgId, status: 'Review Required' }).sort({ createdAt: 1 }).limit(10).lean(),
    Task.find({ orgId, done: false, due: { $lt: endOfToday } }).sort({ due: 1 }).limit(10).lean(),
  ]);
  const docCustomers = new Map(
    (await Customer.find({ _id: { $in: docs.map((d) => d.customerId) } }).select('name').lean())
      .map((c) => [c._id.toString(), c.name]),
  );
  const items: Pending[] = [
    ...failed.map((p): Pending => ({ id: p._id.toString(), type: 'payment', title: 'Payment failed', customerName: (p as any).customerName ?? '', dueLabel: 'Retry', isOverdue: true, target: 'payment', targetId: p._id.toString() })),
    ...tasks.filter((t) => t.due < startOfToday).map((t): Pending => ({ id: t._id.toString(), type: 'followup', title: t.title, customerName: (t as any).relatedTo ?? '', dueLabel: 'Overdue', isOverdue: true, target: 'task', targetId: t._id.toString() })),
    ...toIssue.map((p): Pending => ({ id: p._id.toString(), type: 'issuance', title: 'Policy ready to issue', customerName: (p as any).customerName ?? '', dueLabel: 'Issue', isOverdue: false, target: 'policy', targetId: p._id.toString() })),
    ...docs.map((d): Pending => ({ id: d._id.toString(), type: 'document', title: 'Document review required', customerName: docCustomers.get(d.customerId.toString()) ?? '', dueLabel: 'Review', isOverdue: false, target: 'customer', targetId: d.customerId.toString() })),
    ...tasks.filter((t) => t.due >= startOfToday).map((t): Pending => ({ id: t._id.toString(), type: 'followup', title: t.title, customerName: (t as any).relatedTo ?? '', dueLabel: 'Today', isOverdue: false, target: 'task', targetId: t._id.toString() })),
  ];
  return { items: items.slice(0, limit) };
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—');

export async function kpiReport(orgId: Types.ObjectId) {
  const [totalLeads, quotes, paid, issued] = await Promise.all([
    Lead.countDocuments({ orgId }),
    Quotation.countDocuments({ orgId }),
    Payment.countDocuments({ orgId, status: 'SUCCESS' }),
    Policy.countDocuments({ orgId, status: 'ACTIVE', source: { $ne: 'IMPORTED' } }),
  ]);
  return {
    funnel: [
      { label: 'Leads', value: totalLeads },
      { label: 'Quotes', value: quotes },
      { label: 'Paid', value: paid },
      { label: 'Policies', value: issued },
    ],
    rates: [
      { label: 'Quote rate', value: pct(quotes, totalLeads), formula: 'Quotes / Leads' },
      { label: 'Payment conversion', value: pct(paid, quotes), formula: 'Paid / Quotes' },
      { label: 'Lead-to-policy', value: pct(issued, totalLeads), formula: 'Policies / Leads' },
    ],
  };
}
