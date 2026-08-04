import { MatchEventType } from '@prisma/client';

export interface ScheduledEvent {
  type: MatchEventType;
  minute: number;
}

export class EventGenerator {
  generateMatchEvents(): ScheduledEvent[] {
    const events: ScheduledEvent[] = [];
    
    // Goals: ~2.5 per match on average. We'll distribute them throughout 90 mins.
    const goalCount = this.poissonRandom(2.5);
    for (let i = 0; i < goalCount; i++) {
      events.push({ type: 'GOAL', minute: this.randomMinute() });
    }

    // Yellow cards: ~3.5 per match
    const yellowCount = this.poissonRandom(3.5);
    for (let i = 0; i < yellowCount; i++) {
      events.push({ type: 'YELLOW_CARD', minute: this.randomMinute() });
    }

    // Red cards: ~8% chance per match
    if (Math.random() < 0.08) {
      events.push({ type: 'RED_CARD', minute: this.randomMinute() });
    }

    // Substitutions: 3-5 per team (6-10 total), weighted > 60th minute
    const subCount = Math.floor(Math.random() * 5) + 6;
    for (let i = 0; i < subCount; i++) {
      events.push({ type: 'SUBSTITUTION', minute: this.randomMinuteAfter60() });
    }

    return events.sort((a, b) => a.minute - b.minute);
  }

  generateContinuousEvents(currentMinute: number, isHalfTime: boolean): ScheduledEvent[] {
    if (isHalfTime) return [];
    
    const events: ScheduledEvent[] = [];
    
    // Every minute, maybe a foul or a shot
    if (Math.random() < 0.3) {
      events.push({ type: 'FOUL', minute: currentMinute });
    }
    
    if (Math.random() < 0.2) {
      events.push({ type: 'SHOT', minute: currentMinute });
    }

    return events;
  }

  private poissonRandom(lambda: number): number {
    let L = Math.exp(-lambda);
    let p = 1.0;
    let k = 0;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  private randomMinute(): number {
    return Math.floor(Math.random() * 90) + 1;
  }

  private randomMinuteAfter60(): number {
    return Math.floor(Math.random() * 30) + 61; // 61 to 90
  }
}

export const eventGenerator = new EventGenerator();
