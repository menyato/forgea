import { defineConfig } from 'vitest/config';

// Unit tests for server modules and shared UI logic; the React Router plugin isn't needed here.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['app/**/*.test.ts'],
    environment: 'node',
  },
});
