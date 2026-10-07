import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { tooManyRequests } from '../lib/errors.js';
import { redis } from '../lib/redis.js';
export type LimiterName = 'global' | 'login' | 'register' | 'otp' | 'refresh' | 'publicRead';
export type Limiters = Record<LimiterName, RequestHandler>;
const ipOf = (req: Request) => ipKeyGenerator(req.ip ?? '0.0.0.0');
const RULES: Record<LimiterName, { windowMs: number; limit: number; key?: (req: Request) => string }> = {
  global:     { windowMs: 60_000,        limit: 300 },
  login:      { windowMs: 15 * 60_000,   limit: 10,
    key: (req) => {
      const body: unknown = req.body;
      const identifier = typeof body === 'object' && body !== null && 'identifier' in body && typeof (body as { identifier: unknown }).identifier === 'string'
        ? (body as { identifier: string }).identifier.trim().toLowerCase() : '';
      return `${ipOf(req)}:${identifier}`;
    },
  },
  register:   { windowMs: 60 * 60_000,  limit: 10 },
  otp:        { windowMs: 15 * 60_000,  limit: 15 },
  refresh:    { windowMs: 15 * 60_000,  limit: 60 },
  publicRead: { windowMs: 60_000,       limit: 60 },
};
const passThrough: RequestHandler = (_req: Request, _res: Response, next: NextFunction) => next();
export function createLimiters(enabled: boolean): Limiters {
  const entries = Object.entries(RULES).map(([name, rule]) => {
    if (!enabled) return [name, passThrough] as const;
    const handler = rateLimit({
      windowMs: rule.windowMs, limit: rule.limit,
      standardHeaders: 'draft-8', legacyHeaders: false, passOnStoreError: true,
      keyGenerator: rule.key ?? ipOf,
      store: new RedisStore({
        prefix: `rl:${name}:`,
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
      }),
      handler: (_req, _res, next) => next(tooManyRequests('Too many attempts. Please wait and try again.')),
    });
    return [name, handler] as const;
  });
  return Object.fromEntries(entries) as Limiters;
}