import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

/** Boots the real AppModule with the same HTTP security as production (configureApp). */
export async function createApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

/** A unique address per test so runs never collide. */
export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Parses Set-Cookie headers into name → { value, attributes }. */
export function cookiesFrom(setCookie: string[] | string | undefined) {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return Object.fromEntries(
    list.map((raw) => {
      const [pair = '', ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      return [
        pair.slice(0, eq),
        {
          value: decodeURIComponent(pair.slice(eq + 1)),
          attrs: attrs.map((a) => a.toLowerCase()),
        },
      ];
    }),
  ) as Record<string, { value: string; attrs: string[] }>;
}
