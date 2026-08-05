import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildApp } from '../../app';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';
import Redis from 'ioredis';
import http from 'http';

const MATCH_ID = '550e8400-e29b-41d4-a716-446655440000';

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
}

function openSseStream(
  port: number,
  matchId: string,
  headers: Record<string, string> = {}
): Promise<{ req: http.ClientRequest; res: http.IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: 'localhost',
        port,
        path: `/api/matches/${matchId}/events/stream`,
        headers,
      },
      (res) => resolve({ req, res })
    );
    req.on('error', (err) => {
      // destroy() can surface as an error; ignore after resolve
      if ((req as any)._resolved) return;
      reject(err);
    });
  }).then((result) => {
    (result.req as any)._resolved = true;
    return result;
  });
}

describe('SSE Stream Routes', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = buildApp();
    await app.listen({ port: 0 });
    port = (app.server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams events live as they happen', async () => {
    vi.spyOn(prisma.match, 'findUnique').mockResolvedValue({ id: MATCH_ID } as any);
    vi.spyOn(prisma.matchEvent, 'findMany').mockResolvedValue([]);

    const { req, res } = await openSseStream(port, MATCH_ID);

    const dataPromise = new Promise<string>((resolve) => {
      res.on('data', (chunk) => {
        const str = chunk.toString();
        if (str.includes('event: match_event')) {
          resolve(str);
          req.destroy();
        }
      });
    });

    await waitFor(async () => {
      const [, count] = (await redis.pubsub('NUMSUB', `match:${MATCH_ID}:events`)) as [
        string,
        number,
      ];
      return count >= 1;
    });

    await redis.publish(
      `match:${MATCH_ID}:events`,
      JSON.stringify({
        kind: 'EVENT',
        data: { seq: 1, type: 'GOAL', matchId: MATCH_ID },
      })
    );

    const result = await dataPromise;
    expect(result).toContain('id: 1');
    expect(result).toContain('"type":"GOAL"');
  });

  it('replays missed events upon reconnect with Last-Event-ID without duplicating them', async () => {
    vi.spyOn(prisma.match, 'findUnique').mockResolvedValue({ id: MATCH_ID } as any);
    vi.spyOn(prisma.matchEvent, 'findMany').mockImplementation(async (args: any) => {
      if (args.where?.seq?.gt === 2) {
        return [
          { seq: 3, type: 'YELLOW_CARD', matchId: MATCH_ID },
          { seq: 4, type: 'GOAL', matchId: MATCH_ID },
        ] as any;
      }
      return [];
    });

    const { req, res } = await openSseStream(port, MATCH_ID, { 'Last-Event-ID': '2' });

    const dataPromise = new Promise<string>((resolve) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString();
        if (data.includes('id: 3') && data.includes('id: 4')) {
          resolve(data);
          req.destroy();
        }
      });
    });

    const result = await dataPromise;
    expect(result).toContain('id: 3');
    expect(result).toContain('id: 4');
    // Each replayed seq appears once (Last-Event-ID filter, no duplication from replay itself)
    expect(result.match(/id: 3/g)?.length).toBe(1);
    expect(result.match(/id: 4/g)?.length).toBe(1);
  });

  it('returns proper error when match does not exist', async () => {
    vi.spyOn(prisma.match, 'findUnique').mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: `/api/matches/${MATCH_ID}/events/stream`,
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('MATCH_NOT_FOUND');
  });

  it('cleans up Redis subscription on client disconnect', async () => {
    // Dedicated match id so NUMSUB isn't polluted by earlier tests in this file
    const matchId = '660e8400-e29b-41d4-a716-446655440000';
    vi.spyOn(prisma.match, 'findUnique').mockResolvedValue({ id: matchId } as any);
    vi.spyOn(prisma.matchEvent, 'findMany').mockResolvedValue([]);

    const channel = `match:${matchId}:events`;
    const getSubCount = async () => {
      const [, count] = (await redis.pubsub('NUMSUB', channel)) as [string, number];
      return Number(count);
    };

    const subscribeSpy = vi.spyOn(Redis.prototype, 'subscribe');
    const unsubSpy = vi.spyOn(Redis.prototype, 'unsubscribe');
    const quitSpy = vi.spyOn(Redis.prototype, 'quit');

    const baseline = await getSubCount();
    expect(baseline).toBe(0);

    // Open and close several SSE connections — subscriber count must not grow unbounded
    for (let i = 0; i < 3; i++) {
      const subsBefore = subscribeSpy.mock.calls.length;
      const { req, res } = await openSseStream(port, matchId);
      res.on('data', () => {});

      await waitFor(() => subscribeSpy.mock.calls.length > subsBefore);
      await waitFor(async () => (await getSubCount()) > baseline);

      const quitsBefore = quitSpy.mock.calls.length;
      req.destroy();

      await waitFor(() => quitSpy.mock.calls.length > quitsBefore);
      expect(unsubSpy).toHaveBeenCalled();
      await waitFor(async () => (await getSubCount()) === baseline);
    }

    expect(await getSubCount()).toBe(baseline);
  });
});
