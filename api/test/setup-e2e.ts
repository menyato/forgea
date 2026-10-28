import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import 'dotenv/config';

/**
 * Runs once before the e2e suite: points the app at the separate test database and
 * applies every migration to it, so tests never touch development data.
 */
export default function setup(): void {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url)
    throw new Error('TEST_DATABASE_URL is not set (see api/.env.example)');
  process.env['DATABASE_URL'] = url;
  // Prisma's own entry point run by this Node: no shell, nothing to escape, any OS.
  const prisma = createRequire(import.meta.url).resolve(
    'prisma/build/index.js',
  );
  execFileSync(process.execPath, [prisma, 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: process.env,
  });
}
