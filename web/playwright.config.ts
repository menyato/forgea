import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Real-browser journeys against the built API and storefront, on the separate test
// database (TEST_DATABASE_URL in api/.env). Build first: `pnpm build`.
loadEnv({ path: '../api/.env', quiet: true });
const database = process.env['TEST_DATABASE_URL'];
if (!database)
  throw new Error('TEST_DATABASE_URL is not set (see api/.env.example)');

const API = 'http://localhost:3098';
const WEB = 'http://localhost:5198';
// As in production behind Cloudflare: the storefront forwards each visitor's IP to the API,
// so rate limits apply per visitor (browser/fixtures.ts gives every test its own IP).
const PROXY_SECRET = 'browser-tests-only-proxy-secret-0123456789';

export default defineConfig({
  testDir: './browser',
  globalSetup: './browser/global-setup.ts',
  fullyParallel: false,
  // Whole journeys (customer and studio, several pages each) run ~15 s alone; slower in parallel.
  timeout: 60_000,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: WEB,
    // The Chrome already installed on the machine (or the CI image): no browser download.
    channel: 'chrome',
    trace: 'retain-on-failure',
    // CI runners have no GPU, and Chrome (137+) no longer falls back to software WebGL by
    // itself: without this the 3D canvases never draw there. No effect where a GPU exists.
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    // Software WebGL redraws every frame of an animated scene on the CPU; with reduced motion the
    // scenes draw only when something changes (frameloop "demand"), which a small CI runner can
    // keep up with. Locally the animations stay on, so they are still exercised.
    ...(process.env['CI'] ? { reducedMotion: 'reduce' as const } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' } },
  ],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: `${API}/health`,
      env: {
        PORT: '3098',
        DATABASE_URL: database,
        // The test database's files: shared with the API's e2e tests and the seed below.
        UPLOAD_DIR: '.uploads-test',
        // Emails as files the tests read (browser/mail.ts).
        MAIL_OUTBOX_DIR: '.outbox-browser',
        PUBLIC_WEB_URL: WEB,
        PUBLIC_API_URL: API,
        INTERNAL_PROXY_SECRET: PROXY_SECRET,
      },
      reuseExistingServer: false,
    },
    {
      command:
        'node node_modules/@react-router/serve/bin.cjs ./build/server/index.js',
      url: WEB,
      env: {
        PORT: '5198',
        API_URL: API,
        PUBLIC_API_URL: API,
        PUBLIC_WEB_URL: WEB,
        INTERNAL_PROXY_SECRET: PROXY_SECRET,
        TRUST_CLOUDFLARE: 'true',
      },
      reuseExistingServer: false,
    },
  ],
});
