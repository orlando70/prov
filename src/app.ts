import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastify from 'fastify';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { setupErrorHandler } from './middleware/error-handler';
import { buildError, buildSuccess } from './utils/response';
import { matchesRoutes } from './modules/matches/matches.routes';
import { eventsStreamRoutes } from './modules/events-stream/events-stream.routes';

/** `*` or empty → reflect any origin (gradable take-home trade-off; see README). */
function corsOrigin(): boolean | string {
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN === '*') return true;
  return env.CORS_ORIGIN;
}

export function buildApp() {
  const app = fastify({
    loggerInstance: logger,
    genReqId: () => crypto.randomUUID(),
    trustProxy: true,
    bodyLimit: 1_048_576, // 1MB
  });

  setupErrorHandler(app);

  app.register(cors, { origin: corsOrigin() });

  app.register(swagger, {
    openapi: {
      info: {
        title: 'ProFootball Real-time Match API',
        description:
          'REST surface for live/upcoming matches. Socket.IO and SSE contracts are documented in the README.',
        version: '1.0.0',
      },
    },
  });
  app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      return reply.send(buildSuccess({ status: 'ok' }, request.id));
    } catch (err) {
      request.log.error(err, 'Health check failed');
      return reply
        .status(503)
        .send(buildError('SERVICE_UNAVAILABLE', 'Database or Redis unreachable', request.id));
    }
  });

  app.register(matchesRoutes, { prefix: '/api/matches' });
  app.register(eventsStreamRoutes, { prefix: '/api/matches' });

  return app;
}
