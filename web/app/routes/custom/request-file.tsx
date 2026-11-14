import { Money } from '~/components/money';
import { Busy } from '~/components/brand/busy';
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { ModelViewer } from '~/features/model-viewer/model-viewer';
import type { EstimateResult, FileResult } from './route';

const MB = 1024 * 1024;
const ACCEPT = '.stl,.glb,.3mf,.png,.jpg,.jpeg,.webp';
/** Files the API prices at once: STL and 3MF. */
const PRICED = /\.(stl|3mf)$/;

/**
 * The optional attachment: a 3D model (shown in 3D, with an instant price for STL and 3MF:
 * a range around the price the shop would charge, from a sliced 3MF's own grams and time when it
 * has them) or a photo. Uploaded on its own, before the
 * request is sent.
 */
export function RequestFile({
  fileKey,
  onFileKey,
  materialId,
  quantity,
  maxMb,
  autoQuote,
}: {
  fileKey: string | null;
  onFileKey: (key: string | null) => void;
  materialId: string;
  quantity: string;
  maxMb: number | null;
  /** A sliced 3MF's price comes as a quote right after sending. */
  autoQuote: boolean;
}) {
  const upload = useFetcher<FileResult>();
  const estimate = useFetcher<EstimateResult>();
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);

  const uploaded = upload.data?.uploaded;
  useEffect(() => {
    if (uploaded) onFileKey(uploaded.key);
  }, [uploaded, onFileKey]);

  // Re-estimate when the model, material or quantity changes (after a short pause).
  const { submit: requestEstimate } = estimate;
  useEffect(() => {
    if (!fileKey || !PRICED.test(fileKey)) return;
    const timer = setTimeout(
      () =>
        void requestEstimate(
          { intent: 'estimate', fileKey, materialId, quantity },
          { method: 'post' },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [requestEstimate, fileKey, materialId, quantity]);

  const range = estimate.data?.estimate;
  const isModel = fileKey !== null && /\.(stl|glb|3mf)$/.test(fileKey);

  return (
    <div className="grid gap-4">
      <upload.Form
        method="post"
        encType="multipart/form-data"
        className="grid gap-2"
      >
        <input type="hidden" name="intent" value="upload" />
        <label className="grid gap-1 text-sm">
          <span className="font-medium">3D file or photo (optional)</span>
          <input
            ref={input}
            type="file"
            name="file"
            accept={ACCEPT}
            className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              const over = !!file && maxMb !== null && file.size > maxMb * MB;
              setTooBig(over);
              // Sent as soon as it is chosen; nothing over the limit leaves the device.
              if (file && !over) void upload.submit(e.currentTarget.form);
            }}
          />
          <span className="text-text-muted">
            STL, GLB, 3MF (a sliced Bambu Studio file is priced from its own
            grams and time), PNG, JPEG or WebP
            {maxMb !== null ? `, up to ${maxMb} MB` : ''}.
          </span>
        </label>
        {upload.state !== 'idle' && (
          <Busy label="Uploading…" className="text-sm text-text-muted" />
        )}
        {tooBig && (
          <p className="text-sm text-danger">
            This file is over {maxMb} MB. Send us a link on WhatsApp instead.
          </p>
        )}
        {upload.data?.error && (
          <p className="text-sm text-danger">{upload.data.error}</p>
        )}
      </upload.Form>

      {fileKey &&
        (isModel ? (
          <ModelViewer
            modelKey={fileKey}
            label="your model"
            className="max-h-[26rem] rounded-lg"
          />
        ) : (
          <img
            src={`/media/${fileKey}`}
            alt="Your photo"
            className="max-h-[26rem] w-full rounded-lg object-contain"
          />
        ))}

      {fileKey && PRICED.test(fileKey) && (
        <p aria-live="polite" className="text-sm">
          {estimate.state !== 'idle' && !range ? (
            <Busy label="Estimating…" className="text-text-muted" />
          ) : range?.exact ? (
            <>
              <span className="text-lg font-semibold">
                About <Money amount={range.low} />–<Money amount={range.high} />
              </span>{' '}
              <span className="text-text-muted">
                for {quantity || 1}, in {range.material.name} (
                {Number(range.grams)} g each, from your slicer).{' '}
                {autoQuote ? (
                  <>
                    Send the request and your quote is{' '}
                    <Money amount={range.price} />: you can order straight away.
                  </>
                ) : (
                  'We confirm the exact price with a quote.'
                )}
              </span>
            </>
          ) : range ? (
            <>
              <span className="text-lg font-semibold">
                About <Money amount={range.low} />–<Money amount={range.high} />
              </span>{' '}
              <span className="text-text-muted">
                for {quantity || 1}, in {range.material.name} (about{' '}
                {Number(range.grams)} g each). We confirm the exact price.
              </span>
            </>
          ) : estimate.data ? (
            <span className="text-text-muted">
              We couldn't measure this model; we'll price it by hand.
            </span>
          ) : null}
        </p>
      )}
      {fileKey && (
        <button
          type="button"
          className="justify-self-start text-sm text-text-muted underline underline-offset-4"
          onClick={() => {
            onFileKey(null);
            if (input.current) input.current.value = '';
          }}
        >
          Remove the file
        </button>
      )}
    </div>
  );
}
