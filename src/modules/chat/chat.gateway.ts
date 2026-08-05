import { Server, Socket } from 'socket.io';
import {
  chatJoinSchema,
  chatLeaveSchema,
  chatMessageSchema,
  chatTypingSchema,
} from './chat.schemas';
import { chatService } from './chat.service';
import { env } from '../../config/env';

// Track typing timeouts per socket memory
const typingTimers = new Map<string, NodeJS.Timeout>();

export function setupChatGateway(io: Server) {
  io.on('connection', (socket: Socket) => {
    // We'll use auth.userId if provided, else fallback to socket.id.
    const userId = (socket.handshake.auth?.userId as string) || socket.id;
    const joinedRooms = new Set<string>();

    socket.on('chat:join', async (payload) => {
      try {
        const { matchId, username } = chatJoinSchema.parse(payload);
        joinedRooms.add(matchId);

        socket.join(`chat:${matchId}`);

        const { joined, count } = await chatService.joinUser(matchId, userId, username);

        if (joined) {
          io.to(`chat:${matchId}`).emit('chat:user_joined', {
            matchId,
            userId,
            username,
            userCount: count,
          });
        }
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid chat join payload' });
      }
    });

    socket.on('chat:leave', async (payload) => {
      try {
        const { matchId } = chatLeaveSchema.parse(payload);
        joinedRooms.delete(matchId);

        socket.leave(`chat:${matchId}`);

        const { left, count, username } = await chatService.leaveUser(matchId, userId);

        if (left) {
          io.to(`chat:${matchId}`).emit('chat:user_left', {
            matchId,
            userId,
            username,
            userCount: count,
          });
        }
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid chat leave payload' });
      }
    });

    socket.on('chat:message', async (payload) => {
      try {
        const { matchId, message } = chatMessageSchema.parse(payload);

        const allowed = await chatService.checkRateLimit(userId);
        if (!allowed) {
          socket.emit('error', { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many messages' });
          return;
        }

        // We get username from the hash.
        const user = await chatService.getUser(matchId, userId);
        const username = user?.username || 'Unknown';

        const msg = await chatService.saveMessage(matchId, userId, username, message);

        io.to(`chat:${matchId}`).emit('chat:message', msg);
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid chat message payload' });
      }
    });

    socket.on('chat:typing:start', async (payload) => {
      try {
        const { matchId } = chatTypingSchema.parse(payload);
        const user = await chatService.getUser(matchId, userId);
        const username = user?.username || 'Unknown';

        // Clear existing timer if any
        const timerKey = `${userId}:${matchId}`;
        if (typingTimers.has(timerKey)) {
          clearTimeout(typingTimers.get(timerKey)!);
        } else {
          // Broadcast typing start
          socket.to(`chat:${matchId}`).emit('chat:typing', {
            matchId,
            userId,
            username,
            isTyping: true,
          });
        }

        // Set new timer to auto-stop typing
        const timer = setTimeout(() => {
          socket.to(`chat:${matchId}`).emit('chat:typing', {
            matchId,
            userId,
            username,
            isTyping: false,
          });
          typingTimers.delete(timerKey);
        }, env.TYPING_TIMEOUT_MS);

        typingTimers.set(timerKey, timer);
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid typing payload' });
      }
    });

    socket.on('chat:typing:stop', async (payload) => {
      try {
        const { matchId } = chatTypingSchema.parse(payload);
        const user = await chatService.getUser(matchId, userId);
        const username = user?.username || 'Unknown';

        const timerKey = `${userId}:${matchId}`;

        if (typingTimers.has(timerKey)) {
          clearTimeout(typingTimers.get(timerKey)!);
          typingTimers.delete(timerKey);

          socket.to(`chat:${matchId}`).emit('chat:typing', {
            matchId,
            userId,
            username,
            isTyping: false,
          });
        }
      } catch (err) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid typing payload' });
      }
    });

    socket.on('disconnect', async () => {
      for (const matchId of joinedRooms) {
        const { left, count, username } = await chatService.leaveUser(matchId, userId);
        if (left) {
          io.to(`chat:${matchId}`).emit('chat:user_left', {
            matchId: matchId,
            userId,
            username,
            userCount: count,
          });
        }

        // Clear typing timer
        const timerKey = `${userId}:${matchId}`;
        if (typingTimers.has(timerKey)) {
          clearTimeout(typingTimers.get(timerKey)!);
          typingTimers.delete(timerKey);
        }
      }
    });
  });
}
