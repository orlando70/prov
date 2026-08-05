import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis, redisSubscriber } from './lib/redis';
import { setupSocketServer, getSocketServer } from './modules/realtime/socket.server';
import { setupBroadcaster } from './modules/realtime/broadcaster';
import { simulator } from './simulator/simulator';

let app: ReturnType<typeof buildApp>;
let shuttingDown = false;

async function start() {
  app = buildApp();

  setupSocketServer(app);
  await setupBroadcaster();

  try {
    await prisma.$connect();
    logger.info('Database connected');

    await simulator.init();

    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('Shutting down server...');
  simulator.stop();

  try {
    getSocketServer().close();
  } catch {
    // Ignore if not initialized
  }

  try {
    if (app) await app.close();
  } catch (err) {
    logger.error(err, 'Error closing Fastify');
  }

  await prisma.$disconnect();
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
  process.exit(exitCode);
};

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught Exception');
  void shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Rejection');
  void shutdown(1);
});

void start();
