import { prisma } from '../../lib/prisma';
import { MatchStatus } from '@prisma/client';

export class MatchesRepository {
  async findMatches(filters: { status?: MatchStatus; limit: number; offset: number }) {
    return prisma.match.findMany({
      where: filters.status ? { status: filters.status } : undefined,
      take: filters.limit,
      skip: filters.offset,
      include: {
        homeTeam: true,
        awayTeam: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findMatchById(id: string) {
    return prisma.match.findUnique({
      where: { id },
      include: {
        homeTeam: true,
        awayTeam: true,
        events: {
          orderBy: {
            seq: 'asc',
          },
        },
        statistics: true,
      },
    });
  }
}

export const matchesRepository = new MatchesRepository();
