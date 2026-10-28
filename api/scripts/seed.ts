// Development seed: the example catalog (designer collection, everyday pieces, options with
// price rules, 3D models), loaded through the catalog importer in "add" mode — so re-running
// is safe and never overwrites what an admin changed. Never for production: real products are
// made in the dashboard or imported with scripts/import-catalog.ts.
// `pnpm --filter @forgea/api db:seed`; run `pnpm build` first (it uses the compiled API).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { CatalogImporter } from '../dist/catalog-transfer/catalog-importer.service.js';
import { PrismaService } from '../dist/database/prisma.service.js';
import { ProductsService } from '../dist/products/products.service.js';
import { exampleCatalog } from '../prisma/example-catalog.ts';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Refusing to seed sample products in production');
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  // How each material prints (for the grams/hours suggestions), where still the column defaults.
  const prisma = app.get(PrismaService);
  const printRates = { PLA: ['1.24', '12'], PETG: ['1.27', '10'], ASA: ['1.07', '9'] };
  for (const [code, [density, rate]] of Object.entries(printRates)) {
    await prisma.material.updateMany({
      where: { code, densityGPerCm3: 1.24, gramsPerHour: 12 },
      data: { densityGPerCm3: density!, gramsPerHour: rate! },
    });
  }
  const report = await app.get(CatalogImporter).import(exampleCatalog(), 'add', null);
  console.log('Example catalog:', JSON.stringify(report));

  // The home page's bed, unless someone already chose it in the dashboard.
  if ((await prisma.product.count({ where: { plateOrder: { not: null } } })) === 0) {
    const slugs = ['forgea-logo', 'twist-vase', 'spiral-tower', 'ribbed-pen-cup', 'honeycomb-shelf'];
    const ids = await Promise.all(
      slugs.map(async (slug) => (await prisma.product.findUniqueOrThrow({ where: { slug } })).id),
    );
    await app.get(ProductsService).setPlate(ids);
  }
} finally {
  await app.close();
}
