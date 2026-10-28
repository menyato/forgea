import { PrintingLogo } from './printing-logo';

/**
 * "Something is happening": the logo printing, at text size, with what is happening
 * ("Uploading…"). The one loading indicator used across the site and the dashboard.
 */
export function Busy({
  label,
  className = '',
}: {
  label: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <PrintingLogo mode="loop" className="w-[1.25em] shrink-0" />
      {label}
    </span>
  );
}
