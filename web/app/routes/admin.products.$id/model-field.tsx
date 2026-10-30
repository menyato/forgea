import { estimatePrint } from '@forgea/pricing';
import { Busy } from '~/components/brand/busy';
import type { MaterialView, SizeCm } from '@forgea/types';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import {
  type ModelMeasurement,
  ModelViewer,
} from '~/features/model-viewer/model-viewer';
import type { UploadResult } from './route';

/**
 * Upload an STL or GLB, see it in 3D, and get grams and print hours suggested from its
 * volume with the chosen material's density and print speed. The admin decides what to use.
 */
export function ModelField({
  modelKey,
  onModelKey,
  material,
  onSuggest,
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
          onMeasured={setMeasured}
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
            : '3D model (STL or GLB, up to 100 MB)'}
          <input
            type="file"
            name="file"
            accept=".stl,.glb,model/stl,model/gltf-binary"
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

      {measured && (
        <div className="grid gap-3 rounded-md bg-background p-4 text-sm">
          <p>
            Size {measured.sizeMm.map((n) => n.toFixed(0)).join(' × ')} mm ·
            volume {(measured.volumeMm3 / 1000).toFixed(1)} cm³
          </p>
          <label className="flex flex-wrap items-center gap-2">
            How solid it prints
            <input
              type="number"
              min={1}
              max={100}
              value={solidity}
              onChange={(e) => setSolidity(e.currentTarget.value)}
              className="w-20 rounded-md border border-border bg-surface px-2 py-1"
            />
            % (walls and infill; 30–50% is typical)
          </label>
          {estimate && material ? (
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
