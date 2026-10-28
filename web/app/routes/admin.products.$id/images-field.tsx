import { PRODUCT_IMAGES_MAX } from '@forgea/validation/constants';
import { Busy } from '~/components/brand/busy';
import { useEffect, useRef } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import type { UploadResult } from './route';

/** Product photos (PNG, JPEG, WebP), shown in the order listed. */
export function ImagesField({
  keys,
  onChange,
}: {
  keys: readonly string[];
  onChange: (keys: string[]) => void;
}) {
  const upload = useFetcher<UploadResult>();
  const uploaded = upload.data?.uploaded;
  // Add each upload once: removing it later must not bring it back.
  const added = useRef<string | null>(null);
  useEffect(() => {
    if (!uploaded || added.current === uploaded.key) return;
    added.current = uploaded.key;
    onChange([...keys, uploaded.key]);
  }, [uploaded, keys, onChange]);

  return (
    <div className="grid gap-3">
      {keys.length > 0 && (
        <ul className="flex flex-wrap gap-3">
          {keys.map((key, i) => (
            <li key={key} className="grid gap-1">
              <img
                src={`/media/${key}`}
                alt={`Photo ${i + 1}`}
                className="size-24 rounded-md border border-border object-cover"
              />
              <Button
                variant="quiet"
                onClick={() => onChange(keys.filter((k) => k !== key))}
                aria-label={`Remove photo ${i + 1}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {keys.length < PRODUCT_IMAGES_MAX && (
        <upload.Form
          method="post"
          encType="multipart/form-data"
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="intent" value="upload-image" />
          <label className="grid gap-1.5 text-sm font-medium">
            Add a photo (PNG, JPEG or WebP)
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp"
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
        </upload.Form>
      )}
      {upload.data?.error && (
        <p role="alert" className="text-sm text-danger">
          {upload.data.error}
        </p>
      )}
    </div>
  );
}
