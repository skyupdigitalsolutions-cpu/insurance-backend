import { Router } from 'express';
import { pingMongo } from '../../lib/mongo.js';
import { pingRedis } from '../../lib/redis.js';
export const healthRouter = Router();
healthRouter.get('/health', (_req, res) => { res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) }); });
healthRouter.get('/ready', async (_req, res) => {
  const [mongo, redis] = await Promise.all([pingMongo(), pingRedis()]);
  const ok = mongo && redis !== false;
  res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', mongo, redis });
});