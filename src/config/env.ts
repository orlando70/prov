import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  CORS_ORIGIN: z.string(),

  SIM_MATCH_COUNT: z.coerce.number().default(4),
  SIM_TICK_MS: z.coerce.number().default(1000),
  SIM_AUTOSTART: z.coerce.boolean().default(true),

  CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().default(500),
  CHAT_RATE_LIMIT_MAX: z.coerce.number().default(5),
  CHAT_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(10000),
  TYPING_TIMEOUT_MS: z.coerce.number().default(3000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const env = envSchema.parse(process.env);
