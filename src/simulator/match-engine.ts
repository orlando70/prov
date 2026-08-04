import { Match, MatchStatus, MatchStatistic } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { eventGenerator, ScheduledEvent } from './event-generator';
import { logger } from '../lib/logger';

export class MatchEngine {
  private match: Match;
  private scheduledEvents: ScheduledEvent[] = [];
  private isTicking: boolean = false;
  
  constructor(match: Match) {
    this.match = match;
  }

  async start() {
    this.scheduledEvents = eventGenerator.generateMatchEvents();
    
    await this.updateStatus('FIRST_HALF');
    this.isTicking = true;
    
    // Optional: write startedAt to DB here.
    await prisma.match.update({
      where: { id: this.match.id },
      data: { startedAt: new Date() }
    });
  }

  async tick() {
    if (!this.isTicking) return;

    if (this.match.status === 'FIRST_HALF' && this.match.minute >= 45) {
      await this.updateStatus('HALF_TIME');
      this.isTicking = false;
      setTimeout(() => this.resumeHalfTime(), 5000); // 5s half time
      return;
    }

    if (this.match.status === 'SECOND_HALF' && this.match.minute >= 90) {
      await this.updateStatus('FULL_TIME');
      this.isTicking = false;
      return;
    }

    this.match.minute += 1;
    await prisma.match.update({ where: { id: this.match.id }, data: { minute: this.match.minute } });
    
    const eventsNow = [
      ...this.scheduledEvents.filter(e => e.minute === this.match.minute),
      ...eventGenerator.generateContinuousEvents(this.match.minute, false)
    ];

    if (eventsNow.length > 0) {
      await this.processEvents(eventsNow);
    } else {
      await this.broadcastScore(); // always broadcast score/minute if ticked
    }
  }

  private async resumeHalfTime() {
    await this.updateStatus('SECOND_HALF');
    this.isTicking = true;
  }

  private async updateStatus(status: MatchStatus) {
    this.match.status = status;
    await prisma.match.update({ where: { id: this.match.id }, data: { status } });
    await this.broadcast('STATUS', status);
  }

  private async processEvents(events: ScheduledEvent[]) {
    let homeScoreChanged = false;
    let awayScoreChanged = false;

    for (const evt of events) {
      const isHome = Math.random() > 0.5;
      const teamId = isHome ? this.match.homeTeamId : this.match.awayTeamId;

      if (evt.type === 'GOAL') {
        if (isHome) {
          this.match.homeScore++;
          homeScoreChanged = true;
        } else {
          this.match.awayScore++;
          awayScoreChanged = true;
        }
      }

      // Record event to DB
      const recorded = await prisma.matchEvent.create({
        data: {
          matchId: this.match.id,
          minute: this.match.minute,
          type: evt.type,
          teamId,
        }
      });

      // Update statistics
      await this.updateStatistics(teamId, evt.type);

      // Broadcast event
      await this.broadcast('EVENT', recorded);
    }

    if (homeScoreChanged || awayScoreChanged) {
      await prisma.match.update({
        where: { id: this.match.id },
        data: { homeScore: this.match.homeScore, awayScore: this.match.awayScore }
      });
    }

    await this.broadcastScore();
    await this.broadcastStats();
  }

  private async updateStatistics(teamId: string, eventType: string) {
    const updateData: any = {};
    if (eventType === 'GOAL' || eventType === 'SHOT') {
      updateData.shotsTotal = { increment: 1 };
      if (eventType === 'GOAL') updateData.shotsOnTarget = { increment: 1 };
      else if (Math.random() > 0.5) updateData.shotsOnTarget = { increment: 1 };
    } else if (eventType === 'FOUL') {
      updateData.fouls = { increment: 1 };
    } else if (eventType === 'YELLOW_CARD') {
      updateData.yellowCards = { increment: 1 };
    } else if (eventType === 'RED_CARD') {
      updateData.redCards = { increment: 1 };
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.matchStatistic.update({
        where: { matchId_teamId: { matchId: this.match.id, teamId } },
        data: updateData
      });
    }
  }

  private async broadcastScore() {
    await this.broadcast('SCORE', {
      homeScore: this.match.homeScore,
      awayScore: this.match.awayScore,
      minute: this.match.minute
    });
  }

  private async broadcastStats() {
    const stats = await prisma.matchStatistic.findMany({ where: { matchId: this.match.id } });
    await this.broadcast('STATS', stats);
  }

  private async broadcast(kind: string, data: any) {
    const payload = JSON.stringify({ kind, data });
    await redis.publish(`match:${this.match.id}:events`, payload);
  }
}
