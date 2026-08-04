import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { setupSocketServer } from './modules/realtime/socket.server';
import { setupBroadcaster } from './modules/realtime/broadcaster';
import { simulator } from './simulator/simulator';

async function start() {
  const app = buildApp();

  // Setup Socket.IO
  setupSocketServer(app);
  
  // Setup Redis Broadcaster
  setupBroadcaster();

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
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
