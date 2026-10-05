import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { schedulerService } from './jobs/scheduler';

const app = createApp();
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'CodeCrafter API listening'));

if (env.ENABLE_SCHEDULER) {
  schedulerService.start().catch((err) => logger.error({ err }, 'scheduler failed to start'));
}

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  schedulerService.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
