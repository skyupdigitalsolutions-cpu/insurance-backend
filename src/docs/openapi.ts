import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { RouteDef } from '../lib/route.js';
const jsonSchema = (schema: ZodType) => z.toJSONSchema ? zodToJsonSchema(schema, { target: 'openApi3' }) : {};

// File upload form: the file plus the other (text) fields
function multipartSchema(fileField: string, body?: ZodType) {
  const fields = body ? (jsonSchema(body) as { properties?: Record<string, unknown>; required?: string[] }) : {};
  return {
    type: 'object',
    required: [fileField, ...(fields.required ?? [])],
    properties: { [fileField]: { type: 'string', format: 'binary' }, ...(fields.properties ?? {}) },
  };
}
const errorResponse = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
export function buildOpenApi(routes: RouteDef[], basePath: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = basePath + r.path.replace(/:(\w+)/g, '{$1}');
    const parameters: unknown[] = [];
    for (const [where, schema] of [['path', r.params], ['query', r.query]] as const) {
      if (!schema) continue;
      const s = jsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, prop] of Object.entries(s.properties ?? {})) {
        parameters.push({ name, in: where, required: where === 'path' || (s.required ?? []).includes(name), schema: prop });
      }
    }
    const security = r.access === 'user' ? [{ bearerAuth: [] }] : [];
    const permissionNote = r.permission ? `\n\nRequires permission: \`${r.permission}\`` : '';
    paths[path] ??= {};
    paths[path][r.method] = {
      tags: [r.tag], summary: r.summary, description: (r.description ?? '') + permissionNote, security,
      ...(parameters.length ? { parameters } : {}),
      ...(r.fileField ? { requestBody: { required: true, content: { 'multipart/form-data': { schema: multipartSchema(r.fileField, r.body) } } } }
        : r.body ? { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(r.body) } } } } : {}),
      responses: { [String(r.status ?? 200)]: { description: 'Success' }, 400: errorResponse, ...(r.access === 'user' ? { 401: errorResponse } : {}), ...(r.permission ? { 403: errorResponse } : {}) },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'Insurance Sales & Customer Platform API', version: '1.0.0', description: 'REST API for the mobile app and web admin panel.' },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: { Error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } },
    },
    paths,
  };
}

