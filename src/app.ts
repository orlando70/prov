import fastify from 'fastify';
import { env } from './config/env';
import { logger } from './lib/logger';
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

  app.get('/health', async (request, reply) => {
    return reply.send(buildSuccess({ status: 'ok' }, request.id));
  });

  app.register(matchesRoutes, { prefix: '/api/matches' });
  app.register(eventsStreamRoutes, { prefix: '/api/matches' });

  return app;
}
