import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { setupSocketServer, getSocketServer } from './modules/realtime/socket.server';
import { setupBroadcaster } from './modules/realtime/broadcaster';
import { simulator } from './simulator/simulator';

async function start() {
  const app = buildApp();

  // Setup Socket.IO
  setupSocketServer(app);

  // Setup Redis Broadcaster
  await setupBroadcaster();

  try {
    await prisma.$connect();
    logger.info('Database connected');

    // Initialize Simulator
    await simulator.init();

    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`Server listening at ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Handle graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  simulator.stop();
  try {
    getSocketServer().close();
  } catch (err) {
    // Ignore if not initialized
  }
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  logger.fatal(err, 'Uncaught Exception');
  shutdown();
});
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Rejection');
  shutdown();
});

start();
