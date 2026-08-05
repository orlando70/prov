import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { io as Client, Socket } from 'socket.io-client';
import { FastifyInstance } from 'fastify';
import { redis } from '../../lib/redis';
import { setupSocketServer } from '../realtime/socket.server';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';

const MATCH_ID = '550e8400-e29b-41d4-a716-446655440000';

function onceEvent<T = unknown>(socket: Socket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
}

describe('Chat Gateway', () => {
  let app: FastifyInstance;
  let client1: Socket;
  let client2: Socket;
  let port: number;

  beforeAll(async () => {
    app = buildApp();
    setupSocketServer(app);
    await app.listen({ port: 0 });
    port = (app.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await redis.flushdb();
    vi.spyOn(prisma.chatMessage, 'create').mockImplementation(async ({ data }: any) => ({
      id: 'msg-1',
      createdAt: new Date(),
      ...data,
    }));

    client1 = Client(`http://localhost:${port}`, { auth: { userId: 'user-1' } });
    client2 = Client(`http://localhost:${port}`, { auth: { userId: 'user-2' } });

    await Promise.all([
      onceEvent(client1, 'connect'),
      onceEvent(client2, 'connect'),
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    client1.disconnect();
    client2.disconnect();
  });

  it('allows joining and leaving a chat room, tracking user counts', async () => {
    const joinPromise = onceEvent<{ userCount: number }>(client1, 'chat:user_joined');
    client1.emit('chat:join', { matchId: MATCH_ID, username: 'Alice' });
    const joinEvent = await joinPromise;
    expect(joinEvent.userCount).toBe(1);

    const joinPromise2 = onceEvent<{ userCount: number }>(client2, 'chat:user_joined');
    client2.emit('chat:join', { matchId: MATCH_ID, username: 'Bob' });
    const joinEvent2 = await joinPromise2;
    expect(joinEvent2.userCount).toBe(2);

    const leavePromise = onceEvent<{ userCount: number; userId: string }>(client2, 'chat:user_left');
    client1.emit('chat:leave', { matchId: MATCH_ID });
    const leaveEvent = await leavePromise;
    expect(leaveEvent.userCount).toBe(1);
    expect(leaveEvent.userId).toBe('user-1');
  });

  it('broadcasts a valid chat message to the room', async () => {
    const aliceJoined = onceEvent(client1, 'chat:user_joined');
    client1.emit('chat:join', { matchId: MATCH_ID, username: 'Alice' });
    await aliceJoined;

    const bobJoined = onceEvent(client2, 'chat:user_joined');
    client2.emit('chat:join', { matchId: MATCH_ID, username: 'Bob' });
    await bobJoined;

    const messagePromise = onceEvent<{ message: string; userId: string }>(client2, 'chat:message');
    client1.emit('chat:message', { matchId: MATCH_ID, message: '  Goal!  ' });
    const msg = await messagePromise;

    expect(msg.userId).toBe('user-1');
    expect(msg.message).toBe('Goal!');
  });

  it('rejects empty/whitespace messages and messages exceeding max length', async () => {
    const emptyError = onceEvent<{ code: string }>(client1, 'error');
    client1.emit('chat:message', { matchId: MATCH_ID, message: '   ' });
    expect((await emptyError).code).toBe('INVALID_PAYLOAD');

    const longError = onceEvent<{ code: string }>(client1, 'error');
    client1.emit('chat:message', {
      matchId: MATCH_ID,
      message: 'x'.repeat(env.CHAT_MAX_MESSAGE_LENGTH + 1),
    });
    expect((await longError).code).toBe('INVALID_PAYLOAD');
  });

  it('enforces rate limiting per userId server-side', async () => {
    const errors: string[] = [];
    client1.on('error', (err: { code: string }) => {
      errors.push(err.code);
    });

    for (let i = 0; i < env.CHAT_RATE_LIMIT_MAX + 5; i++) {
      client1.emit('chat:message', { matchId: MATCH_ID, message: `Msg ${i}` });
    }

    await waitFor(() => errors.includes('RATE_LIMIT_EXCEEDED'));
    expect(errors).toContain('RATE_LIMIT_EXCEEDED');
  });

  it('keeps rate limit keyed on userId across reconnects', async () => {
    for (let i = 0; i < env.CHAT_RATE_LIMIT_MAX; i++) {
      client1.emit('chat:message', { matchId: MATCH_ID, message: `Msg ${i}` });
    }
    await waitFor(async () => {
      const count = await redis.get(`ratelimit:chat:user-1`);
      return Number(count) >= env.CHAT_RATE_LIMIT_MAX;
    });

    client1.disconnect();
    const reconnected = Client(`http://localhost:${port}`, { auth: { userId: 'user-1' } });
    await onceEvent(reconnected, 'connect');

    const errorPromise = onceEvent<{ code: string }>(reconnected, 'error');
    reconnected.emit('chat:message', { matchId: MATCH_ID, message: 'after reconnect' });
    expect((await errorPromise).code).toBe('RATE_LIMIT_EXCEEDED');

    reconnected.disconnect();
  });

  it('prevents duplicate joins from doubling user count', async () => {
    const client3 = Client(`http://localhost:${port}`, { auth: { userId: 'user-1' } });
    await onceEvent(client3, 'connect');

    // Observer joins first so they receive subsequent room broadcasts
    const bobJoined = onceEvent<{ userCount: number }>(client2, 'chat:user_joined');
    client2.emit('chat:join', { matchId: MATCH_ID, username: 'Bob' });
    expect((await bobJoined).userCount).toBe(1);

    const aliceJoined = onceEvent<{ userCount: number; userId: string }>(client2, 'chat:user_joined');
    client1.emit('chat:join', { matchId: MATCH_ID, username: 'Alice' });
    const firstAliceJoin = await aliceJoined;
    expect(firstAliceJoin.userId).toBe('user-1');
    expect(firstAliceJoin.userCount).toBe(2);

    let extraJoins = 0;
    client2.on('chat:user_joined', () => {
      extraJoins += 1;
    });

    client3.emit('chat:join', { matchId: MATCH_ID, username: 'Alice' });

    // Wait until second socket is reflected in Redis socketCount, without a long sleep
    await waitFor(async () => {
      const raw = await redis.hget(`chat:${MATCH_ID}:users`, 'user-1');
      if (!raw) return false;
      return JSON.parse(raw).socketCount === 2;
    });

    expect(extraJoins).toBe(0);
    expect(await redis.hlen(`chat:${MATCH_ID}:users`)).toBe(2);

    client3.disconnect();
  });

  it('handles typing start and stop events', async () => {
    client1.emit('chat:join', { matchId: MATCH_ID, username: 'Alice' });
    client2.emit('chat:join', { matchId: MATCH_ID, username: 'Bob' });
    await onceEvent(client2, 'chat:user_joined');

    const typingPromise = onceEvent<{ isTyping: boolean; userId: string }>(client2, 'chat:typing');
    client1.emit('chat:typing:start', { matchId: MATCH_ID });
    const typingEvent = await typingPromise;
    expect(typingEvent.isTyping).toBe(true);
    expect(typingEvent.userId).toBe('user-1');

    const stopTypingPromise = onceEvent<{ isTyping: boolean }>(client2, 'chat:typing');
    client1.emit('chat:typing:stop', { matchId: MATCH_ID });
    expect((await stopTypingPromise).isTyping).toBe(false);
  });

  it('cleans up chat presence and typing state on disconnect', async () => {
    client1.emit('chat:join', { matchId: MATCH_ID, username: 'Alice' });
    client2.emit('chat:join', { matchId: MATCH_ID, username: 'Bob' });
    await onceEvent(client2, 'chat:user_joined');

    client1.emit('chat:typing:start', { matchId: MATCH_ID });
    await onceEvent(client2, 'chat:typing');

    const leftPromise = onceEvent<{ userId: string; userCount: number }>(client2, 'chat:user_left');
    client1.disconnect();
    const left = await leftPromise;

    expect(left.userId).toBe('user-1');
    expect(left.userCount).toBe(1);
    expect(await redis.hlen(`chat:${MATCH_ID}:users`)).toBe(1);
  });
});
