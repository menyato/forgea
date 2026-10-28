import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Migrates the test database and adds the sample products (both are idempotent). */
export default function globalSetup(): void {
  const api = fileURLToPath(new URL('../../api/', import.meta.url));
  const fromApi = createRequire(`${api}package.json`);
  const env = {
    ...process.env,
    DATABASE_URL: process.env['TEST_DATABASE_URL'],
    // Same folder as the test API server (playwright.config.ts) and the API e2e tests.
    UPLOAD_DIR: '.uploads-test',
  };
  const run = (script: string, args: string[]) =>
    execFileSync(process.execPath, [fromApi.resolve(script), ...args], {
      cwd: api,
      env,
      stdio: 'inherit',
    });
  run('prisma/build/index.js', ['migrate', 'deploy']);
  // The example catalog, through the catalog importer (needs the built API).
  execFileSync(process.execPath, ['scripts/seed.ts'], {
    cwd: api,
    env,
    stdio: 'inherit',
  });
}
