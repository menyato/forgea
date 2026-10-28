import type { CustomRequestView } from '@forgea/types';
import { ModelViewer } from '~/features/model-viewer/model-viewer';

/** A file on a request — the customer's or the studio's design — in 3D or as a picture. */
export function RequestFileView({
  file,
  label,
}: {
  file: NonNullable<CustomRequestView['file']>;
  label: string;
}) {
  return file.kind === 'model' ? (
    <ModelViewer
      modelKey={file.key}
      label={label}
      className="max-h-[32rem] rounded-lg"
    />
  ) : (
    <img
      src={`/media/${file.key}`}
      alt={label}
      className="max-h-[32rem] w-full rounded-lg bg-surface object-contain"
    />
  );
}
