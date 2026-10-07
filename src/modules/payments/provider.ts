import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface CreateLinkInput {
  referenceId: string;
  amountRupees: number;
  description: string;
  customer: { name: string; mobile: string; email: string | null };
  expiresAt: Date;
}

export type CreatedLink = { linkId: string; url: string };
// Current state of a link at the provider (used by the reconciliation job if a webhook was missed)
export type LinkState = { status: 'open' | 'paid' | 'expired' | 'cancelled'; amountPaidPaise: number; transactionRef?: string };

export interface PaymentProvider {
  name: 'mock' | 'razorpay';
  createLink(input: CreateLinkInput): Promise<CreatedLink>;
  fetchLink(linkId: string): Promise<LinkState | null>; // null = this provider has nothing to reconcile
}

// ─── Mock provider (practice checkout page) ──────────────────────────────────

class MockPaymentProvider implements PaymentProvider {
  name = 'mock' as const;

  createLink(input: CreateLinkInput): Promise<CreatedLink> {
    const linkId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return Promise.resolve({ linkId, url: `${env.PUBLIC_BASE_URL}/pay/${linkId}` });
  }

  fetchLink(): Promise<LinkState | null> {
    return Promise.resolve(null); // the practice page reports results directly; nothing can be missed
  }
}

// ─── Razorpay ────────────────────────────────────────────────────────────────

class RazorpayProvider implements PaymentProvider {
  name = 'razorpay' as const;

  private get auth(): string {
    return Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  }

  async createLink(input: CreateLinkInput): Promise<CreatedLink> {
    const res = await fetch(`${env.RAZORPAY_API_BASE}/v1/payment_links`, {
      method: 'POST',
      headers: { Authorization: `Basic ${this.auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(input.amountRupees * 100),
        currency: 'INR',
        description: input.description,
        reference_id: input.referenceId,
        expire_by: Math.floor(input.expiresAt.getTime() / 1000),
        notify: { sms: false, email: false },
        reminder_enable: false,
        customer: {
          name: input.customer.name,
          contact: input.customer.mobile,
          ...(input.customer.email ? { email: input.customer.email } : {}),
        },
        callback_url: `${env.PUBLIC_BASE_URL}/api/v1/webhooks/razorpay`,
        callback_method: 'get',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { description?: string } };
      throw new Error(`Razorpay createLink failed: ${err.error?.description ?? res.status}`);
    }
    const body = (await res.json()) as { id: string; short_url: string };
    logger.info({ referenceId: input.referenceId, linkId: body.id }, 'Razorpay payment link created');
    return { linkId: body.id, url: body.short_url };
  }

  async fetchLink(linkId: string): Promise<LinkState | null> {
    const res = await fetch(`${env.RAZORPAY_API_BASE}/v1/payment_links/${encodeURIComponent(linkId)}`, {
      headers: { Authorization: `Basic ${this.auth}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Razorpay returned ${res.status} for ${linkId}`);
    const body = (await res.json()) as { status?: string; amount_paid?: number; payments?: { payment_id?: string; status?: string }[] | null };
    const status = body.status === 'paid' ? 'paid' : body.status === 'expired' ? 'expired' : body.status === 'cancelled' ? 'cancelled' : 'open';
    const captured = body.payments?.find((p) => p.status === 'captured') ?? body.payments?.[0];
    return { status, amountPaidPaise: body.amount_paid ?? 0, ...(captured?.payment_id ? { transactionRef: captured.payment_id } : {}) };
  }
}

export const paymentProvider: PaymentProvider =
  env.PAYMENT_PROVIDER === 'razorpay' ? new RazorpayProvider() : new MockPaymentProvider();
