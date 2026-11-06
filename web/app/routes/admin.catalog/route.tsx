import type { CatalogImportReport } from '@forgea/types';
import { Busy } from '~/components/brand/busy';
import { data, useFetcher } from 'react-router';
import { Button, buttonClass } from '~/components/ui/button';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

type ImportResult =
  | { report: CatalogImportReport; error?: undefined }
  | { report?: undefined; error: string };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const file = form.get('file');
  const mode = form.get('mode') === 'update' ? 'update' : 'add';
  if (!(file instanceof File) || file.size === 0) {
    return data<ImportResult>(
      { error: 'Choose a catalog file' },
      { status: 400 },
    );
  }
  const upload = new FormData();
  upload.set('file', file, file.name);
  const r = await context
    .get(apiContext)
    .postForm<CatalogImportReport>(
      `/catalog-transfer/import?mode=${mode}`,
      upload,
    );
  return r.ok
    ? data<ImportResult>({ report: r.data })
    : data<ImportResult>({ error: r.message }, { status: r.status });
}

const KIND_LABELS = {
  materials: 'materials',
  categories: 'categories',
  optionGroups: 'option groups',
  optionValues: 'option values',
  products: 'products',
} as const;

export default function Catalog() {
  const fetcher = useFetcher<ImportResult>();
  const report = fetcher.data?.report;
  const summary = (counts: CatalogImportReport['created']) =>
    Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${KIND_LABELS[k as keyof typeof KIND_LABELS]}`)
      .join(', ') || 'nothing';
  return (
    <>
      <AdminHeader
        title="Import & export"
        intro="Move the whole catalog in one file: materials, categories, options with their price rules, and products with their 3D models and photos. Export here, then import on the other site. Orders, customers and stock never leave."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Export">
          <p className="text-sm text-text-muted">
            A JSON file with everything needed to rebuild this catalog
            elsewhere.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/admin/catalog-export"
              className={buttonClass('primary')}
              download
            >
              Download the catalog
            </a>
            <a
              href="/admin/catalog-export?only=text"
              className={buttonClass('secondary')}
              download
            >
              Personalised-text products only
            </a>
          </div>
        </Panel>
        <Panel title="Import">
          <fetcher.Form
            method="post"
            encType="multipart/form-data"
            className="grid gap-4"
          >
            <input
              type="file"
              name="file"
              accept=".json,application/json"
              required
            />
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 font-medium">
                If something already exists
              </legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" value="add" defaultChecked />{' '}
                Keep it; only add what's missing
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mode" value="update" /> Replace it
                with the file's version
              </label>
            </fieldset>
            <Button
              type="submit"
              disabled={fetcher.state !== 'idle'}
              className="justify-self-start"
            >
              {fetcher.state !== 'idle' ? (
                <Busy label="Importing…" />
              ) : (
                'Import'
              )}
            </Button>
          </fetcher.Form>
          <div aria-live="polite" className="text-sm">
            {fetcher.data?.error && (
              <p className="text-danger">{fetcher.data.error}</p>
            )}
            {report && (
              <p className="text-success">
                Imported. Added {summary(report.created)}; replaced{' '}
                {summary(report.updated)};{` ${report.skipped}`} left as they
                were.
              </p>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Very large files can be imported from the server instead:{' '}
            <code>pnpm --filter @forgea/api catalog:import file.json</code>
          </p>
        </Panel>
      </div>
    </>
  );
}
