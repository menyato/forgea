import full from '@forgea/brand/assets/logo.svg?raw';
import compact from '@forgea/brand/assets/logo-compact.svg?raw';
import mark from '@forgea/brand/assets/logo-mark.svg?raw';

const SOURCES = { full, compact, mark } as const;

type LogoVariant = keyof typeof SOURCES;

interface LogoProps {
  /** full: with tagline (≥ 360px wide) · compact: wordmark · mark: the F alone (favicons, avatars). */
  variant?: LogoVariant;
  className?: string;
}

/**
 * Inlined rather than <img> so its fills follow the --forgea-logo-* theme variables
 * (light/dark). The markup is our own build asset from @forgea/brand, never user input.
 */
export function Logo({ variant = 'compact', className }: LogoProps) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: SOURCES[variant] }}
    />
  );
}
