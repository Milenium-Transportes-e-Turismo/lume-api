// Compatibility boundary for existing imports. New code should import from
// src/config/env.ts, where the typed Zod schema and validated env object live.
export {
  env,
  envSchema,
  loadEnvironment,
  parseCorsOrigins,
  validateEnvironment,
} from '../../config/env';
export type { Env } from '../../config/env';
