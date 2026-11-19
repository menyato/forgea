import type { Region } from '@forgea/text3d/design';

/**
 * A logo's print outline drawn as it will print: solid areas and their holes (even-odd), in
 * the text colour. The outline is 1 across, centred on 0, 0, y up (SVG's runs down).
 */
export function LogoOutline({
  outline,
  label,
  className = '',
}: {
  outline: readonly Region[];
  label: string;
  className?: string;
}) {
  const ring = (c: readonly (readonly [number, number])[]) =>
    `M${c.map(([x, y]) => `${(x * 100).toFixed(2)} ${(-y * 100).toFixed(2)}`).join('L')}Z`;
  const d = outline
    .map((r) => [r.outer, ...r.holes].map(ring).join(''))
    .join('');
  return (
    <svg
      viewBox="-55 -55 110 110"
      role="img"
      aria-label={label}
      className={className}
    >
      <path d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
