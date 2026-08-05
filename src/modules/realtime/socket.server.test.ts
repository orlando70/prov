import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../app';
import { io as Client, Socket } from 'socket.io-client';
import { FastifyInstance } from 'fastify';
import { setupSocketServer, getSocketServer } from './socket.server';
import { setupBroadcaster } from './broadcaster';
import { redis } from '../../lib/redis';

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

describe('Socket Server', () => {
  let app: FastifyInstance;
  let client1: Socket;
  let client2: Socket;
  let port: number;

  beforeAll(async () => {
    app = buildApp();
    setupSocketServer(app);
    await setupBroadcaster();
    await app.listen({ port: 0 });
    port = (app.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    client1 = Client(`http://localhost:${port}`);
    client2 = Client(`http://localhost:${port}`);

    await Promise.all([onceEvent(client1, 'connect'), onceEvent(client2, 'connect')]);
  });

  afterEach(() => {
    client1.disconnect();
    client2.disconnect();
  });

  it('provides pingInterval and pingTimeout configuration', () => {
    const io = getSocketServer();
    const opts = (io.engine as { opts: { pingInterval: number; pingTimeout: number } }).opts;
    expect(opts.pingInterval).toBe(25000);
    expect(opts.pingTimeout).toBe(20000);
  });

  it('emits error on malformed payload and keeps connection alive', async () => {
    const errorPromise = onceEvent<{ code: string }>(client1, 'error');
    client1.emit('match:subscribe', { matchId: 'not-a-uuid' });
    const err = await errorPromise;
    expect(err.code).toBe('INVALID_PAYLOAD');
    expect(client1.connected).toBe(true);
  });

  it('supports subscribe and unsubscribe for match rooms', async () => {
    const io = getSocketServer();
    const roomKey = `match:${MATCH_ID}`;

    client1.emit('match:subscribe', { matchId: MATCH_ID });
    await waitFor(async () => (await io.in(roomKey).fetchSockets()).length === 1);

    client1.emit('match:unsubscribe', { matchId: MATCH_ID });
    await waitFor(async () => (await io.in(roomKey).fetchSockets()).length === 0);
  });

  it('supports room-based broadcast isolation for match updates', async () => {
    client1.emit('match:subscribe', { matchId: MATCH_ID });
    await waitFor(async () => {
      const sockets = await getSocketServer().in(`match:${MATCH_ID}`).fetchSockets();
      return sockets.length === 1;
    });

    let client2Received = false;
    client2.on('match:score_update', () => {
      client2Received = true;
    });

    const client1Promise = onceEvent(client1, 'match:score_update');

    await redis.publish(
      `match:${MATCH_ID}:events`,
      JSON.stringify({
        kind: 'SCORE',
        data: { homeScore: 1, awayScore: 0, minute: 12 },
      })
    );

    await client1Promise;
    expect(client2Received).toBe(false);
  });

  it('broadcasts match:event and match:stats_update to subscribed clients only', async () => {
    client1.emit('match:subscribe', { matchId: MATCH_ID });
    await waitFor(async () => {
      const sockets = await getSocketServer().in(`match:${MATCH_ID}`).fetchSockets();
      return sockets.length === 1;
    });

    let client2GotEvent = false;
    let client2GotStats = false;
    client2.on('match:event', () => {
      client2GotEvent = true;
    });
    client2.on('match:stats_update', () => {
      client2GotStats = true;
    });

    const eventPromise = onceEvent(client1, 'match:event');
    const statsPromise = onceEvent(client1, 'match:stats_update');

    await redis.publish(
      `match:${MATCH_ID}:events`,
      JSON.stringify({
        kind: 'EVENT',
        data: { seq: 1, type: 'GOAL' },
      })
    );
    await redis.publish(
      `match:${MATCH_ID}:events`,
      JSON.stringify({
        kind: 'STATS',
        data: [{ teamId: 't1', shotsTotal: 3 }],
      })
    );

    await eventPromise;
    await statsPromise;
    expect(client2GotEvent).toBe(false);
    expect(client2GotStats).toBe(false);
  });

  it('handles connection cleanup on disconnect', async () => {
    const io = getSocketServer();
    const roomKey = `match:${MATCH_ID}`;

    client1.emit('match:subscribe', { matchId: MATCH_ID });
    await waitFor(async () => (await io.in(roomKey).fetchSockets()).length > 0);

    client1.disconnect();
    await waitFor(async () => (await io.in(roomKey).fetchSockets()).length === 0);
  });
});
