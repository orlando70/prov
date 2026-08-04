import { matchesRepository } from './matches.repository';
import { GetMatchesQuery } from './matches.schemas';

export class MatchesService {
  async getMatches(query: GetMatchesQuery) {
    return matchesRepository.findMatches(query);
  }

  async getMatch(id: string) {
    const match = await matchesRepository.findMatchById(id);
    if (!match) {
      const error = new Error('Match not found');
      (error as any).statusCode = 404;
      (error as any).code = 'MATCH_NOT_FOUND';
      throw error;
    }
    return match;
  }
}

export const matchesService = new MatchesService();
