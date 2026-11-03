import type { FontView } from '@forgea/types';
import { fontFamilyOf } from '~/features/text-studio/use-font-faces';

/** "English and Arabic": what a font can write. */
export const scriptsOf = (f: FontView) =>
  [f.latin && 'English', f.arabic && 'Arabic'].filter(Boolean).join(' and ');

/** A line written in the font itself (once `useFontFaces` has loaded it). */
export function FontSample({
  font: f,
  className = '',
}: {
  font: FontView;
  className?: string;
}) {
  return (
    <span
      className={`block min-w-0 truncate ${className}`}
      style={{ fontFamily: `'${fontFamilyOf(f.id)}', sans-serif` }}
    >
      {[f.latin && 'Sara Forgea', f.arabic && 'سارة']
        .filter(Boolean)
        .join('  ')}
    </span>
  );
}
