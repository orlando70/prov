import { redis } from '../../lib/redis';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

export class ChatService {
  async checkRateLimit(userId: string): Promise<boolean> {
    const key = `ratelimit:chat:${userId}`;
    
    // We can use a simple Redis INCR + EXPIRE for a fixed window
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, env.CHAT_RATE_LIMIT_WINDOW_MS);
    }
    
    return count <= env.CHAT_RATE_LIMIT_MAX;
  }

  async saveMessage(matchId: string, userId: string, username: string, message: string) {
    return prisma.chatMessage.create({
      data: {
        matchId,
        userId,
        username,
        message,
      }
    });
  }

  async joinUser(matchId: string, userId: string, username: string): Promise<{ joined: boolean, count: number }> {
    const key = `chat:${matchId}:users`;
    
    // Check if user is already in hash
    const existing = await redis.hget(key, userId);
    let userData = existing ? JSON.parse(existing) : { username, socketCount: 0, joinedAt: Date.now() };
    
    userData.socketCount += 1;
    await redis.hset(key, userId, JSON.stringify(userData));
    
    const count = await redis.hlen(key);
    
    return {
      joined: userData.socketCount === 1,
      count
    };
  }

  async leaveUser(matchId: string, userId: string): Promise<{ left: boolean, count: number, username?: string }> {
    const key = `chat:${matchId}:users`;
    const existing = await redis.hget(key, userId);
    
    if (!existing) {
      return { left: false, count: await redis.hlen(key) };
    }
    
    let userData = JSON.parse(existing);
    userData.socketCount -= 1;
    
    let left = false;
    if (userData.socketCount <= 0) {
      await redis.hdel(key, userId);
      left = true;
    } else {
      await redis.hset(key, userId, JSON.stringify(userData));
    }
    
    const count = await redis.hlen(key);
    
    return {
      left,
      count,
      username: userData.username
    };
  }

  async getUser(matchId: string, userId: string): Promise<{ username: string } | null> {
    const key = `chat:${matchId}:users`;
    const existing = await redis.hget(key, userId);
    if (existing) {
      return JSON.parse(existing);
    }
    return null;
  }
}

export const chatService = new ChatService();
