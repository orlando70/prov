import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getMatchesQuerySchema, getMatchParamsSchema } from './matches.schemas';
import { matchesService } from './matches.service';
import { buildSuccess } from '../../utils/response';

export const matchesRoutes: FastifyPluginAsync = async (app: any) => {
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = getMatchesQuerySchema.parse(request.query);
    const matches = await matchesService.getMatches(query);
    return reply.send(buildSuccess(matches, request.id));
  });

  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = getMatchParamsSchema.parse(request.params);
    const match = await matchesService.getMatch(params.id);
    return reply.send(buildSuccess(match, request.id));
  });
};
