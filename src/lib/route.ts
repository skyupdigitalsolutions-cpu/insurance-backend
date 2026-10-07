import type { Request, RequestHandler, Response, Router } from 'express';
import multer from 'multer';
import { env } from '../config/env.js';
import type { z, ZodType } from 'zod';
import { authenticate, requirePermission, type AuthContext } from '../middleware/auth.js';
import type { LimiterName, Limiters } from '../middleware/rateLimit.js';
import type { Permission } from '../modules/roles/permissions.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Access = 'public' | 'user';
type Infer<T> = T extends ZodType ? z.output<T> : T extends undefined ? undefined : unknown;

export type RouteContext<B, Q, P, A extends Access> = {
  body: Infer<B>; query: Infer<Q>; params: Infer<P>;
  auth: A extends 'user' ? AuthContext : null;
  file: Express.Multer.File | undefined;
  req: Request; res: Response;
};

type RouteSpec<B, Q, P, A extends Access> = {
  method: Method; path: string; tag: string; summary: string; description?: string;
  access: A; permission?: Permission; feature?: string; limiter?: LimiterName;
  body?: B; query?: Q; params?: P; status?: number;
  fileField?: string;
  handler: (ctx: RouteContext<B, Q, P, A>) => unknown;
};

export type RouteDef = Omit<RouteSpec<ZodType, ZodType, ZodType, Access>, 'handler' | 'body' | 'query' | 'params'> & {
  body?: ZodType; query?: ZodType; params?: ZodType;
  handler: (ctx: RouteContext<unknown, unknown, unknown, Access>) => unknown;
};

export function defineRoute<
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends ZodType | undefined = undefined,
  A extends Access = 'user',
>(spec: RouteSpec<B, Q, P, A>): RouteDef { return spec as unknown as RouteDef; }

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 } });

export function mountRoutes(router: Router, routes: RouteDef[], limiters: Limiters): void {
  for (const r of routes) {
    const chain: RequestHandler[] = [];
    if (r.limiter)    chain.push(limiters[r.limiter]);
    if (r.access === 'user') chain.push(authenticate);
    if (r.permission) chain.push(requirePermission(r.permission));
    if (r.fileField)  chain.push(upload.single(r.fileField));
    chain.push(async (req, res) => {
      let result; try { result = await r.handler({
        body:   r.body   ? r.body.parse(req.body ?? {})  : undefined,
        query:  r.query  ? r.query.parse(req.query)      : undefined,
        params: r.params ? r.params.parse(req.params)    : undefined,
        auth:   req.auth ?? null, file: req.file, req, res,
      });
      } catch(err) { if (!res.headersSent) { res.status(500).json({ code: 'INTERNAL', message: err instanceof Error ? err.message : 'Internal error' }); } return; } if (res.headersSent) return;
      if (result === undefined) res.status(r.status ?? 204).end();
      else res.status(r.status ?? 200).json(result);
    });
    router[r.method](r.path, ...chain);
  }
}


