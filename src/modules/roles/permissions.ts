export const ORG_PERMISSIONS = [
  'dashboard:read', 'report:read',
  'lead:read', 'lead:create', 'lead:update',
  'customer:read', 'customer:create', 'customer:update',
  'product:read', 'product:manage',
  'quotation:read', 'quotation:create', 'quotation:approve',
  'payment:read', 'payment:create',
  'policy:read', 'policy:manage',
  'renewal:read', 'renewal:manage',
  'referral:read', 'referral:create',
  'task:read', 'task:manage',
  'communication:send',
  'document:read', 'document:upload',
  'user:manage',
] as const;

export const PLATFORM_PERMISSIONS = [
  'platform:admin',
  'platform:registration:approve',
  'platform:product:manage',
  'platform:ops:view',
  'platform:jobs:run',
] as const;

export type OrgPermission = (typeof ORG_PERMISSIONS)[number];
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type Permission = OrgPermission | PlatformPermission;

export const ALL_PERMISSIONS: Permission[] = [...ORG_PERMISSIONS];

export const PLATFORM_ADMIN_ROLE = {
  key: 'platform_admin',
  name: 'Platform Admin',
  permissions: [...PLATFORM_PERMISSIONS] as Permission[],
};

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  advisor: [...ORG_PERMISSIONS],
  staff: [
    'dashboard:read', 'lead:read', 'lead:create', 'lead:update',
    'customer:read', 'customer:create', 'customer:update',
    'product:read', 'quotation:read', 'quotation:create',
    'payment:read', 'policy:read', 'renewal:read',
    'task:read', 'referral:read', 'referral:create',
  ],
};

export const isOrgPermission = (p: string): p is OrgPermission =>
  (ORG_PERMISSIONS as readonly string[]).includes(p);
