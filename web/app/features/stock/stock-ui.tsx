import type {
  StockItemView,
  StockMovementView,
  StockPrintable,
} from '@forgea/types';
import { type ReactNode, useState } from 'react';
import { Link, type useFetcher } from 'react-router';
import { Button, buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';
import { STUDIO_TIME_ZONE } from '~/lib/studio-time';

export const grams = (g: number) =>
  `${Math.round(g).toLocaleString('en-US')} g`;
export const usd = (n: number) => `$${n.toFixed(2)}`;

/** "PLA · Forest green": a stock line's name. */
export const filament = (i: { material: { code: string }; colour: string }) =>
  `${i.material.code} · ${i.colour || 'any colour'}`;

/** The movements list's filter for one stock line ("line:<id>", kept apart from the kinds). */
export const lineFilter = (id: string) => `line:${id}`;

export const STOCK_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: STUDIO_TIME_ZONE,
});

/** The four things the team records, each its own page; `?line=` pre-fills a stock line. */
export const STOCK_ACTIONS = [
  { path: '/admin/stock/receive', label: 'Spools received' },
  { path: '/admin/stock/purchase', label: 'Vendor bill' },
  { path: '/admin/stock/print', label: 'Printed for the studio' },
  { path: '/admin/stock/failed', label: 'Failed print' },
  { path: '/admin/stock/weigh', label: 'Weigh the spools' },
] as const;

/** What a movement was for: the product, the order, the note, the booking. */
export const movementFor = (m: StockMovementView) =>
  [
    m.product && `${m.quantity ?? 1} × ${m.product}`,
    // An order's note already names it.
    m.orderNumber && !m.note?.includes(m.orderNumber) ? m.orderNumber : null,
    m.note,
    m.entryNumber && `Booked ${m.entryNumber}`,
  ]
    .filter(Boolean)
    .join(' · ');

/** "+3,000 g" in green, "−120 g" in red. */
export function SignedGrams({ value }: { value: number }) {
  return (
    <span className={value < 0 ? 'text-danger' : 'text-success'}>
      {value > 0 ? '+' : '−'}
      {grams(Math.abs(value))}
    </span>
  );
}

export function Swatch({
  hex,
  large = false,
}: {
  hex: string | null;
  large?: boolean;
}) {
  const size = large ? 'h-8 w-8' : 'h-4 w-4';
  return (
    <span
      aria-hidden
      className={`${size} inline-block shrink-0 rounded-full border border-border`}
      style={
        hex
          ? { backgroundColor: hex }
          : {
              backgroundImage:
                'repeating-linear-gradient(45deg, var(--color-border) 0 3px, transparent 3px 6px)',
            }
      }
    />
  );
}

/** What is available against a full shelf: twice the reorder point (or a spool, if more). */
export function StockMeter({ item: i }: { item: StockItemView }) {
  const full = Math.max(i.reorderPointGrams * 2, i.spoolGrams, 1);
  const share = Math.max(0, Math.min(1, i.availableGrams / full));
  return (
    <div
      className="h-2 overflow-hidden rounded-pill bg-border"
      role="meter"
      aria-label={`${filament(i)}: available`}
      aria-valuemin={0}
      aria-valuemax={full}
      aria-valuenow={Math.max(0, i.availableGrams)}
    >
      <div
        className={`h-full rounded-pill ${i.needsRestock ? 'bg-warning' : 'bg-accent'}`}
        style={{ width: `${share * 100}%` }}
      />
    </div>
  );
}

/** "restock" or "not tracked", when a line is either. */
export function StockBadge({ item: i }: { item: StockItemView }) {
  if (!i.active)
    return <span className="text-xs text-text-muted">not tracked</span>;
  if (!i.needsRestock) return null;
  return (
    <span className="rounded-pill bg-warning px-2 py-0.5 text-xs text-background">
      restock
    </span>
  );
}

export type Colour = { label: string; swatchHex: string | null };

/** Every colour the shop names with a swatch, and those already on the shelf. */
export function coloursFrom(
  printables: readonly StockPrintable[],
  items: readonly StockItemView[],
): Colour[] {
  const out = new Map<string, Colour>();
  for (const p of printables)
    for (const c of p.colours) if (!out.has(c.label)) out.set(c.label, c);
  for (const i of items)
    if (i.colour && !out.has(i.colour))
      out.set(i.colour, { label: i.colour, swatchHex: i.swatchHex });
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The colour as swatches to tap (the shop's colours), or typed when it is new; "Any colour"
 * for filament where it doesn't matter. Sent as one `colour` field.
 */
export function ColourChoice({
  colours,
  value,
  onChange,
  allowAny = true,
  allowOther = true,
  pickLook = false,
  name = 'colour',
  legend = 'Colour',
  error,
}: {
  colours: readonly Colour[];
  value: string;
  onChange: (colour: string) => void;
  /** The field's name and heading: several on one form (a piece's parts) each have their own. */
  name?: string;
  legend?: string;
  allowAny?: boolean;
  allowOther?: boolean;
  /** Also how the colour looks (RGB), sent as `hex`: a new or special colour gets its own. */
  pickLook?: boolean;
  error?: string | undefined;
}) {
  const known = colours.some((c) => c.label === value);
  const swatch = colours.find((c) => c.label === value)?.swatchHex ?? null;
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <input type="hidden" name={name} value={value} />
      <div
        role="radiogroup"
        aria-label={legend}
        className="flex flex-wrap gap-2"
      >
        {allowAny && (
          <Chip active={value === ''} onClick={() => onChange('')}>
            Any colour
          </Chip>
        )}
        {colours.map((c) => (
          <Chip
            key={c.label}
            active={value === c.label}
            onClick={() => onChange(c.label)}
          >
            <Swatch hex={c.swatchHex} />
            {c.label}
          </Chip>
        ))}
      </div>
      {allowOther && (
        <Field
          label="Or a new colour"
          name="colour-other"
          value={known ? '' : value}
          onChange={(e) => onChange(e.currentTarget.value)}
          placeholder="e.g. Marble white"
        />
      )}
      {pickLook && value !== '' && (
        // Keyed by the colour: another colour starts from its own look.
        <ColourLook key={value} initial={swatch} />
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
  );
}

/**
 * How a filament colour looks, picked as RGB (`hex`): a new or special colour gets its own
 * swatch, shown wherever the stock lists it.
 */
export function ColourLook({ initial }: { initial: string | null }) {
  const [hex, setHex] = useState(initial ?? '#888888');
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
      How it looks
      <input
        type="color"
        id="colour-hex"
        name="hex"
        autoComplete="off"
        value={hex}
        onChange={(e) => setHex(e.currentTarget.value.toLowerCase())}
        className="h-9 w-14 cursor-pointer rounded-md border border-border bg-surface p-1"
      />
      <span className="font-mono text-text-muted">{hex}</span>
    </label>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-pill border px-3 py-1.5 text-sm ${active ? 'border-accent bg-accent/10 font-semibold' : 'border-border'}`}
    >
      {children}
    </button>
  );
}

/** What will be recorded, said back before it is: the check that numbers are right. */
export function Summary({ children }: { children: ReactNode }) {
  return (
    <p
      aria-live="polite"
      className="rounded-md bg-accent/10 px-3 py-2 text-sm sm:col-span-2 lg:col-span-3"
    >
      {children}
    </p>
  );
}

/**
 * One of the four recording pages: back to the list (and to the line it was opened from),
 * the form, locked for those who may only look.
 */
export function RecordPage({
  title,
  intro,
  line,
  children,
}: {
  title: string;
  intro: string;
  line: StockItemView | null;
  children: ReactNode;
}) {
  const manage = useCan()('stock.manage');
  return (
    <>
      <AdminHeader
        title={title}
        intro={intro}
        trail={[
          { label: 'Filament stock', to: '/admin/stock' },
          ...(line
            ? [{ label: filament(line), to: `/admin/stock/${line.id}` }]
            : []),
        ]}
        action={
          <Link
            to="/admin/stock/movements"
            className={buttonClass('secondary')}
          >
            Movements
          </Link>
        }
      />
      <Panel title="Record">
        <ViewOnly editable={manage}>{children}</ViewOnly>
      </Panel>
    </>
  );
}

export function Submit({
  label,
  fetcher,
}: {
  label: string;
  fetcher: ReturnType<typeof useFetcher<SaveResult>>;
}) {
  return (
    <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
      <Button type="submit" disabled={fetcher.state !== 'idle'}>
        {label}
      </Button>
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </div>
  );
}
