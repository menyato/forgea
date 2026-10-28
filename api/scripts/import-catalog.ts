// Imports a catalog file (exported from the dashboard, or written by hand — see
// docs/CATALOG_IMPORT.md) into the database DATABASE_URL points at, including production.
// The same importer as the dashboard's Import button, for files too large to upload.
//
//   pnpm --filter @forgea/api catalog:import path/to/forgea-catalog.json           # add missing
//   pnpm --filter @forgea/api catalog:import path/to/forgea-catalog.json --update  # also overwrite
//
// Run `pnpm build` first (it uses the compiled API). The import is audit-logged.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { AuditLogService } from '../dist/audit-log/audit-log.service.js';
import { CatalogImporter } from '../dist/catalog-transfer/catalog-importer.service.js';

const [path, ...flags] = process.argv.slice(2);
if (!path || flags.some((f) => f !== '--update')) {
  console.error('Usage: catalog:import <file.json> [--update]');
  process.exit(2);
}
const mode = flags.includes('--update') ? 'update' : 'add';
const catalog: unknown = JSON.parse(await readFile(path, 'utf8'));

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  const report = await app.get(CatalogImporter).import(catalog, mode, null);
  // No signed-in person here: the entry records the command instead.
  await app.get(AuditLogService).record({
    actorUserId: null,
    action: 'catalog.import',
    targetType: 'Catalog',
    targetId: 'catalog',
    ipAddress: null,
    metadata: { via: 'scripts/import-catalog.ts', mode, report: { ...report } },
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
