import type { MaterialView, PrintFilesTotal, PrintSetup } from '@forgea/types';
import {
  PRINT_FILE_NAME_MAX_LENGTH,
  PRODUCT_PRINT_FILES_MAX,
} from '@forgea/validation/constants';
import { useEffect, useRef } from 'react';
import { useFetcher } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { Button } from '~/components/ui/button';
import { Swatch } from '~/features/stock/stock-ui';
import type { PrintFilesResult, UploadResult } from './route';
import { formatHours } from '~/lib/duration';

/** A sliced print file of the product: its upload and what the owner calls it. */
export interface PrintFileRef {
  key: string;
  name: string;
}

/** "pink-twist-lamp_1_base_sliced.gcode.3mf" → "pink twist lamp 1 base". */
const nameOf = (fileName: string) =>
  (
    fileName
      .replace(/\.gcode\.3mf$|\.3mf$/i, '')
      .replace(/[_-]?sliced$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Print file'
  ).slice(0, PRINT_FILE_NAME_MAX_LENGTH);

/**
 * The product's sliced print files (Bambu Studio "Export plate sliced file"): a product shown
 * assembled is printed from one or more of them. The API reads each one (grams per colour,
 * time, how it was set up) and adds them up; "Use the totals" makes them the product's grams,
 * time and colours, so its price and its stock follow the slicer exactly.
 */
export function PrintFilesField({
  files,
  onFiles,
  material,
  onUse,
}: {
  files: readonly PrintFileRef[];
  onFiles: (next: PrintFileRef[]) => void;
  material: MaterialView | undefined;
  /** The owner takes the files' total as the product's numbers. */
  onUse: (total: PrintFilesTotal) => void;
}) {
  const upload = useFetcher<UploadResult>();
  const reader = useFetcher<PrintFilesResult>();
  const pending = useRef<string | null>(null);

  // An accepted upload joins the list under its file's name.
  const uploaded = upload.data?.uploaded;
  useEffect(() => {
    if (!uploaded || pending.current === null) return;
    const name = pending.current;
    pending.current = null;
    if (!files.some((f) => f.key === uploaded.key))
      onFiles([...files, { key: uploaded.key, name }]);
  }, [uploaded, files, onFiles]);

  // Read again whenever the list or the material changes.
  const { submit } = reader;
  const ask = JSON.stringify(files);
  const materialId = material?.id;
  useEffect(() => {
    if (!materialId || ask === '[]') return;
    void submit(
      { intent: 'print-files', files: ask, materialId },
      { method: 'post' },
    );
  }, [ask, materialId, submit]);

  const total = files.length > 0 ? reader.data?.total : undefined;
  const rename = (key: string, name: string) =>
    onFiles(files.map((f) => (f.key === key ? { ...f, name } : f)));

  return (
    <div className="grid grid-cols-1 gap-4 text-sm">
      <p className="text-text-muted">
        The model above is what customers see. Add the sliced files it is
        printed from (Bambu Studio: slice, then File → Export → Export plate
        sliced file): their grams, time and colours add up to the
        product&apos;s, with the purge, prime tower and supports counted.
      </p>
      <upload.Form
        method="post"
        encType="multipart/form-data"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          const input = e.currentTarget.elements.namedItem('file');
          pending.current =
            input instanceof HTMLInputElement && input.files?.[0]
              ? nameOf(input.files[0].name)
              : null;
        }}
      >
        <input type="hidden" name="intent" value="upload-model" />
        <label className="grid gap-1.5 font-medium">
          Sliced print file (.gcode.3mf, up to 100 MB)
          <input
            type="file"
            name="file"
            accept=".3mf,model/3mf"
            required
            className="text-sm"
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          disabled={
            upload.state !== 'idle' || files.length >= PRODUCT_PRINT_FILES_MAX
          }
        >
          {upload.state !== 'idle' ? (
            <Busy label="Uploading…" />
          ) : (
            'Add print file'
          )}
        </Button>
      </upload.Form>
      {upload.data?.error && (
        <p role="alert" className="text-danger">
          {upload.data.error}
        </p>
      )}
      {files.length > 0 && !material && (
        <p className="text-text-muted">Choose a material to read the files.</p>
      )}
      {reader.state !== 'idle' && <Busy label="Reading the files…" />}
      {reader.data?.error && files.length > 0 && (
        <p role="alert" className="text-danger">
          {reader.data.error}
        </p>
      )}

      {files.length > 0 && (
        <ul aria-label="Print files" className="grid grid-cols-1 gap-3">
          {files.map((f, i) => {
            const read = total?.files.find((x) => x.fileKey === f.key);
            return (
              <li
                key={f.key}
                className="grid min-w-0 grid-cols-1 gap-2 rounded-md border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <input
                    id={`print-file-name-${i}`}
                    name={`print-file-name-${i}`}
                    aria-label={`Name of print file ${i + 1}`}
                    autoComplete="off"
                    required
                    maxLength={PRINT_FILE_NAME_MAX_LENGTH}
                    value={f.name}
                    onChange={(e) => rename(f.key, e.currentTarget.value)}
                    className="w-0 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 font-medium"
                  />
                  <a
                    href={`/media/${f.key}`}
                    download
                    className="shrink-0 underline"
                  >
                    Download
                  </a>
                  <Button
                    variant="quiet"
                    aria-label={`Remove print file ${i + 1}`}
                    onClick={() =>
                      onFiles(files.filter((x) => x.key !== f.key))
                    }
                  >
                    ×
                  </Button>
                </div>
                {read && (
                  <>
                    <p>
                      <strong className="tabular-nums">{read.grams} g</strong>,{' '}
                      <strong className="tabular-nums">
                        {formatHours(read.printHours)}
                      </strong>
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                      {read.colours.map((c) => (
                        <li key={c.hex} className="flex items-center gap-1.5">
                          <Swatch hex={c.hex} />
                          <span className="tabular-nums">{c.grams} g</span>
                          <span className="text-text-muted">
                            {c.colour.startsWith('#') ? c.hex : c.colour}
                            {c.type ? ` (${c.type})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-text-muted">{setupLine(read.setup)}</p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {total && (
        <div className="grid gap-2 rounded-md bg-background p-4">
          <p>
            In all: <strong className="tabular-nums">{total.grams} g</strong>,{' '}
            <strong className="tabular-nums">
              {formatHours(total.printHours)}
            </strong>{' '}
            <span className="text-text-muted">
              (the slicer&apos;s own: purge, prime tower and supports counted)
            </span>
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {total.colours.map((c) => (
              <li key={c.colour} className="flex items-center gap-1.5">
                <Swatch hex={c.hex} />
                <span className="tabular-nums">{c.grams} g</span>
                <span className="text-text-muted">
                  {c.colour.startsWith('#') ? 'name it below' : c.colour}
                </span>
              </li>
            ))}
          </ul>
          <p>
            <Button variant="secondary" onClick={() => onUse(total)}>
              Use the totals
            </Button>
          </p>
        </div>
      )}
    </div>
  );
}

/** How a file was set up, in one line: only what the file says. */
function setupLine(s: PrintSetup): string {
  return [
    s.plates > 1 ? `${s.plates} plates` : null,
    s.printer,
    s.nozzleMm !== null ? `${s.nozzleMm} mm nozzle` : null,
    s.layerHeightMm !== null ? `${s.layerHeightMm} mm layers` : null,
    s.infill ? `${s.infill} infill` : null,
    s.supports ? 'supports' : 'no supports',
    s.primeTower ? 'prime tower' : null,
    s.profile,
    s.objects.length > 0
      ? `${s.objects.length} object${s.objects.length === 1 ? '' : 's'}: ${s.objects.slice(0, 6).join(', ')}${s.objects.length > 6 ? '…' : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
