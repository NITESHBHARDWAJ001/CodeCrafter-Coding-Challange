import 'dotenv/config';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().default(0),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),

  ALLOWED_EMAIL_DOMAINS: z.string().default(''),
  BOOTSTRAP_ADMIN_EMAILS: z.string().default(''),

  ENABLE_SCHEDULER: bool.default('true'),
  REQUIRE_LEETCODE_VALIDATION: bool.default('true'),

  LEETCODE_GRAPHQL_URL: z.string().url().default('https://leetcode.com/graphql'),
  LEETCODE_TIMEOUT_MS: z.coerce.number().default(10_000),
  LEETCODE_MAX_RETRIES: z.coerce.number().default(3),
  LEETCODE_REQUESTS_PER_SECOND: z.coerce.number().default(4),
  LEETCODE_CACHE_TTL_SECONDS: z.coerce.number().default(120),
  SYNC_CONCURRENCY: z.coerce.number().default(4),
  COMPLETED_PROGRAM_SYNC_GRACE_HOURS: z.coerce.number().default(48),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${msg}`);
  }
  return parsed.data;
}

export const env: Env = load();
export const list = (v: string): string[] =>
  v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
