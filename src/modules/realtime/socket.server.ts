import { Server } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { z } from 'zod';
import { setupChatGateway } from '../chat/chat.gateway';

let io: Server;

export function setupSocketServer(app: any): Server {
  io = new Server(app.server, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  setupChatGateway(io);

  const subscribeSchema = z.object({ matchId: z.string().uuid() });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Socket connected');

    socket.on('match:subscribe', (payload) => {
      try {
        const { matchId } = subscribeSchema.parse(payload);
        socket.join(`match:${matchId}`);
        logger.debug({ socketId: socket.id, matchId }, 'Subscribed to match');
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid subscribe payload' });
      }
    });

    socket.on('match:unsubscribe', (payload) => {
      try {
        const { matchId } = subscribeSchema.parse(payload);
        socket.leave(`match:${matchId}`);
        logger.debug({ socketId: socket.id, matchId }, 'Unsubscribed from match');
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid unsubscribe payload' });
      }
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'Socket disconnected');
    });
  });

  return io;
}

export function getSocketServer() {
  if (!io) {
    throw new Error('Socket server not initialized');
  }
  return io;
}
