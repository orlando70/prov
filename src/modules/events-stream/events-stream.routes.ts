import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import Redis from 'ioredis';
import { env } from '../../config/env';

const getMatchStreamParamsSchema = z.object({
  id: z.string().uuid(),
});

export const eventsStreamRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/:id/events/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = getMatchStreamParamsSchema.parse(request.params);
    const matchId = params.id;
    
    // Check if match exists
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      reply.status(404).send({ success: false, error: { code: 'MATCH_NOT_FOUND', message: 'Match not found' } });
      return;
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

    // Replay events if reconnecting
    if (lastSeq > 0) {
      const missedEvents = await prisma.matchEvent.findMany({
        where: {
          matchId,
          seq: { gt: lastSeq },
        },
        orderBy: { seq: 'asc' },
      });

      for (const event of missedEvents) {
        reply.raw.write(`id: ${event.seq}\nevent: match_event\ndata: ${JSON.stringify(event)}\n\n`);
      }
    }

    // Subscribe to redis for this specific match
    const client = new Redis(env.REDIS_URL);
    const channel = `match:${matchId}:events`;
    
    await client.subscribe(channel);
    
    client.on('message', (chan, message) => {
      if (chan === channel) {
        try {
          const payload = JSON.parse(message);
          // Only forward actual EVENTs with seq, or other payloads?
          // The spec says SSE streams match events. Let's forward EVENTs.
          if (payload.kind === 'EVENT') {
            const evt = payload.data;
            reply.raw.write(`id: ${evt.seq}\nevent: match_event\ndata: ${JSON.stringify(evt)}\n\n`);
          }
        } catch (e) {
          app.log.error(e, 'Failed to parse redis message in SSE');
        }
      }
    });

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
      reply.raw.write(`event: heartbeat\ndata: {}\n\n`);
    }, 15000);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      client.unsubscribe(channel);
      client.quit();
    });

    // To prevent Fastify from closing the connection immediately
    return reply; 
  });
};
