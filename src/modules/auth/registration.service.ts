import { Types } from 'mongoose';
import { conflict, notFound } from '../../lib/errors.js';
import { maskMobile } from '../../lib/validators.js';
import { isDuplicateKeyError } from '../../middleware/error.js';
import { audit } from '../audit/audit.service.js';
import { Organization } from '../orgs/organization.model.js';
import { createDefaultRoles } from '../roles/roles.service.js';
import { Role } from '../roles/role.model.js';
import { User } from '../users/user.model.js';
import { hashPassword, type ClientInfo } from './auth.service.js';
import { checkOtp, sendOtp } from './otp.service.js';

export type RegistrationInput = {
  name: string; email: string; mobile: string; password: string; irdaiNumber?: string | undefined;
};

async function deleteUnverifiedRegistration(userId: Types.ObjectId, orgId: Types.ObjectId | null) {
  await Promise.all([
    User.deleteOne({ _id: userId, status: 'PENDING_OTP' }),
    ...(orgId ? [Organization.deleteOne({ _id: orgId }), Role.deleteMany({ orgId })] : []),
  ]);
}

export async function register(input: RegistrationInput, client: ClientInfo) {
  const existing = await User.find({ $or: [{ email: input.email }, { mobile: input.mobile }] }).lean();
  for (const u of existing) {
    if (u.status !== 'PENDING_OTP') {
      throw conflict(
        u.email === input.email
          ? 'An account with this email already exists. Try logging in.'
          : 'An account with this mobile number already exists. Try logging in.',
        'ACCOUNT_EXISTS',
      );
    }
  }
  for (const u of existing) await deleteUnverifiedRegistration(u._id, u.orgId ?? null);
  const org = await Organization.create({ name: input.name, irdaiNumber: input.irdaiNumber ?? null });
  let user;
  try {
    const { advisor } = await createDefaultRoles(org._id);
    user = await User.create({
      orgId: org._id, roleId: advisor._id, name: input.name, email: input.email,
      mobile: input.mobile, passwordHash: await hashPassword(input.password), status: 'PENDING_OTP',
    });
  } catch (err) {
    await Promise.all([Organization.deleteOne({ _id: org._id }), Role.deleteMany({ orgId: org._id })]);
    if (isDuplicateKeyError(err)) throw conflict('An account with this email or mobile already exists.', 'ACCOUNT_EXISTS');
    throw err;
  }
  await Organization.updateOne({ _id: org._id }, { $set: { ownerUserId: user._id } });
  await audit({ orgId: org._id, actorUserId: user._id, action: 'registration.create', entity: 'User', entityId: user._id, ip: client.ip, requestId: client.requestId });
  const otpToken = await sendOtp(user);
  return { otpToken, userId: user._id.toString(), maskedMobile: maskMobile(user.mobile), resendAfterSec: 30 };
}

export async function resendOtp(userId: string) {
  const user = await User.findOne({ _id: userId, status: 'PENDING_OTP' }).lean();
  if (!user) throw conflict('This mobile number is already verified.', 'ALREADY_VERIFIED');
  const otpToken = await sendOtp(user);
  return { otpToken, userId: user._id.toString(), maskedMobile: maskMobile(user.mobile), resendAfterSec: 30 };
}

export async function verifyOtp(userId: string, otpToken: string, code: string, client: ClientInfo) {
  const user = await User.findOne({ _id: userId, status: 'PENDING_OTP' }).lean();
  if (!user) throw conflict('This mobile number is already verified.', 'ALREADY_VERIFIED');
  checkOtp(otpToken, user.mobile, code);
  const now = new Date();
  await User.updateOne({ _id: user._id }, { $set: { status: 'PENDING_VERIFICATION', mobileVerifiedAt: now } });
  await Organization.updateOne({ _id: user.orgId, trialStartedAt: null }, { $set: { trialStartedAt: now } });
  await audit({ orgId: user.orgId, actorUserId: user._id, action: 'registration.mobile_verified', entity: 'User', entityId: user._id, ip: client.ip, requestId: client.requestId });
  return { userId: user._id.toString() };
}

export async function registrationStatus(userId: string) {
  const user = Types.ObjectId.isValid(userId) ? await User.findById(userId).lean() : null;
  if (!user) throw notFound('Registration not found');
  const org = user.orgId ? await Organization.findById(user.orgId).lean() : null;
  if (!org?.ownerUserId?.equals(user._id)) throw notFound('Registration not found');
  return { status: user.status === 'PENDING_OTP' ? 'PENDING_VERIFICATION' : user.status };
}
