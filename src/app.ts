import cors from '@fastify/cors';
import fastify from 'fastify';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { setupErrorHandler } from './middleware/error-handler';
import { buildSuccess } from './utils/response';
import { matchesRoutes } from './modules/matches/matches.routes';
import { eventsStreamRoutes } from './modules/events-stream/events-stream.routes';

export function buildApp() {
  const app = fastify({
    loggerInstance: logger,
    genReqId: () => crypto.randomUUID(), // Or standard fastify request id
  });

  setupErrorHandler(app);

  app.register(cors, { origin: env.CORS_ORIGIN });

  app.get('/health', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return reply.send(buildSuccess({ status: 'ok' }, request.id));
    } catch (err) {
      request.log.error(err, 'Health check failed');
      return reply.status(503).send(buildSuccess({ status: 'error' }, request.id));
    }
  });

  app.register(matchesRoutes, { prefix: '/api/matches' });
  app.register(eventsStreamRoutes, { prefix: '/api/matches' });

  return app;
}
