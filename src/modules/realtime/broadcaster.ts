import { getSocketServer } from './socket.server';
import { redisSubscriber } from '../../lib/redis';
import { logger } from '../../lib/logger';

export function setupBroadcaster() {
  // Subscribe to pattern match:*:events
  redisSubscriber.psubscribe('match:*:events', (err, count) => {
    if (err) {
      logger.error(err, 'Failed to subscribe to redis pattern');
    } else {
      logger.info(`Subscribed to match events on ${count} pattern(s)`);
    }
  });

  redisSubscriber.on('pmessage', (pattern, channel, message) => {
    try {
      const matchId = channel.split(':')[1];
      const payload = JSON.parse(message);
      
      const io = getSocketServer();
      
      switch (payload.kind) {
        case 'SCORE':
          io.to(`match:${matchId}`).emit('match:score_update', { matchId, ...payload.data });
          break;
        case 'EVENT':
          io.to(`match:${matchId}`).emit('match:event', { matchId, event: payload.data });
          break;
        case 'STATS':
          io.to(`match:${matchId}`).emit('match:stats_update', { matchId, statistics: payload.data });
          break;
        case 'STATUS':
          io.to(`match:${matchId}`).emit('match:status_change', { matchId, status: payload.data });
          break;
        default:
          logger.warn({ kind: payload.kind }, 'Unknown event kind from Redis');
      }
    } catch (err) {
      logger.error({ err, message }, 'Failed to parse/broadcast redis message');
    }
  });
}
