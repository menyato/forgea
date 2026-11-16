import { estimatePrint } from '@forgea/pricing';
import { Busy } from '~/components/brand/busy';
import type {
  MaterialView,
  ModelFileInfo,
  ProductColourView,
  SizeCm,
} from '@forgea/types';
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import {
  type ModelMeasurement,
  ModelViewer,
} from '~/features/model-viewer/model-viewer';
import { isThreeMf } from '~/features/model-viewer/model-source';
import { Swatch } from '~/features/stock/stock-ui';
import type { ModelInfoResult, UploadResult } from './route';

/**
 * Upload an STL, GLB or 3MF and see it in 3D. An STL or GLB gets grams and print hours
 * suggested from its volume with the chosen material's density and print speed; a 3MF (Bambu
 * Studio and other slicers) is read by the API: its colours, and the slicer's own grams and
 * time when it was sliced. A 3MF is read as soon as it is uploaded, and a sliced one fills in a
 * new product at once (grams, time, size, colours, material); "Use these numbers" does it again.
 */
export function ModelField({
  modelKey,
  onModelKey,
  material,
  onSuggest,
  onColours,
  autoUse,
  name,
}: {
  modelKey: string | null;
  onModelKey: (key: string | null) => void;
  material: MaterialView | undefined;
  /** Grams and hours from the volume, and the model's size in cm. */
  onSuggest: (estimate: {
    grams: string;
    printHours: string;
    size: SizeCm;
  }) => void;
  /** A sliced 3MF's grams per colour, and the filament type most of it prints in ("PLA"). */
  onColours: (colours: ProductColourView[], type: string | null) => void;
  /** Fill the form from a sliced 3MF as soon as it is read (a product with no numbers yet). */
  autoUse: boolean;
  name: string;
}) {
  const upload = useFetcher<UploadResult>();
  const [measured, setMeasured] = useState<ModelMeasurement | null>(null);
  const [solidity, setSolidity] = useState('40');

  const uploaded = upload.data?.uploaded;
  useEffect(() => {
    if (uploaded) {
      setMeasured(null);
      onModelKey(uploaded.key);
    }
  }, [uploaded, onModelKey]);

  // A side over two metres is no print: the file isn't in millimetres, so nothing it
  // says can size or price a piece.
  const unreal = measured?.sizeMm.some((mm) => mm > 2000) ?? false;
  let estimate: { grams: string; printHours: string } | null = null;
  if (measured && material) {
    try {
      estimate = estimatePrint({
        volumeMm3: measured.volumeMm3.toFixed(0),
        densityGPerCm3: material.densityGPerCm3,
        solidityPercent: solidity || '0',
        gramsPerHour: material.gramsPerHour,
      });
    } catch {
      estimate = null; // e.g. a solidity over 100 while typing
    }
  }

  return (
    <div className="grid gap-4">
      {modelKey ? (
        <ModelViewer
          modelKey={modelKey}
          label={name || 'the product'}
          // A 3MF is measured by the API (colours, slicer data), not from its shape here.
          onMeasured={isThreeMf(modelKey) ? undefined : setMeasured}
          className="max-h-[28rem] rounded-lg border border-border"
        />
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-border text-sm text-text-muted">
          No 3D model yet
        </div>
      )}

      <upload.Form
        method="post"
        encType="multipart/form-data"
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="intent" value="upload-model" />
        <label className="grid gap-1.5 text-sm font-medium">
          {modelKey
            ? 'Replace the model'
            : '3D model (STL, GLB or 3MF, up to 100 MB)'}
          <input
            type="file"
            name="file"
            accept=".stl,.glb,.3mf,model/stl,model/gltf-binary,model/3mf"
            required
            className="text-sm"
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          disabled={upload.state !== 'idle'}
        >
          {upload.state !== 'idle' ? <Busy label="Uploading…" /> : 'Upload'}
        </Button>
        {modelKey && (
          <Button variant="quiet" onClick={() => onModelKey(null)}>
            Remove model
          </Button>
        )}
      </upload.Form>
      {upload.data?.error && (
        <p role="alert" className="text-sm text-danger">
          {upload.data.error}
        </p>
      )}

      {modelKey && isThreeMf(modelKey) && (
        <ThreeMfInfo
          modelKey={modelKey}
          material={material}
          autoUse={autoUse}
          onUse={(info) => {
            onSuggest({
              grams: info.grams,
              printHours: info.printHours,
              size: info.size,
            });
            // The type most of its grams print in decides the material.
            const byType = new Map<string, number>();
            for (const c of info.colours)
              if (c.type)
                byType.set(c.type, (byType.get(c.type) ?? 0) + Number(c.grams));
            const type =
              [...byType].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
            // One colour too: customers may still choose the colour it prints in.
            onColours(
              info.colours.map((c) => ({
                colour: c.suggested ?? '',
                hex: c.hex,
                grams: c.grams,
                part: null,
                startsAs: null,
                stockItemId: null,
              })),
              type,
            );
          }}
        />
      )}

      {measured && (
        <div className="grid gap-3 rounded-md bg-background p-4 text-sm">
          <p>
            Size {measured.sizeMm.map((n) => n.toFixed(0)).join(' × ')} mm ·
            volume {(measured.volumeMm3 / 1000).toFixed(1)} cm³
          </p>
          <label className="flex flex-wrap items-center gap-2">
            How solid it prints
            <input
              id="model-solidity"
              type="number"
              min={1}
              max={100}
              autoComplete="off"
              value={solidity}
              onChange={(e) => setSolidity(e.currentTarget.value)}
              className="w-20 rounded-md border border-border bg-surface px-2 py-1"
            />
            % (walls and infill; 30–50% is typical)
          </label>
          {unreal ? (
            <p className="text-warning">
              That is larger than any printer: the file is probably not in
              millimetres. Export it in mm, or type the grams and time yourself.
            </p>
          ) : estimate && material ? (
            <p className="flex flex-wrap items-center gap-3">
              <span>
                Suggested in {material.code}:{' '}
                <strong>{estimate.grams} g</strong>,{' '}
                <strong>{estimate.printHours} h</strong>
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  const [x, y, z] = measured.sizeMm.map((mm) =>
                    (Math.round(mm) / 10).toFixed(1),
                  ) as [string, string, string];
                  onSuggest({ ...estimate, size: { x, y, z } });
                }}
              >
                Use these numbers
              </Button>
            </p>
          ) : (
            <p className="text-text-muted">
              Choose a material to get a suggestion.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What a 3MF says, read by the API on request: its size, print time and the grams of each
 * colour (the slicer's own numbers for a sliced file, else estimated from its volume).
 */
function ThreeMfInfo({
  modelKey,
  material,
  autoUse,
  onUse,
}: {
  modelKey: string;
  material: MaterialView | undefined;
  autoUse: boolean;
  onUse: (info: ModelFileInfo) => void;
}) {
  const reader = useFetcher<ModelInfoResult>();
  // Sliced files carry their own grams; the solidity only matters for a guess.
  const info = reader.data?.info;
  // Read once per uploaded file, by itself; a sliced file then fills a new product in.
  const readFor = useRef<string | null>(null);
  const usedFor = useRef<string | null>(null);
  const { submit } = reader;
  useEffect(() => {
    if (!material || readFor.current === modelKey) return;
    readFor.current = modelKey;
    void submit(
      {
        intent: 'model-info',
        key: modelKey,
        materialId: material.id,
        solidityPercent: '40',
      },
      { method: 'post' },
    );
  }, [modelKey, material, submit]);
  const latest = useRef({ autoUse, onUse });
  latest.current = { autoUse, onUse };
  useEffect(() => {
    if (!info?.sliced || usedFor.current === modelKey) return;
    usedFor.current = modelKey;
    if (latest.current.autoUse) latest.current.onUse(info);
  }, [info, modelKey]);
  const read = () =>
    void reader.submit(
      {
        intent: 'model-info',
        key: modelKey,
        materialId: material?.id ?? '',
        solidityPercent: '40',
      },
      { method: 'post' },
    );
  return (
    <div className="grid gap-3 rounded-md bg-background p-4 text-sm">
      <p className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={!material || reader.state !== 'idle'}
          onClick={read}
        >
          {reader.state !== 'idle' ? (
            <Busy label="Reading the file…" />
          ) : (
            'Read colours, grams and time from the file'
          )}
        </Button>
        {!material && (
          <span className="text-text-muted">Choose a material first.</span>
        )}
      </p>
      {reader.data?.error && (
        <p role="alert" className="text-danger">
          {reader.data.error}
        </p>
      )}
      {info && (
        <>
          <p>
            Size {info.size.x} × {info.size.y} × {info.size.z} cm ·{' '}
            <strong>{info.grams} g</strong>,{' '}
            <strong>{info.printHours} h</strong>{' '}
            <span className="text-text-muted">
              {info.sliced
                ? '(from the slicer: the file was sliced, so the purge, prime tower and supports are counted in them)'
                : '(a guess from the volume)'}
            </span>
          </p>
          {!info.sliced && (
            <p
              role="alert"
              className="rounded-md bg-warning/15 px-3 py-2 text-text"
            >
              This 3MF isn&apos;t sliced, so it can&apos;t price the product:
              its purge, prime tower and supports aren&apos;t known. In Bambu
              Studio, slice the plate, then choose{' '}
              <strong>File → Export → Export plate sliced file</strong> and
              upload that <strong>.gcode.3mf</strong> here.
            </p>
          )}
          <ul className="grid gap-1">
            {info.colours.map((c) => (
              <li key={c.hex} className="flex flex-wrap items-center gap-2">
                <Swatch hex={c.hex} />
                <span className="tabular-nums">{c.grams} g</span>
                <span className="text-text-muted">
                  {c.type ?? 'filament'} {c.hex}
                  {c.suggested ? ` → ${c.suggested}` : ' → choose the colour'}
                </span>
              </li>
            ))}
          </ul>
          {info.sliced && (
            <p>
              <Button variant="secondary" onClick={() => onUse(info)}>
                Use these numbers
              </Button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
