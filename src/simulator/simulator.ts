import { prisma } from '../lib/prisma';
import { simConfig } from './config';
import { MatchEngine } from './match-engine';
import { logger } from '../lib/logger';
import { Match } from '@prisma/client';

class Simulator {
  private engines: MatchEngine[] = [];
  private intervalId?: NodeJS.Timeout;

  async init() {
    logger.info('Initializing Match Simulator...');
    
    // Find unstarted matches up to SIM_MATCH_COUNT
    const matches = await prisma.match.findMany({
      where: { status: 'NOT_STARTED' },
      take: simConfig.matchCount,
    });

    if (matches.length === 0) {
      logger.warn('No unstarted matches found for simulation.');
      return;
    }

    this.engines = matches.map((m: Match) => new MatchEngine(m));
    
    logger.info(`Initialized ${this.engines.length} match engines.`);

    if (simConfig.autoStart) {
      this.start();
    }
  }

  async start() {
    if (this.intervalId) return;

    logger.info('Starting Match Simulator engines...');
    
    for (const engine of this.engines) {
      await engine.start();
    }

    this.intervalId = setInterval(() => {
      this.tick();
    }, simConfig.tickMs);
  }

  private async tick() {
    for (const engine of this.engines) {
      await engine.tick().catch(err => {
        logger.error(err, 'Error in match engine tick');
      });
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      logger.info('Simulator stopped.');
    }
  }
}

export const simulator = new Simulator();
