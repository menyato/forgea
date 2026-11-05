import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  readdir,
  readFile,
  rename,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  BackupEvent,
  BackupItem,
  BackupRunning,
  BackupsView,
} from '@forgea/types';
import type { EnvironmentVariables } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';

/** backup.sh's names: forgea-<env>-<yyyy-mm-dd-hhmmss>[-label].tar */
const NAME =
  /^forgea-(production|staging)-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})(?:-([a-z]{1,20}(?:-[a-z]{1,20})?))?\.tar$/;
const DEFAULT_KEEP = 5;

/**
 * The dashboard's Backups page. The server's backup.sh makes, restores and deletes backups; this
 * only reads them (the folder is mounted read-only) and leaves requests for it in a queue it
 * checks field by field. So the website can't alter or remove a backup by itself, even if it
 * were taken over: the worst it could do is ask for one more.
 */
@Injectable()
export class BackupsService {
  private readonly dir: string | undefined;
  private readonly requests: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.dir = config.get('BACKUP_DIR', { infer: true });
    this.requests = config.get('BACKUP_REQUEST_DIR', { infer: true });
  }

  async view(): Promise<BackupsView> {
    if (!this.dir || !this.requests) return { configured: false };
    // Set, but the server hasn't made the folder yet: nothing to show.
    if (
      !(await stat(this.dir).then(
        (d) => d.isDirectory(),
        () => false,
      ))
    )
      return { configured: false };
    const [items, disk, status, keep, pending] = await Promise.all([
      this.items(),
      statfs(this.dir),
      this.status(),
      this.keep(),
      readdir(join(this.requests, 'queue')).then(
        (f) => f.filter((n) => n.endsWith('.json')).length,
        () => 0,
      ),
    ]);
    return {
      configured: true,
      disk: {
        totalBytes: disk.blocks * disk.bsize,
        freeBytes: disk.bavail * disk.bsize,
        backupsBytes: items.reduce((s, i) => s + i.sizeBytes, 0),
      },
      keep,
      items,
      running: status.running,
      last: await this.withNames(status.last),
      pending,
    };
  }

  /** Back up now (the server starts within a second or two). */
  async backupNow(by: string): Promise<void> {
    await this.ask({ action: 'backup', by });
  }

  /** Replace this environment's data with a backup's; `confirm` must be the environment's name. */
  async restore(file: string, confirm: string, by: string): Promise<void> {
    const item = await this.require(file);
    if (confirm.trim().toLowerCase() !== item.environment) {
      throw new BadRequestException(
        `Type ${item.environment} to confirm: everything since this backup is replaced`,
      );
    }
    await this.ask({ action: 'restore', file, by });
  }

  async remove(file: string, by: string): Promise<void> {
    await this.require(file);
    await this.ask({ action: 'delete', file, by });
  }

  /** How many backups to keep (older ones go after each new one). */
  async setKeep(keep: number): Promise<void> {
    const { requests } = this.configured();
    const tmp = join(requests, `.settings-${randomBytes(4).toString('hex')}`);
    await writeFile(tmp, JSON.stringify({ keep }) + '\n', { mode: 0o640 });
    await rename(tmp, join(requests, 'settings.json'));
  }

  async download(
    file: string,
  ): Promise<{ stream: Readable; size: number; name: string }> {
    const item = await this.require(file);
    const { dir } = this.configured();
    return {
      stream: createReadStream(join(dir, item.file)),
      size: item.sizeBytes,
      name: item.file,
    };
  }

  /** Who asked, by email (requests carry the account id; "nightly" and "server" stay). */
  private async withNames(events: BackupEvent[]): Promise<BackupEvent[]> {
    const ids = [...new Set(events.map((e) => e.by))].filter((by) =>
      /^[0-9a-f-]{36}$/.test(by),
    );
    if (ids.length === 0) return events;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    });
    const email = new Map(users.map((u) => [u.id, u.email]));
    return events.map((e) => ({ ...e, by: email.get(e.by) ?? e.by }));
  }

  private configured(): { dir: string; requests: string } {
    if (!this.dir || !this.requests)
      throw new ServiceUnavailableException(
        'Backups are not set up on this server',
      );
    return { dir: this.dir, requests: this.requests };
  }

  /** An existing backup by its exact name (nothing else in the folder can be named). */
  private async require(
    file: string,
  ): Promise<BackupItem & { environment: string }> {
    const parsed = NAME.exec(file);
    const item = parsed && (await this.items()).find((i) => i.file === file);
    if (!parsed || !item) throw new NotFoundException('No such backup');
    return { ...item, environment: parsed[1]! };
  }

  private async items(): Promise<BackupItem[]> {
    const { dir } = this.configured();
    const names = (await readdir(dir)).filter((n) => NAME.test(n));
    const items = await Promise.all(
      names.map(async (file) => {
        const m = NAME.exec(file)!;
        const size = (await stat(join(dir, file))).size;
        return {
          file,
          createdAt: new Date(
            `${m[2]}-${m[3]}-${m[4]}T${m[5]}:${m[6]}:${m[7]}Z`,
          ).toISOString(),
          sizeBytes: size,
          kind: (m[8] === 'before-restore'
            ? 'before-restore'
            : m[8] === 'manual'
              ? 'manual'
              : 'nightly') as BackupItem['kind'],
        };
      }),
    );
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async keep(): Promise<number> {
    const { requests } = this.configured();
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(requests, 'settings.json'), 'utf8'),
      );
      const keep =
        typeof raw === 'object' && raw !== null && 'keep' in raw
          ? raw.keep
          : null;
      return typeof keep === 'number' &&
        Number.isInteger(keep) &&
        keep >= 1 &&
        keep <= 30
        ? keep
        : DEFAULT_KEEP;
    } catch {
      return DEFAULT_KEEP;
    }
  }

  /** What backup.sh last wrote: what is running, and its latest results (newest first). */
  private async status(): Promise<{
    running: BackupRunning | null;
    last: BackupEvent[];
  }> {
    const { dir } = this.configured();
    try {
      const raw = JSON.parse(
        await readFile(join(dir, 'status.json'), 'utf8'),
      ) as { running?: unknown; last?: unknown };
      const running =
        raw.running && typeof raw.running === 'object'
          ? (raw.running as BackupRunning)
          : null;
      const last = Array.isArray(raw.last)
        ? (raw.last as BackupEvent[]).filter(
            (e) =>
              typeof e === 'object' &&
              e !== null &&
              typeof e.action === 'string',
          )
        : [];
      return { running, last: last.reverse() };
    } catch {
      return { running: null, last: [] };
    }
  }

  /** A request for backup.sh, written whole before it appears in the queue it watches. */
  private async ask(request: {
    action: 'backup' | 'restore' | 'delete';
    file?: string;
    by: string;
  }): Promise<void> {
    const { requests } = this.configured();
    const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const tmp = join(requests, `.request-${id}`);
    await writeFile(tmp, JSON.stringify(request) + '\n', { mode: 0o640 });
    await rename(tmp, join(requests, 'queue', `${id}.json`));
  }
}
