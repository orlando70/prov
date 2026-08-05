import { Match, MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { eventGenerator, ScheduledEvent } from './event-generator';

export type FullTimeHandler = (engine: MatchEngine) => void | Promise<void>;

export class MatchEngine {
  private match: Match;
  private scheduledEvents: ScheduledEvent[] = [];
  private isTicking: boolean = false;
  private halfTimeTimer?: NodeJS.Timeout;
  private onFullTime?: FullTimeHandler;

  constructor(match: Match, onFullTime?: FullTimeHandler) {
    this.match = match;
    this.onFullTime = onFullTime;
  }

  getMatch(): Match {
    return this.match;
  }

  async start() {
    this.scheduledEvents = eventGenerator.generateMatchEvents();

    await this.updateStatus('FIRST_HALF');
    this.isTicking = true;

    await prisma.match.update({
      where: { id: this.match.id },
      data: { startedAt: new Date() },
    });
  }

  async tick() {
    if (!this.isTicking) return;

    if (this.match.status === 'FIRST_HALF' && this.match.minute >= 45) {
      await this.updateStatus('HALF_TIME');
      this.isTicking = false;
      this.halfTimeTimer = setTimeout(() => {
        void this.resumeHalfTime();
      }, 5000);
      return;
    }

    if (this.match.status === 'SECOND_HALF' && this.match.minute >= 90) {
      await this.updateStatus('FULL_TIME');
      this.isTicking = false;
      if (this.onFullTime) {
        await this.onFullTime(this);
      }
      return;
    }

    this.match.minute += 1;

    const eventsNow = [
      ...this.scheduledEvents.filter((e) => e.minute === this.match.minute),
      ...eventGenerator.generateContinuousEvents(this.match.minute, false),
    ];

    const broadcasts: { kind: string; data: unknown }[] = [];

    await prisma.$transaction(async (tx) => {
      let homeScore = this.match.homeScore;
      let awayScore = this.match.awayScore;

      for (const evt of eventsNow) {
        const isHome = Math.random() > 0.5;
        const teamId = isHome ? this.match.homeTeamId : this.match.awayTeamId;

        if (evt.type === 'GOAL') {
          if (isHome) homeScore++;
          else awayScore++;
        }

        const recorded = await tx.matchEvent.create({
          data: {
            matchId: this.match.id,
            minute: this.match.minute,
            type: evt.type,
            teamId,
          },
        });
        broadcasts.push({ kind: 'EVENT', data: recorded });

        const updateData: Prisma.MatchStatisticUpdateInput = {};
        if (evt.type === 'GOAL' || evt.type === 'SHOT') {
          updateData.shotsTotal = { increment: 1 };
          if (evt.type === 'GOAL') updateData.shotsOnTarget = { increment: 1 };
          else if (Math.random() > 0.5) updateData.shotsOnTarget = { increment: 1 };
        } else if (evt.type === 'FOUL') {
          updateData.fouls = { increment: 1 };
        } else if (evt.type === 'YELLOW_CARD') {
          updateData.yellowCards = { increment: 1 };
        } else if (evt.type === 'RED_CARD') {
          updateData.redCards = { increment: 1 };
        }

        if (Object.keys(updateData).length > 0) {
          await tx.matchStatistic.update({
            where: { matchId_teamId: { matchId: this.match.id, teamId } },
            data: updateData,
          });
        }
      }

      this.match.homeScore = homeScore;
      this.match.awayScore = awayScore;

      await tx.match.update({
        where: { id: this.match.id },
        data: {
          minute: this.match.minute,
          homeScore: this.match.homeScore,
          awayScore: this.match.awayScore,
        },
      });
    });

    for (const b of broadcasts) {
      await this.broadcast(b.kind, b.data);
    }

    await this.broadcastScore();
    if (eventsNow.length > 0) {
      await this.broadcastStats();
    }
  }

  stop() {
    if (this.halfTimeTimer) {
      clearTimeout(this.halfTimeTimer);
      this.halfTimeTimer = undefined;
    }
    this.isTicking = false;
  }

  private async resumeHalfTime() {
    this.halfTimeTimer = undefined;
    await this.updateStatus('SECOND_HALF');
    this.isTicking = true;
  }

  private async updateStatus(status: MatchStatus) {
    this.match.status = status;
    await prisma.match.update({ where: { id: this.match.id }, data: { status } });
    await this.broadcast('STATUS', status);
  }

  private async broadcastScore() {
    await this.broadcast('SCORE', {
      homeScore: this.match.homeScore,
      awayScore: this.match.awayScore,
      minute: this.match.minute,
    });
  }

  private async broadcastStats() {
    const stats = await prisma.matchStatistic.findMany({ where: { matchId: this.match.id } });
    await this.broadcast('STATS', stats);
  }

  private async broadcast(kind: string, data: unknown) {
    const payload = JSON.stringify({ kind, data });
    await redis.publish(`match:${this.match.id}:events`, payload);
  }
}
