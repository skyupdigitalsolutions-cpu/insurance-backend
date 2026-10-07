import bcrypt from 'bcryptjs';
import type { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { randomToken, sha256 } from '../../lib/crypto.js';
import { AppError, forbidden, unauthorized } from '../../lib/errors.js';
import type { AuthContext } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';
import { User, type UserDoc } from '../users/user.model.js';
import { Session } from './session.model.js';
import { signAccessToken } from './tokens.js';
export const BCRYPT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;
const REFRESH_GRACE_MS = 30_000;
const INVALID_LOGIN = 'Email/mobile or password is incorrect';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);
export type ClientInfo = { ip?: string | null; userAgent?: string | null; requestId?: string | null };
export type TokenPair  = { accessToken: string; refreshToken: string; tokenType: 'Bearer'; expiresIn: number };
export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
function identifierFilter(identifier: string) {
  const v = identifier.trim().toLowerCase().replace(/[\s-]/g, '');
  if (v.includes('@')) return { email: v };
  return { mobile: v.startsWith('+91') ? v : `+91${v}` };
}
function assertCanLogIn(user: Pick<UserDoc, 'status'>): void {
  switch (user.status) {
    case 'ACTIVE': return;
    case 'PENDING_OTP':           throw forbidden('Please verify your mobile number to finish registration.', 'ACCOUNT_PENDING_OTP');
    case 'PENDING_VERIFICATION':  throw forbidden('Your registration is pending verification. You can log in once it is approved.', 'ACCOUNT_PENDING_VERIFICATION');
    case 'REJECTED':              throw forbidden('Your registration was not approved. Please contact support.', 'ACCOUNT_REJECTED');
    case 'INACTIVE':              throw forbidden('This account is inactive. Contact your advisor.', 'ACCOUNT_INACTIVE');
  }
}
async function createSession(userId: Types.ObjectId, client: ClientInfo): Promise<TokenPair> {
  const refreshToken = randomToken();
  const session = await Session.create({
    userId, refreshTokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + (env.REFRESH_TOKEN_TTL_DAYS ?? 30) * 86_400_000),
    ip: client.ip ?? null, userAgent: client.userAgent?.slice(0, 300) ?? null,
  });
  return { accessToken: signAccessToken(userId, session._id), refreshToken, tokenType: 'Bearer', expiresIn: env.ACCESS_TOKEN_TTL_SEC };
}
export async function login(identifier: string, password: string, client: ClientInfo) {
  const user = await User.findOne(identifierFilter(identifier)).select('+passwordHash').lean();
  const ok   = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized(INVALID_LOGIN, 'INVALID_CREDENTIALS');
  assertCanLogIn(user);
  const tokens = await createSession(user._id, client);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  await audit({ orgId: user.orgId, actorUserId: user._id, action: 'auth.login', entity: 'User', entityId: user._id, ip: client.ip, requestId: client.requestId });
  return { ...tokens, mustChangePassword: user.mustChangePassword };
}
export async function refresh(refreshToken: string, client: ClientInfo): Promise<TokenPair> {
  const hash = sha256(refreshToken);
  const newRefreshToken = randomToken();
  const now  = new Date();
  const session = await Session.findOneAndUpdate(
    { refreshTokenHash: hash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { previousTokenHash: hash, refreshTokenHash: sha256(newRefreshToken), rotatedAt: now, lastUsedAt: now, ip: client.ip ?? null } },
    { returnDocument: 'after' },
  ).lean();
  if (!session) {
    const previous = await Session.findOne({ previousTokenHash: hash, revokedAt: null }).lean();
    if (previous?.rotatedAt && now.getTime() - previous.rotatedAt.getTime() < REFRESH_GRACE_MS) {
      throw new AppError(401, 'REFRESH_IN_PROGRESS', 'Session expired. Please log in again.');
    }
    if (previous) {
      await Session.updateOne({ _id: previous._id }, { $set: { revokedAt: now, revokedReason: 'REFRESH_TOKEN_REUSE' } });
      await audit({ actorUserId: previous.userId, action: 'auth.refresh_reuse_detected', entity: 'Session', entityId: previous._id, ip: client.ip, requestId: client.requestId });
    }
    throw unauthorized();
  }
  const user = await User.findById(session.userId).lean();
  if (!user || user.status !== 'ACTIVE') {
    await Session.updateOne({ _id: session._id }, { $set: { revokedAt: now, revokedReason: 'USER_NOT_ACTIVE' } });
    throw unauthorized();
  }
  return { accessToken: signAccessToken(user._id, session._id), refreshToken: newRefreshToken, tokenType: 'Bearer', expiresIn: env.ACCESS_TOKEN_TTL_SEC };
}
export async function logout(auth: AuthContext): Promise<void> {
  await Session.updateOne({ _id: auth.sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'LOGOUT' } });
}
export async function revokeAllSessions(userId: Types.ObjectId, reason: string, exceptSessionId?: Types.ObjectId): Promise<void> {
  await Session.updateMany(
    { userId, revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}
export async function changePassword(auth: AuthContext, currentPassword: string, newPwd: string, client: ClientInfo): Promise<void> {
  const user = await User.findById(auth.userId).select('+passwordHash').lean();
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect.');
  if (currentPassword === newPwd) throw new AppError(400, 'SAME_PASSWORD', 'New password must be different from the current one.');
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPwd), mustChangePassword: false } });
  await revokeAllSessions(user._id, 'PASSWORD_CHANGED', auth.sessionId);
  await audit({ orgId: user.orgId, actorUserId: user._id, action: 'auth.password_change', entity: 'User', entityId: user._id, ip: client.ip, requestId: client.requestId });
}
export const toMe = (auth: AuthContext) => ({
  id: auth.userId.toString(), name: auth.name, email: auth.email, mobile: auth.mobile,
  roleName: auth.roleName, permissions: auth.permissions, orgId: auth.orgId?.toString() ?? null,
  isPlatformAdmin: auth.isPlatformAdmin, mustChangePassword: auth.mustChangePassword,
});
