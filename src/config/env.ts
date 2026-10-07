import { z } from 'zod';

const booleanString = z
  .string()
  .transform((v) => v === 'true');

// An empty value in .env ("S3_ENDPOINT=") means "not set"
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),

    MONGODB_URI: z.string().url(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_EXPIRY: z.string().default('30d'),

    OTP_SECRET: z.string().min(16),
    OTP_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(60).default(5),
    OTP_FIXED_CODE: z.string().optional(), // staging only: 6-digit fixed OTP for testers

    FILE_URL_SECRET: z.string().min(16),
    FILE_URL_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(86_400).default(300),
    UPLOADS_DIR: z.string().default('./uploads'),

    PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
    CORS_ORIGINS: z.string().default('http://localhost:5174'),

    API_DOCS_ENABLED: booleanString.default('true'),

    // SMS (OTP, account messages). "console" prints to the log; "msg91" sends real SMS (DLT-registered templates)
    SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
    MSG91_AUTH_KEY: z.string().optional(),
    // MSG91 template id of each SMS kind (each one linked to its DLT template), e.g. "otp=65f0…,account_approved=65f1…"
    MSG91_TEMPLATE_IDS: z.string().default(''),
    MSG91_API_BASE: z.string().url().default('https://control.msg91.com'),

    // Customer messages. "console" prints to the log; "meta" = WhatsApp Cloud API; "smtp" = real email
    WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_API_BASE: z.string().url().default('https://graph.facebook.com/v21.0'),
    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    SMTP_URL: z.string().optional(), // smtps://user:password@smtp.example.com:465
    EMAIL_FROM: z.string().default('Insurance Advisor <no-reply@example.com>'),

    // Uploaded customer documents. "local" = a folder on this server (development/staging);
    // "s3" = a private bucket on AWS S3, Cloudflare R2 or any S3-compatible storage (production).
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('ap-south-1'), // Mumbai; use "auto" for Cloudflare R2
    S3_ENDPOINT: optionalUrl,                      // only for R2 / other S3-compatible storage
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    // Payments
    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    RAZORPAY_API_BASE: z.string().url().default('https://api.razorpay.com'),

    // Quotations
    QUOTE_VALIDITY_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    // Background jobs (the worker process)
    RENEWAL_REMINDER_DAYS: z
      .string()
      .default('30,7,1')
      .transform((v) => [...new Set(v.split(',').map((d) => Number(d.trim())))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 90)),
    PAYMENT_REMINDER_AFTER_HOURS: z.coerce.number().int().min(1).max(24 * 7).default(24),
    PLAN_REMINDER_DAYS: z.coerce.number().int().min(1).max(15).default(3),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'console') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'A real SMS provider is required in production (use NODE_ENV=staging until it is added)',
      });
    }
    const need = (when: boolean, keys: readonly (keyof typeof env)[], what: string) => {
      if (!when) return;
      for (const key of keys) if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when ${what}` });
    };
    need(env.SMS_PROVIDER === 'msg91', ['MSG91_AUTH_KEY', 'MSG91_TEMPLATE_IDS'], 'SMS_PROVIDER=msg91');
    need(env.WHATSAPP_PROVIDER === 'meta', ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'], 'WHATSAPP_PROVIDER=meta');
    need(env.EMAIL_PROVIDER === 'smtp', ['SMTP_URL'], 'EMAIL_PROVIDER=smtp');
    need(env.STORAGE_DRIVER === 's3', ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'], 'STORAGE_DRIVER=s3');

    if (env.PAYMENT_PROVIDER === 'razorpay') {
      for (const key of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when PAYMENT_PROVIDER=razorpay` });
      }
    }
    for (const [key, value] of [['WHATSAPP_PROVIDER', env.WHATSAPP_PROVIDER], ['EMAIL_PROVIDER', env.EMAIL_PROVIDER]] as const) {
      if (env.NODE_ENV === 'production' && value === 'console') {
        ctx.addIssue({ code: 'custom', path: [key], message: `A real ${key === 'EMAIL_PROVIDER' ? 'email' : 'WhatsApp'} provider is required in production (use NODE_ENV=staging until it is added)` });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌  Invalid environment variables:\n', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env: Env = parsed.data;
