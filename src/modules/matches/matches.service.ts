import { matchesRepository } from './matches.repository';
import { GetMatchesQuery } from './matches.schemas';
import { AppError } from '../../utils/errors';

export class MatchesService {
  async getMatches(query: GetMatchesQuery) {
    return matchesRepository.findMatches(query);
  }

  async getMatch(id: string) {
    const match = await matchesRepository.findMatchById(id);
    if (!match) {
      throw new AppError('Match not found', 404, 'MATCH_NOT_FOUND');
    }
    return match;
  }
}

export const matchesService = new MatchesService();
