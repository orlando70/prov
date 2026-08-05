import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { simulator } from './simulator';
import { eventGenerator } from './event-generator';
import { simConfig } from './config';
import { prisma } from '../lib/prisma';
import { MatchStatus } from '@prisma/client';
import { MatchEngine } from './match-engine';

describe('Simulator & Event Generator', () => {
  beforeAll(() => {
    // Override SIM_TICK_MS to a very small value to avoid long wall-clock waits
    simConfig.tickMs = 1;
    simConfig.matchCount = 5;
  });

  afterAll(() => {
    simulator.stop();
  });

  it('event generator produces realistic distributions over N matches', () => {
    const N = 1000;
    let totalGoals = 0;
    let totalYellows = 0;
    let totalReds = 0;
    let totalSubs = 0;
    let subsBefore60 = 0;

    for (let i = 0; i < N; i++) {
      const events = eventGenerator.generateMatchEvents();
      totalGoals += events.filter((e) => e.type === 'GOAL').length;
      totalYellows += events.filter((e) => e.type === 'YELLOW_CARD').length;
      totalReds += events.filter((e) => e.type === 'RED_CARD').length;

      const subs = events.filter((e) => e.type === 'SUBSTITUTION');
      totalSubs += subs.length;
      subsBefore60 += subs.filter((e) => e.minute < 60).length;
    }

    const avgGoals = totalGoals / N;
    const avgYellows = totalYellows / N;
    const avgReds = totalReds / N;
    const avgSubs = totalSubs / N;

    // Spec: goals ~2.5, yellow 3-4, red rare, subs 3-5/team (6-10 total) mostly after 60'
    expect(avgGoals).toBeGreaterThanOrEqual(1.5);
    expect(avgGoals).toBeLessThanOrEqual(3.5);

    expect(avgYellows).toBeGreaterThanOrEqual(2);
    expect(avgYellows).toBeLessThanOrEqual(5);

    expect(avgReds).toBeLessThanOrEqual(0.5);

    expect(avgSubs).toBeGreaterThanOrEqual(6);
    expect(avgSubs).toBeLessThanOrEqual(10);
    expect(subsBefore60).toBe(0);

    // Continuous fouls/shots: roughly foul every 2-3 min (~0.3-0.5/min), shot every 3-5 (~0.2-0.33/min)
    let fouls = 0;
    let shots = 0;
    const minutes = 90;
    for (let m = 1; m <= minutes; m++) {
      for (let i = 0; i < N; i++) {
        const continuous = eventGenerator.generateContinuousEvents(m, false);
        fouls += continuous.filter((e) => e.type === 'FOUL').length;
        shots += continuous.filter((e) => e.type === 'SHOT').length;
      }
    }
    const foulRate = fouls / (N * minutes);
    const shotRate = shots / (N * minutes);
    expect(foulRate).toBeGreaterThan(0.2);
    expect(foulRate).toBeLessThan(0.4);
    expect(shotRate).toBeGreaterThan(0.1);
    expect(shotRate).toBeLessThan(0.3);
  });

  it('simulator runs 3-5 concurrent matches', async () => {
    const mockMatches = [
      { id: 'm1', status: MatchStatus.NOT_STARTED, minute: 0, homeScore: 0, awayScore: 0 },
      { id: 'm2', status: MatchStatus.NOT_STARTED, minute: 0, homeScore: 0, awayScore: 0 },
      { id: 'm3', status: MatchStatus.NOT_STARTED, minute: 0, homeScore: 0, awayScore: 0 },
      { id: 'm4', status: MatchStatus.NOT_STARTED, minute: 0, homeScore: 0, awayScore: 0 },
    ];
    vi.spyOn(prisma.match, 'findMany').mockResolvedValue(mockMatches as any);

    await simulator.init();

    expect((simulator as any).engines.length).toBe(4);
    expect((simulator as any).engines.length).toBeGreaterThanOrEqual(3);
    expect((simulator as any).engines.length).toBeLessThanOrEqual(5);
  });

  it('a single match throwing does not crash others', async () => {
    const engine1 = { start: vi.fn(), tick: vi.fn().mockRejectedValue(new Error('Crash')) } as any;
    const engine2 = { start: vi.fn(), tick: vi.fn().mockResolvedValue(true) } as any;

    (simulator as any).engines = [engine1, engine2];

    await (simulator as any).tick();

    expect(engine1.tick).toHaveBeenCalled();
    expect(engine2.tick).toHaveBeenCalled();
  });

  it('engine correctly transitions lifecycle', async () => {
    const match = {
      id: 'm_lifecycle',
      status: MatchStatus.FIRST_HALF,
      minute: 44,
      homeScore: 0,
      awayScore: 0,
    } as any;
    const engine = new MatchEngine(match);

    vi.spyOn(prisma.match, 'update').mockResolvedValue(match);
    vi.spyOn(engine as any, 'broadcast').mockResolvedValue(undefined);
    vi.spyOn(engine as any, 'broadcastScore').mockResolvedValue(undefined);
    vi.spyOn(engine as any, 'broadcastStats').mockResolvedValue(undefined);
    vi.spyOn(prisma, '$transaction').mockImplementation(async () => undefined);

    (engine as any).isTicking = true;
    (engine as any).scheduledEvents = [];

    await engine.tick();
    expect(match.minute).toBe(45);

    await engine.tick();
    expect(match.status).toBe(MatchStatus.HALF_TIME);
    expect((engine as any).isTicking).toBe(false);

    await (engine as any).resumeHalfTime();
    expect(match.status).toBe(MatchStatus.SECOND_HALF);
    expect((engine as any).isTicking).toBe(true);

    match.minute = 89;

    await engine.tick();
    expect(match.minute).toBe(90);

    await engine.tick();
    expect(match.status).toBe(MatchStatus.FULL_TIME);
    expect((engine as any).isTicking).toBe(false);
  });
});
