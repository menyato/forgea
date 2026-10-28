import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { createApp, uniqueEmail } from './create-app.js';

const CSRF = { 'x-forgea-csrf': '1' };
const png = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  13,
  0x49,
  0x48,
  0x44,
  0x52,
  ...Array.from({ length: 17 }, () => 0),
]);
const svg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

// The lead route allows 3 submissions per 10 minutes per IP; this file uses exactly 4 calls.
describe('Leads (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app.close());

  const submit = () =>
    request(app.getHttpServer())
      .post('/leads')
      .set(CSRF)
      .field('name', 'Hamad')
      .field('email', uniqueEmail('lead'))
      .field('message', 'A custom enclosure for a sensor board, please.');

  it('accepts an inquiry with a real image and stores the image as clean', async () => {
    const res = await submit()
      .attach('referenceImage', png, 'board.png')
      .expect(201);
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { referenceUpload: true },
    });
    expect(lead.referenceUpload).toMatchObject({
      status: 'CLEAN',
      mimeType: 'image/png',
    });
    expect(lead.referenceUpload?.storageKey).toMatch(
      /^clean\/[0-9a-f-]{36}\.png$/,
    );
    expect(
      existsSync(
        join(resolve('.uploads-test'), lead.referenceUpload!.storageKey),
      ),
    ).toBe(true);
  });

  it('rejects an SVG disguised with an image name, and keeps nothing servable', async () => {
    const res = await submit()
      .attach('referenceImage', svg, {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(res.body.message).toBe('This file type is not accepted');
    const rejected = await prisma.upload.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(rejected.status).toBe('REJECTED');
    expect(
      existsSync(join(resolve('.uploads-test'), rejected.storageKey)),
    ).toBe(false);
  });

  it('rejects fields that are not part of the form', async () => {
    await submit().field('status', 'WON').expect(400);
  });

  it('rate-limits submissions', async () => {
    await submit().expect(429);
  });
});
