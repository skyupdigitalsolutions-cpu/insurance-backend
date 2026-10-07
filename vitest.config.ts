import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/insurance_test?directConnection=true',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
      JWT_ACCESS_SECRET: 'test-only-access-secret-0123456789-abcdefghijklmnop',
      OTP_SECRET: 'test-only-otp-secret-0123456789-abcdefghijklmnopqrs',
      OTP_FIXED_CODE: '123456',
      FILE_URL_SECRET: 'test-only-file-secret-0123456789-abcdefghijklmnopq',
      UPLOADS_DIR: './.test-uploads',
      RATE_LIMIT_ENABLED: 'false',
      API_DOCS_ENABLED: 'true',
    },
  },
});