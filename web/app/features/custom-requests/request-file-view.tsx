import type { CustomRequestView } from '@forgea/types';
import { buttonClass } from '~/components/ui/button';
import { ModelViewer } from '~/features/model-viewer/model-viewer';

/**
 * A file on a request — the customer's or the studio's design — in 3D or as a picture. With
 * `download` (the dashboard), a button saves the original file under its own name.
 */
export function RequestFileView({
  file,
  label,
  download = false,
}: {
  file: NonNullable<CustomRequestView['file']>;
  label: string;
  download?: boolean;
}) {
  const view =
    file.kind === 'model' ? (
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
  if (!download) return view;
  return (
    <div className="grid gap-2">
      {view}
      <a
        href={`/media/${file.key}?download=1`}
        download
        className={buttonClass('secondary', 'justify-self-start')}
      >
        Download {label}
      </a>
    </div>
  );
}
