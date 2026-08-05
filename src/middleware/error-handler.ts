import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { buildError } from '../utils/response';

// any: Fastify's logger generic makes the concrete app instance incompatible with FastifyInstance
export function setupErrorHandler(app: any) {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error(error);

    const requestId = request.id;

    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(buildError('VALIDATION_ERROR', 'Invalid request payload', requestId));
    }

    // Fastify JSON-schema validation (from OpenAPI route schemas)
    if (error.validation || error.code === 'FST_ERR_VALIDATION') {
      return reply
        .status(400)
        .send(buildError('VALIDATION_ERROR', 'Invalid request payload', requestId));
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(buildError(error.code, error.message, requestId));
    }

    if (error.statusCode) {
      return reply
        .status(error.statusCode)
        .send(buildError(error.code || 'HTTP_ERROR', error.message, requestId));
    }

    // Default catch-all — never leak stack traces in production
    const message =
      process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message;

    return reply.status(500).send(buildError('INTERNAL_SERVER_ERROR', message, requestId));
  });
}
