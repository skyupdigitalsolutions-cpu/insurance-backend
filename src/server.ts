import { env } from './config/env.js';
import { closeJobsQueue } from './jobs/queue.js';
import { createApp } from './app.js';
const app = createApp();
import { connectMongo, disconnectMongo } from './lib/mongo.js';
import { connectRedis, disconnectRedis } from './lib/redis.js';
import { logger } from './lib/logger.js';

async function main() {
  await connectMongo();
  await connectRedis();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Server shutting down');

    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000);
    force.unref();

    server.close(async () => {
      await Promise.allSettled([disconnectMongo(), disconnectRedis(), closeJobsQueue()]);
      logger.info('Server stopped');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled promise rejection');
  process.exit(1);
});

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Server failed to start');
  process.exit(1);
});

