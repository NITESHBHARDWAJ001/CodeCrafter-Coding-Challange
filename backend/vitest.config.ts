import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_ANON_KEY: 'test-anon-key-0000000000',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key-0000000000',
      ENABLE_SCHEDULER: 'false',
      REQUIRE_LEETCODE_VALIDATION: 'false',
      LOG_LEVEL: 'silent',
    },
  },
});
