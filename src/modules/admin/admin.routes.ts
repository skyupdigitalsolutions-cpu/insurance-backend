import { z } from 'zod';
import { defineRoute } from '../../lib/route.js';
import { idParams, pagination } from '../../lib/validators.js';
import { USER_STATUSES } from '../users/user.model.js';
import { approveRegistration, listRegistrations, rejectRegistration } from './registrations.service.js';
export const adminRoutes = [
  defineRoute({ method: 'get',  path: '/admin/registrations',                  tag: 'Admin', summary: 'List registrations', access: 'user', permission: 'platform:registration:approve', query: pagination.extend({ status: z.enum(USER_STATUSES).default('PENDING_VERIFICATION') }), handler: ({ query }) => listRegistrations(query) }),
  defineRoute({ method: 'post', path: '/admin/registrations/:id/approve',       tag: 'Admin', summary: 'Approve advisor',    access: 'user', permission: 'platform:registration:approve', params: idParams, handler: ({ auth, params }) => approveRegistration(auth, params.id) }),
  defineRoute({ method: 'post', path: '/admin/registrations/:id/reject',        tag: 'Admin', summary: 'Reject advisor',     access: 'user', permission: 'platform:registration:approve', params: idParams, body: z.object({ reason: z.string().trim().min(5).max(500) }), handler: ({ auth, params, body }) => rejectRegistration(auth, params.id, body.reason) }),
];