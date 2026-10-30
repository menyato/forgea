import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/setup-e2e.ts'],
    // Each test file boots the app against the test database, never the dev one.
    env: { DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '', UPLOAD_DIR: '.uploads-test', MAIL_OUTBOX_DIR: '.outbox-test' },
    // Files share one database; run them one at a time.
    fileParallelism: false,
    // Whole journeys against a real database (the route-by-route access check, a catalog
    // export with every model) take more than the 5 s default.
    testTimeout: 30_000,
  },
});
