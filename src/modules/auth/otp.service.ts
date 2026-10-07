import { createHmac, randomInt } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import type { UserDoc } from '../users/user.model.js';
import { sms } from './sms.js';

const OTP_LENGTH = 6;
const EXPIRY_MS = env.OTP_EXPIRY_MINUTES * 60_000;

function generateCode(): string {
  if (env.OTP_FIXED_CODE) return env.OTP_FIXED_CODE;
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

function hmacOf(mobile: string, code: string, issuedAt: number): string {
  return createHmac('sha256', env.OTP_SECRET)
    .update(`${mobile}:${code}:${issuedAt}`)
    .digest('hex');
}

export function encodeToken(mobile: string, code: string): string {
  const issuedAt = Date.now();
  const mac = hmacOf(mobile, code, issuedAt);
  return Buffer.from(JSON.stringify({ mobile, code, issuedAt, mac })).toString('base64url');
}

export function verifyToken(token: string, mobile: string): { valid: boolean; code: string } {
  try {
    const { mobile: m, code, issuedAt, mac } = JSON.parse(Buffer.from(token, 'base64url').toString()) as { mobile: string; code: string; issuedAt: number; mac: string };
    if (m !== mobile) return { valid: false, code: '' };
    if (Date.now() - issuedAt > EXPIRY_MS) return { valid: false, code: '' };
    const expected = hmacOf(mobile, code, issuedAt);
    if (mac !== expected) return { valid: false, code: '' };
    return { valid: true, code };
  } catch {
    return { valid: false, code: '' };
  }
}

export async function sendOtp(user: UserDoc): Promise<string> {
  const code = generateCode();
  const token = encodeToken(user.mobile, code);
  await sms.send(user.mobile, 'otp', { code });
  return token;
}

export function checkOtp(token: string, mobile: string, submitted: string): void {
  const { valid, code } = verifyToken(token, mobile);
  if (!valid || code !== submitted) throw new AppError(400, 'INVALID_OTP', 'The OTP is incorrect or has expired.');
}
