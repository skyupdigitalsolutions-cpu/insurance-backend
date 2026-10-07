import { z } from 'zod';
import { orgIdOf } from '../../middleware/auth.js';
import { defineRoute } from '../../lib/route.js';
import { objectId } from '../../lib/validators.js';
import { listMessages, listTemplates, previewMessage, sendMessage } from './communications.service.js';

const target = z.object({ templateId: objectId, customerId: objectId });

export const communicationRoutes = [
  defineRoute({
    method: 'get', path: '/templates', tag: 'Communications', summary: 'Approved message templates',
    access: 'user', permission: 'communication:send', query: z.object({ status: z.enum(['approved']).default('approved') }),
    handler: ({ auth }) => listTemplates(orgIdOf(auth)),
  }),
  defineRoute({
    method: 'post', path: '/communications/preview', tag: 'Communications', summary: 'The message with the customer\'s data filled in',
    access: 'user', permission: 'communication:send', body: target,
    handler: ({ auth, body }) => previewMessage(orgIdOf(auth), body.templateId, body.customerId),
  }),
  defineRoute({
    method: 'post', path: '/communications/send', tag: 'Communications', summary: 'Send a template message',
    access: 'user', permission: 'communication:send', body: z.object({ customerId: objectId, templateId: objectId }), status: 201,
    handler: ({ auth, body }) => sendMessage(auth, orgIdOf(auth), body.customerId, body.templateId),
  }),
  defineRoute({
    method: 'get', path: '/communications', tag: 'Communications', summary: 'Messages sent (newest first)',
    access: 'user', permission: 'communication:send',
    handler: ({ auth }) => listMessages(orgIdOf(auth)),
  }),
];
