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
  const sql = (input: string) =>
    execFileSync(
      process.execPath,
      [fromApi.resolve('prisma/build/index.js'), 'db', 'execute', '--stdin'],
      { cwd: api, env, input, stdio: ['pipe', 'inherit', 'inherit'] },
    );
  run('prisma/build/index.js', ['migrate', 'deploy']);
  // Prices to the cent, as the API e2e setup does (its tests and these share the database,
  // and either may run first): the whole-dollar rounding has its own tests.
  sql(
    'UPDATE "pricing_settings" SET "priceStep" = 0.01, "depositOnCustom" = true, "depositAboveTotal" = NULL WHERE "id" = 1;',
  );
  // The example catalog, through the catalog importer (needs the built API).
  execFileSync(process.execPath, ['scripts/seed.ts'], {
    cwd: api,
    env,
    stdio: 'inherit',
  });
  // A reel of every colour the catalog sells, in each material: prints only take from
  // filaments on the shelf (the site never adds one), as a real studio's would be.
  sql(`INSERT INTO "stock_items" ("id", "materialId", "colour", "lowStockGrams", "updatedAt")
    SELECT gen_random_uuid(), m."id", c."colour", m."lowStockThresholdGrams", now()
    FROM "materials" m
    CROSS JOIN (
      SELECT "label" AS "colour" FROM "option_values" WHERE "swatchHex" IS NOT NULL
      UNION SELECT "colour" FROM "product_colours" WHERE "colour" <> ''
    ) c
    ON CONFLICT ("materialId", "colour") DO NOTHING;`);
}
