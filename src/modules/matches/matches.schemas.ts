import { z } from 'zod';
import { MatchStatus } from '@prisma/client';

export const getMatchesQuerySchema = z.object({
  status: z.nativeEnum(MatchStatus).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const getMatchParamsSchema = z.object({
  id: z.string().uuid(),
});

export type GetMatchesQuery = z.infer<typeof getMatchesQuerySchema>;
export type GetMatchParams = z.infer<typeof getMatchParamsSchema>;
