import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { getMatchParamsSchema } from '../matches/matches.schemas';
import { buildError } from '../../utils/response';

export const eventsStreamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/:id/events/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = getMatchParamsSchema.parse(request.params);
    const matchId = params.id;

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      return reply.status(404).send(buildError('MATCH_NOT_FOUND', 'Match not found', request.id));
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    const headerValue = request.headers['last-event-id'];
    const lastEventId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    let lastSeq = lastEventId ? parseInt(lastEventId, 10) : 0;

    if (isNaN(lastSeq)) {
      lastSeq = 0;
    }

    try {
      if (lastSeq > 0) {
        const missedEvents = await prisma.matchEvent.findMany({
          where: {
            matchId,
            seq: { gt: lastSeq },
          },
          orderBy: { seq: 'asc' },
        });

        for (const event of missedEvents) {
          reply.raw.write(
            `id: ${event.seq}\nevent: match_event\ndata: ${JSON.stringify(event)}\n\n`
          );
        }
      }
    } catch (err) {
      app.log.error(err, 'SSE replay failed');
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ code: 'REPLAY_FAILED', message: 'Failed to replay events' })}\n\n`
      );
      reply.raw.end();
      return reply;
    }

    const client = new Redis(env.REDIS_URL, {
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
      maxRetriesPerRequest: null,
    });
    const channel = `match:${matchId}:events`;

    const heartbeatInterval = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: {}\n\n`);
    }, 15000);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeatInterval);
      void client.unsubscribe(channel).finally(() => {
        void client.quit();
      });
    };

    // Register before await subscribe so a mid-subscribe disconnect still cleans up
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
    reply.raw.on('close', cleanup);

    client.on('message', (chan, message) => {
      if (chan === channel) {
        try {
          const payload = JSON.parse(message);
          if (payload.kind === 'EVENT') {
            const evt = payload.data;
            reply.raw.write(`id: ${evt.seq}\nevent: match_event\ndata: ${JSON.stringify(evt)}\n\n`);
          }
        } catch (e) {
          app.log.error(e, 'Failed to parse redis message in SSE');
        }
      }
    });

    try {
      await client.subscribe(channel);
    } catch (err) {
      app.log.error(err, 'SSE subscribe failed');
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ code: 'SUBSCRIBE_FAILED', message: 'Failed to subscribe to events' })}\n\n`
      );
      cleanup();
      reply.raw.end();
      return reply;
    }

    return reply;
  });
};
