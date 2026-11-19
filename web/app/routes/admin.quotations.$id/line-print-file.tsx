import type { PrintFile, QuotationPrintFileView } from '@forgea/types';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { Button } from '~/components/ui/button';
import { Swatch } from '~/features/stock/stock-ui';
import { formatHours } from '~/lib/duration';

export type PrintFileResult =
  | { file: QuotationPrintFileView; error?: undefined }
  | { file?: undefined; error: string };

/**
 * A quotation line made from a 3D file (a Bambu Studio 3MF, sliced or not): upload it and the
 * API reads what one piece takes, its size and its price in the shop's pricing, which fill the
 * line (the price stays the team's to change). The order made from the line takes the file's
 * grams per colour from stock, and the studio downloads the file from the order.
 */
export function LinePrintFile({
  index,
  printFile,
  onRead,
  onRemove,
}: {
  index: number;
  printFile: PrintFile | null;
  onRead: (file: QuotationPrintFileView) => void;
  onRemove: () => void;
}) {
  const reader = useFetcher<PrintFileResult>();
  const read = reader.data?.file;
  useEffect(() => {
    if (read) onRead(read);
    // Only when a new answer arrives.
  }, [read]);
  const busy = reader.state !== 'idle';

  return (
    <div className="grid gap-2 sm:col-span-full">
      {printFile ? (
        <div className="grid gap-2 rounded-md bg-background p-3 text-sm">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">From a 3D file:</span>
            <span>
              {printFile.grams} g, {formatHours(printFile.printHours)} a piece{' '}
              <span className="text-text-muted">
                {printFile.sliced ? '(from the slicer)' : '(estimated)'}
              </span>
            </span>
            {read && read.materials.length > 1 && (
              <label className="flex items-center gap-2">
                in
                <select
                  id={`line-${index}-print-material`}
                  name={`line-${index}-print-material`}
                  autoComplete="off"
                  value={printFile.materialId}
                  disabled={busy}
                  onChange={(e) =>
                    void reader.submit(
                      {
                        intent: 'print-file',
                        key: printFile.fileKey,
                        materialId: e.currentTarget.value,
                      },
                      { method: 'post' },
                    )
                  }
                  className="rounded-md border border-border bg-surface px-2 py-1"
                >
                  {read.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button variant="quiet" onClick={onRemove}>
              Remove the file
            </Button>
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {printFile.colours.map((c) => (
              <li key={c.hex} className="flex items-center gap-1.5">
                <Swatch hex={c.hex} />
                {c.colour} · {c.grams} g
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Inside the quotation's own form: the file goes up on its own, not as a nested form.
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            3D file for this line (3MF, STL or GLB; optional)
            <input
              id={`line-${index}-print-file`}
              name={`line-${index}-print-file`}
              type="file"
              autoComplete="off"
              accept=".3mf,.stl,.glb,model/3mf,model/stl,model/gltf-binary"
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (!file) return;
                const body = new FormData();
                body.set('intent', 'print-file');
                body.set('file', file, file.name);
                void reader.submit(body, {
                  method: 'post',
                  encType: 'multipart/form-data',
                });
              }}
              className="text-sm"
            />
          </label>
          {busy && <Busy label="Reading the file…" />}
        </div>
      )}
      {reader.data?.error && (
        <p role="alert" className="text-sm text-danger">
          {reader.data.error}
        </p>
      )}
    </div>
  );
}
