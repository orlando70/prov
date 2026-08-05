import { z } from 'zod';
import { env } from '../../config/env';

export const chatJoinSchema = z.object({
  matchId: z.string().uuid(),
  username: z.string().min(1).max(50),
});

export const chatLeaveSchema = z.object({
  matchId: z.string().uuid(),
});

export const chatMessageSchema = z.object({
  matchId: z.string().uuid(),
  message: z
    .string()
    // eslint-disable-next-line no-control-regex
    .transform((val) => val.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim())
    .pipe(z.string().min(1).max(env.CHAT_MAX_MESSAGE_LENGTH)),
});

export const chatTypingSchema = z.object({
  matchId: z.string().uuid(),
});

export type ChatJoinPayload = z.infer<typeof chatJoinSchema>;
export type ChatLeavePayload = z.infer<typeof chatLeaveSchema>;
export type ChatMessagePayload = z.infer<typeof chatMessageSchema>;
export type ChatTypingPayload = z.infer<typeof chatTypingSchema>;
