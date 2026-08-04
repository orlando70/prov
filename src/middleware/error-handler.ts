import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { buildError } from '../utils/response';

export function setupErrorHandler(app: any) {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    request.log.error(error);

    const requestId = request.id;

    if (error instanceof ZodError) {
      return reply.status(400).send(
        buildError('VALIDATION_ERROR', 'Invalid request payload', requestId)
      );
    }

    if (error.statusCode) {
      return reply.status(error.statusCode).send(
        buildError(error.code || 'HTTP_ERROR', error.message, requestId)
      );
    }

    // Default catch-all
    return reply.status(500).send(
      buildError('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', requestId)
    );
  });
}
