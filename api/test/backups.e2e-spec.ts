import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { BackupsView } from '@forgea/types';
import request from 'supertest';
import { Role } from '../src/generated/prisma/enums.js';
import { CSRF, signedInAs } from './commerce-helpers.js';
import { createApp } from './create-app.js';

const OLD = 'forgea-staging-2026-11-03-033012.tar';
const MANUAL = 'forgea-staging-2026-11-04-101500-manual.tar';
const SAFETY = 'forgea-staging-2026-11-05-090000-before-restore.tar';

/**
 * The Backups page: admins see the server's backups and its disk, download one, and ask for a
 * backup, a restore or a delete, which the server's backup.sh carries out. The website only
 * reads the backups folder and leaves requests: it never changes a backup itself.
 */
describe('Backups (e2e)', () => {
  let app: NestExpressApplication;
  let root: string;
  let admin: Awaited<ReturnType<typeof signedInAs>>;
  const http = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      http().post(url).set(CSRF).set('Cookie', cookie).send(body),
    put: (url: string, body: object) =>
      http().put(url).set(CSRF).set('Cookie', cookie).send(body),
    delete: (url: string) => http().delete(url).set(CSRF).set('Cookie', cookie),
  });
  const queued = async () =>
    Promise.all(
      (await readdir(join(root, 'requests', 'queue'))).map(async (f) =>
        JSON.parse(await readFile(join(root, 'requests', 'queue', f), 'utf8')),
      ),
    );

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'forgea-backups-'));
    await mkdir(join(root, 'backups'));
    await mkdir(join(root, 'requests', 'queue'), { recursive: true });
    for (const [name, bytes] of [
      [OLD, 1000],
      [MANUAL, 2000],
      [SAFETY, 3000],
    ] as const)
      await writeFile(join(root, 'backups', name), Buffer.alloc(bytes, 7));
    // Not backups: never listed, never downloadable.
    await writeFile(join(root, 'backups', 'notes.txt'), 'x');
    await writeFile(
      join(root, 'backups', 'status.json'),
      JSON.stringify({
        running: null,
        last: [
          {
            action: 'backup',
            file: OLD,
            ok: true,
            message: 'Saved',
            by: 'nightly',
            at: '2026-11-03T03:30:12Z',
          },
          {
            action: 'backup',
            file: MANUAL,
            ok: true,
            message: 'Saved',
            by: 'server',
            at: '2026-11-04T10:15:00Z',
          },
        ],
      }),
    );
    process.env['BACKUP_DIR'] = join(root, 'backups');
    process.env['BACKUP_REQUEST_DIR'] = join(root, 'requests');
    app = await createApp();
    admin = await signedInAs(app, Role.ADMIN);
  });
  afterAll(async () => {
    delete process.env['BACKUP_DIR'];
    delete process.env['BACKUP_REQUEST_DIR'];
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('lists the backups newest first, with the disk, what is kept and the latest results', async () => {
    const view = (await as(admin.cookie).get('/backups').expect(200))
      .body as BackupsView;
    if (!view.configured) throw new Error('expected backups to be set up');
    expect(view.items.map((i) => [i.file, i.kind, i.sizeBytes])).toEqual([
      [SAFETY, 'before-restore', 3000],
      [MANUAL, 'manual', 2000],
      [OLD, 'nightly', 1000],
    ]);
    expect(view.items[2]!.createdAt).toBe('2026-11-03T03:30:12.000Z');
    expect(view.disk.backupsBytes).toBe(6000);
    expect(view.disk.freeBytes).toBeGreaterThan(0);
    expect(view.disk.totalBytes).toBeGreaterThan(view.disk.freeBytes);
    expect(view.keep).toBe(5);
    expect(view.last.map((e) => e.file)).toEqual([MANUAL, OLD]);
  });

  it('asks the server for a backup, a restore and a delete; checks each first', async () => {
    const me = as(admin.cookie);
    await me.post('/backups').expect(202);
    // A restore replaces everything since: the environment's name confirms it.
    await me
      .post(`/backups/${MANUAL}/restore`, { confirm: 'production' })
      .expect(400);
    await me
      .post(`/backups/${MANUAL}/restore`, { confirm: 'Staging' })
      .expect(202);
    await me.delete(`/backups/${OLD}`).expect(202);
    // Only real backups, by their exact name.
    await me.delete('/backups/notes.txt').expect(404);
    await me.delete(`/backups/..%2F${OLD}`).expect(404);
    await me
      .delete('/backups/forgea-staging-2020-01-01-000000.tar')
      .expect(404);

    const requests = await queued();
    expect(requests).toEqual(
      expect.arrayContaining([
        { action: 'backup', by: admin.user.id },
        { action: 'restore', file: MANUAL, by: admin.user.id },
        { action: 'delete', file: OLD, by: admin.user.id },
      ]),
    );
    expect(requests).toHaveLength(3);
    // The website never removes a backup itself.
    expect(await readdir(join(root, 'backups'))).toContain(OLD);
    const view = (await me.get('/backups').expect(200)).body as BackupsView;
    expect(view.configured && view.pending).toBe(3);
  });

  it('sets how many to keep, 1 to 30', async () => {
    await as(admin.cookie).put('/backups/settings', { keep: 31 }).expect(400);
    await as(admin.cookie).put('/backups/settings', { keep: 7 }).expect(204);
    expect(
      JSON.parse(
        await readFile(join(root, 'requests', 'settings.json'), 'utf8'),
      ),
    ).toEqual({ keep: 7 });
    const view = (await as(admin.cookie).get('/backups').expect(200))
      .body as BackupsView;
    expect(view.configured && view.keep).toBe(7);
  });

  it('downloads a backup as a file; only admins reach any of it', async () => {
    const res = await as(admin.cookie)
      .get(`/backups/${MANUAL}/download`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((res.body as Buffer).byteLength).toBe(2000);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="${MANUAL}"`,
    );
    for (const role of [Role.STAFF, Role.CUSTOMER]) {
      const other = await signedInAs(app, role);
      await as(other.cookie).get('/backups').expect(403);
      await as(other.cookie).get(`/backups/${MANUAL}/download`).expect(403);
      await as(other.cookie).post('/backups').expect(403);
    }
  });
});
