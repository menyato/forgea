import type { BackupItem, BackupsView } from '@forgea/types';
import { BackupKeepDto, RestoreBackupDto } from '@forgea/validation';
import { useEffect, useState } from 'react';
import { useFetcher, useRevalidator } from 'react-router';
import { Button, buttonClass } from '~/components/ui/button';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Backups — Forgea' }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context.get(apiContext).get<BackupsView>('/backups');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { backups: r.data };
}

/** backup (now) | keep (how many) | restore | delete */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const file = encodeURIComponent(text(form, 'file') ?? '');
  switch (form.get('intent')) {
    case 'keep':
      return save(BackupKeepDto, { keep: text(form, 'keep') }, (dto) =>
        api.put('/backups/settings', dto),
      );
    case 'restore':
      return save(
        RestoreBackupDto,
        { confirm: text(form, 'confirm') ?? '' },
        (dto) => api.post(`/backups/${file}/restore`, dto),
      );
    case 'delete': {
      const r = await api.delete(`/backups/${file}`);
      return r.ok ? { ok: true as const } : { error: r.message };
    }
    default: {
      const r = await api.post('/backups');
      return r.ok ? { ok: true as const } : { error: r.message };
    }
  }
}

const GB = 1024 ** 3;
const size = (bytes: number) =>
  bytes >= GB
    ? `${(bytes / GB).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Beirut',
  });
const KIND = {
  nightly: 'Nightly',
  manual: 'Made with "Back up now"',
  'before-restore': 'Made just before a restore',
} as const;
const ACTION = {
  backup: 'Backup',
  restore: 'Restore',
  delete: 'Delete',
} as const;
/** The environment a backup belongs to, from its name (forgea-<env>-…). */
const envOf = (file: string) => file.split('-')[1] ?? '';

export default function Backups({ loaderData }: Route.ComponentProps) {
  const { backups: b } = loaderData;
  const revalidator = useRevalidator();
  const busy = b.configured && (b.running !== null || b.pending > 0);
  // While the server works, the page follows it every few seconds.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void revalidator.revalidate(), 4000);
    return () => clearInterval(id);
  }, [busy, revalidator]);

  if (!b.configured) {
    return (
      <>
        <AdminHeader
          title="Backups"
          intro="Backups of the shop's data and files."
        />
        <Panel>
          <p className="text-text-muted">
            Backups are made by the server; this computer has none. Open this
            page on the live site to manage them.
          </p>
        </Panel>
      </>
    );
  }

  const used = b.disk.totalBytes - b.disk.freeBytes;
  const low = b.disk.freeBytes < 5 * GB;
  return (
    <>
      <AdminHeader
        title="Backups"
        intro="Every night the server saves the database and every uploaded file, encrypted with the backup password, as one file. The newest ones are kept; download them to your PC to keep copies off the server. Only admins see this page."
        action={<BackupNow disabled={busy} />}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-6">
          {busy && (
            <p
              role="status"
              className="rounded-lg border-2 border-accent bg-surface p-4 text-sm"
            >
              {b.running
                ? b.running.action === 'restore'
                  ? `Restoring ${b.running.file} (started ${when(b.running.since)}). The shop pauses for a minute while it does; you may have to sign in again afterwards.`
                  : `${ACTION[b.running.action]} running since ${when(b.running.since)}…`
                : 'The server is about to start what you asked for…'}
            </p>
          )}
          <Panel title={`Backups (${b.items.length})`}>
            {b.items.length === 0 ? (
              <p className="text-sm text-text-muted">
                None yet. The first is made tonight, or now with "Back up now".
              </p>
            ) : (
              <ul className="grid gap-3">
                {b.items.map((item) => (
                  <BackupRow key={item.file} item={item} disabled={busy} />
                ))}
              </ul>
            )}
          </Panel>
          {b.last.length > 0 && (
            <Panel title="Latest">
              <ul className="grid gap-1 text-sm">
                {b.last.map((e) => (
                  <li key={`${e.at}${e.action}${e.file}`}>
                    <span className={e.ok ? 'text-success' : 'text-danger'}>
                      {ACTION[e.action] ?? e.action}: {e.message}
                    </span>{' '}
                    <span className="text-text-muted">
                      {e.file && `· ${e.file} `}· {when(e.at)} · {e.by}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="grid content-start gap-6">
          <Panel title="Server disk">
            <div
              role="meter"
              aria-label="Server disk used"
              aria-valuemin={0}
              aria-valuemax={b.disk.totalBytes}
              aria-valuenow={used}
              className="h-3 overflow-hidden rounded-pill bg-border"
            >
              <div
                className={`h-full ${low ? 'bg-danger' : 'bg-accent'}`}
                style={{
                  width: `${Math.min(100, (100 * used) / b.disk.totalBytes)}%`,
                }}
              />
            </div>
            <p className="text-sm">
              <strong>{size(b.disk.freeBytes)} free</strong> of{' '}
              {size(b.disk.totalBytes)}. Backups use {size(b.disk.backupsBytes)}
              .
            </p>
            {low && (
              <p className="text-sm text-danger">
                Less than 5 GB left: delete old backups (download them first),
                or keep fewer.
              </p>
            )}
          </Panel>
          <KeepForm keep={b.keep} />
        </div>
      </div>
    </>
  );
}

function BackupNow({ disabled }: { disabled: boolean }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <fetcher.Form method="post" className="flex items-center gap-3">
      <input type="hidden" name="intent" value="backup" />
      <Button type="submit" disabled={disabled || fetcher.state !== 'idle'}>
        Back up now
      </Button>
      {fetcher.data?.error && (
        <span className="text-sm text-danger">{fetcher.data.error}</span>
      )}
    </fetcher.Form>
  );
}

function KeepForm({ keep }: { keep: number }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title="How many to keep">
      <fetcher.Form method="post" className="grid gap-3">
        <input type="hidden" name="intent" value="keep" />
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Backups kept on the server</span>
          <select
            name="keep"
            autoComplete="off"
            defaultValue={keep}
            className="rounded-md border border-border bg-bg px-3 py-2"
          >
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-text-muted">
          After each new backup the oldest beyond this number are deleted.
        </p>
        <Button
          type="submit"
          variant="secondary"
          disabled={fetcher.state !== 'idle'}
        >
          Save
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </fetcher.Form>
    </Panel>
  );
}

function BackupRow({
  item,
  disabled,
}: {
  item: BackupItem;
  disabled: boolean;
}) {
  const fetcher = useFetcher<SaveResult>();
  const [restoring, setRestoring] = useState(false);
  const env = envOf(item.file);
  return (
    <li className="grid gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium">{when(item.createdAt)}</span>
        <span className="text-sm text-text-muted">
          {KIND[item.kind]} · {size(item.sizeBytes)}
        </span>
        <span className="flex-1" />
        <a
          href={`/admin/backups/${encodeURIComponent(item.file)}/download`}
          download
          className={buttonClass('secondary')}
        >
          Download
        </a>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => setRestoring((r) => !r)}
        >
          Restore…
        </Button>
        <fetcher.Form
          method="post"
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete the backup of ${when(item.createdAt)}? It can't be undone.`,
              )
            )
              e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="file" value={item.file} />
          <Button
            type="submit"
            variant="quiet"
            disabled={disabled || fetcher.state !== 'idle'}
          >
            Delete
          </Button>
        </fetcher.Form>
      </div>
      {restoring && (
        <fetcher.Form
          method="post"
          className="grid gap-2 rounded-md bg-surface p-3 text-sm"
        >
          <input type="hidden" name="intent" value="restore" />
          <input type="hidden" name="file" value={item.file} />
          <p>
            <strong>Everything since {when(item.createdAt)} is replaced</strong>{' '}
            by this backup: orders, accounts, products and files. A backup of
            how things are now is made first, so this can be undone. The shop
            pauses for about a minute.
          </p>
          <label className="grid gap-1">
            <span>
              Type <strong>{env}</strong> to confirm
            </span>
            <input
              name="confirm"
              autoComplete="off"
              className="rounded-md border border-border bg-bg px-3 py-2"
            />
          </label>
          <Button type="submit" disabled={disabled || fetcher.state !== 'idle'}>
            Restore this backup
          </Button>
        </fetcher.Form>
      )}
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </li>
  );
}
