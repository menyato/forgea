/**
 * A record's steps along the top of its form, as in Odoo: the one it is in stands out, the
 * ones before it read as done. `aside` holds a step off the main path (Cancelled, Lost).
 */
export function StatusBar({
  steps,
  current,
  aside,
}: {
  steps: readonly { key: string; label: string }[];
  current: string;
  aside?: string | undefined;
}) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <ol
      aria-label="Status"
      className="mb-4 flex flex-wrap items-center gap-1 text-xs sm:text-sm"
    >
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === at && !aside ? 'step' : undefined}
          className={`rounded-pill border px-3 py-1 ${
            i === at && !aside
              ? 'border-accent bg-accent font-semibold text-on-accent'
              : i < at
                ? 'border-border bg-surface-raised text-text'
                : 'border-border text-text-muted'
          }`}
        >
          {i < at && !aside && (
            <span aria-hidden className="mr-1">
              ✓
            </span>
          )}
          {s.label}
        </li>
      ))}
      {aside && (
        <li
          aria-current="step"
          className="rounded-pill border border-danger px-3 py-1 font-semibold text-danger"
        >
          {aside}
        </li>
      )}
    </ol>
  );
}
