import { Match } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { simConfig } from './config';
import { MatchEngine } from './match-engine';

/** Minutes of simulated time between staggered kickoffs (wall-clock = gap * tickMs). */
const KICKOFF_STAGGER_MINUTES = 20;
/** Delay after FULL_TIME before the next fixture kickoff (keeps a NOT_STARTED window). */
const RESTART_DELAY_MINUTES = 10;

class Simulator {
  private engines: MatchEngine[] = [];
  private intervalId?: NodeJS.Timeout;
  private startTimers: NodeJS.Timeout[] = [];

  async init() {
    logger.info('Initializing Match Simulator...');

    const matches = await prisma.match.findMany({
      where: { status: 'NOT_STARTED' },
      take: simConfig.matchCount,
      orderBy: { createdAt: 'asc' },
    });

    if (matches.length === 0) {
      logger.warn('No unstarted matches found for simulation.');
      return;
    }

    this.engines = matches.map((m: Match) => new MatchEngine(m, (e) => this.handleFullTime(e)));

    logger.info(`Initialized ${this.engines.length} match engines.`);

    if (simConfig.autoStart) {
      this.start();
    }
  }

  async start() {
    if (this.intervalId) return;

    logger.info('Starting Match Simulator engines (staggered kickoffs)...');

    this.engines.forEach((engine, i) => {
      const delayMs = i * KICKOFF_STAGGER_MINUTES * simConfig.tickMs;
      if (delayMs === 0) {
        void engine.start().catch((err) => logger.error(err, 'Failed to start match engine'));
      } else {
        const timer = setTimeout(() => {
          void engine.start().catch((err) => logger.error(err, 'Failed to start match engine'));
        }, delayMs);
        this.startTimers.push(timer);
      }
    });

    this.intervalId = setInterval(() => {
      void this.tick();
    }, simConfig.tickMs);
  }

  private async tick() {
    for (const engine of this.engines) {
      await engine.tick().catch((err) => {
        logger.error(err, 'Error in match engine tick');
      });
    }
  }

  /**
   * After FULL_TIME, create a fresh fixture with the same teams so the deploy
   * never becomes a graveyard of finished matches.
   */
  private async handleFullTime(finished: MatchEngine) {
    try {
      const old = finished.getMatch();
      const next = await prisma.match.create({
        data: {
          homeTeamId: old.homeTeamId,
          awayTeamId: old.awayTeamId,
        },
      });

      await prisma.matchStatistic.createMany({
        data: [
          { matchId: next.id, teamId: old.homeTeamId },
          { matchId: next.id, teamId: old.awayTeamId },
        ],
      });

      const replacement = new MatchEngine(next, (e) => this.handleFullTime(e));
      const idx = this.engines.indexOf(finished);
      if (idx >= 0) {
        this.engines[idx] = replacement;
      } else {
        this.engines.push(replacement);
      }

      const delayMs = RESTART_DELAY_MINUTES * simConfig.tickMs;
      logger.info(
        { finishedId: old.id, nextId: next.id, delayMs },
        'Queued fresh match after FULL_TIME'
      );

      const timer = setTimeout(() => {
        void replacement
          .start()
          .catch((err) => logger.error(err, 'Failed to start replacement match'));
      }, delayMs);
      this.startTimers.push(timer);
    } catch (err) {
      logger.error(err, 'Failed to queue replacement match after FULL_TIME');
    }
  }

  stop() {
    for (const timer of this.startTimers) {
      clearTimeout(timer);
    }
    this.startTimers = [];

    for (const engine of this.engines) {
      engine.stop();
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Simulator stopped.');
    }
  }
}

export const simulator = new Simulator();
