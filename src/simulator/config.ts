import { env } from '../config/env';

export const simConfig = {
  tickMs: env.SIM_TICK_MS,
  matchCount: env.SIM_MATCH_COUNT,
  autoStart: env.SIM_AUTOSTART,
};
