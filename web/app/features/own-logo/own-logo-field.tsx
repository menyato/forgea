import type { CustomerLogoView } from '@forgea/types';
import { useEffect, useId, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { OwnLogoResult } from '~/routes/your-logo/route';

const PICTURES = /^image\/(png|jpeg|webp|gif)$/;
const SVG = (f: File) => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name);

/**
 * "Your own logo": a customer drops (or chooses) a picture or an SVG. A picture is traced in
 * their browser into an outline drawing first; the API reads the drawing into the print
 * outline and keeps only that. `onLogo` gets it, to show in 3D and to order.
 */
export function OwnLogoField({
  label = 'Your own logo',
  onLogo,
}: {
  label?: string;
  onLogo: (logo: CustomerLogoView) => void;
}) {
  const id = useId();
  const fetcher = useFetcher<OwnLogoResult>();
  const [tracing, setTracing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [name, setName] = useState<string | null>(null);
  // Each logo the API sends back is handed on once.
  const handed = useRef<string | null>(null);
  const logo = fetcher.data?.logo;
  useEffect(() => {
    if (logo && handed.current !== logo.id) {
      handed.current = logo.id;
      onLogo(logo);
    }
  }, [logo, onLogo]);

  async function take(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setName(file.name);
    let svg: Blob;
    if (SVG(file)) {
      svg = file;
    } else if (PICTURES.test(file.type)) {
      setTracing(true);
      try {
        const { traceImage } = await import('./trace-image.client');
        const drawn = await traceImage(file);
        if (!drawn) {
          setProblem(
            'No logo found in this picture: use one with a plain background',
          );
          return;
        }
        svg = new Blob([drawn], { type: 'image/svg+xml' });
      } catch {
        setProblem('This picture could not be read: try a PNG or a JPEG');
        return;
      } finally {
        setTracing(false);
      }
    } else {
      setProblem('Use a PNG, a JPEG or an SVG');
      return;
    }
    const form = new FormData();
    form.set('intent', 'own-logo');
    form.set('file', svg, 'logo.svg');
    void fetcher.submit(form, {
      method: 'post',
      action: '/your-logo',
      encType: 'multipart/form-data',
    });
  }

  const busy = tracing || fetcher.state !== 'idle';
  const error = problem ?? fetcher.data?.error ?? null;
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={`grid cursor-pointer gap-1 rounded-md border border-dashed px-4 py-3 text-sm ${
          over ? 'border-accent bg-accent/5' : 'border-border'
        }`}
      >
        <span className="font-medium">{label}</span>
        <span className="text-text-muted">
          {busy
            ? tracing
              ? 'Tracing your logo…'
              : 'Reading your logo…'
            : logo && name
              ? `${name}: on your piece. Drop another to change it.`
              : 'Drop a PNG, JPEG or SVG here, or click to choose. A plain background works best.'}
        </span>
        <input
          id={id}
          name="own-logo"
          type="file"
          accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
          autoComplete="off"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void take(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
