import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildApp } from '../../app';
import { matchesService } from './matches.service';
import { MatchStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';

describe('Matches Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/matches returns teams, score, minute, status for all matches', async () => {
    const mockMatches = [
      {
        id: 'uuid-1',
        homeTeam: 'A',
        awayTeam: 'B',
        homeScore: 0,
        awayScore: 0,
        minute: 10,
        status: MatchStatus.FIRST_HALF,
      },
    ];
    vi.spyOn(matchesService, 'getMatches').mockResolvedValue(mockMatches as any);

    const response = await app.inject({
      method: 'GET',
      url: '/api/matches',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual(mockMatches);
    expect(json.meta.requestId).toBeDefined();
    for (const match of json.data) {
      expect(match).toEqual(
        expect.objectContaining({
          homeTeam: expect.any(String),
          awayTeam: expect.any(String),
          homeScore: expect.any(Number),
          awayScore: expect.any(Number),
          minute: expect.any(Number),
          status: expect.any(String),
        })
      );
    }
  });

  it('GET /api/matches/:id returns a match with events and stats', async () => {
    const mockMatch = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      homeTeam: 'A',
      awayTeam: 'B',
      homeScore: 0,
      awayScore: 0,
      minute: 10,
      status: MatchStatus.FIRST_HALF,
      events: [],
      statistics: null
    };
    vi.spyOn(matchesService, 'getMatch').mockResolvedValue(mockMatch as any);

    const response = await app.inject({
      method: 'GET',
      url: '/api/matches/550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual(mockMatch);
  });

  it('GET /api/matches/:id returns 404 for non-existent match ID', async () => {
    vi.spyOn(matchesService, 'getMatch').mockRejectedValue({
      statusCode: 404,
      code: 'MATCH_NOT_FOUND',
      message: 'Match not found'
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/matches/550e8400-e29b-41d4-a716-446655440000',
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.message).toBe('Match not found');
  });

  it('GET /api/matches/:id returns 400 for malformed match ID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/matches/invalid-uuid',
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });
});
