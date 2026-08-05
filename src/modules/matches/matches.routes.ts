import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getMatchesQuerySchema, getMatchParamsSchema } from './matches.schemas';
import { matchesService } from './matches.service';
import { buildSuccess } from '../../utils/response';

const envelopeSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: {},
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
    meta: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
      },
    },
  },
} as const;

export const matchesRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['matches'],
        summary: 'List live and upcoming matches',
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['NOT_STARTED', 'FIRST_HALF', 'HALF_TIME', 'SECOND_HALF', 'FULL_TIME'],
            },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        response: { 200: envelopeSchema },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = getMatchesQuerySchema.parse(request.query);
      const matches = await matchesService.getMatches(query);
      return reply.send(buildSuccess(matches, request.id));
    }
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['matches'],
        summary: 'Get match detail with events and statistics',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: envelopeSchema,
          400: envelopeSchema,
          404: envelopeSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = getMatchParamsSchema.parse(request.params);
      const match = await matchesService.getMatch(params.id);
      return reply.send(buildSuccess(match, request.id));
    }
  );
};
