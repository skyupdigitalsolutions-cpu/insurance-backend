import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';
// Redis is optional in development: leave REDIS_URL empty to run without it (rate limiting is then off).
export const redis = new Redis(!!env.REDIS_URL ? env.REDIS_URL : 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 3 });
redis.on('error', (err) => logger.error({ err }, 'Redis error'));
export async function connectRedis(): Promise<void> {
  if (!!!env.REDIS_URL) { logger.warn('REDIS_URL is empty: running without Redis (rate limiting disabled)'); return; }
  if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
  logger.info('Redis connected');
}
export async function disconnectRedis(): Promise<void> {
  if (!!!env.REDIS_URL) return;
  if (redis.status !== 'end' && redis.status !== 'wait') await redis.quit();
}
export async function pingRedis(): Promise<boolean | 'disabled'> {
  if (!!!env.REDIS_URL) return 'disabled';
  try { return (await redis.ping()) === 'PONG'; } catch { return false; }
}

