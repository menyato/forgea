import {
  type Page,
  PIECE_HELD_STAGES,
  PIECE_STAGE_LABELS,
  PIECE_STAGES,
  type PieceCounts,
  PieceStage,
  type PieceView,
} from '@forgea/types';
import { UpdatePieceDto } from '@forgea/validation';
import { Form, Link, redirect, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import { formatDay } from '~/features/admin/period-picker';
import { save, text } from '~/features/admin/staff.server';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  type ListFilter,
  ListView,
} from '~/features/admin/views';
import { ModelThumbnail } from '~/features/model-viewer/model-thumbnail';
import { apiContext } from '~/lib/request.server';
import { studioDay, studioToday } from '~/lib/studio-time';
import type { Route } from './+types/route';

const DEFAULTS = { sorts: ['printedAt', 'name'], view: 'kanban' } as const;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const GROUPS = [
  { key: 'stage', label: 'Where it is' },
  { key: 'month', label: 'Month printed' },
  { key: 'holder', label: 'Who has it' },
];

/** The period asked for (printed from–to), when both are dates. */
function periodOf(params: URLSearchParams) {
  const from = params.get('from');
  const to = params.get('to');
  return {
    from: from && DAY_PATTERN.test(from) ? from : null,
    to: to && DAY_PATTERN.test(to) ? to : null,
  };
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const period = periodOf(url.searchParams);
  const holderId = url.searchParams.get('holder');
  const shared = new URLSearchParams();
  if (period.from) shared.set('from', period.from);
  if (period.to) shared.set('to', period.to);
  if (holderId && /^[0-9a-f-]{36}$/.test(holderId))
    shared.set('holderId', holderId);
  if (state.q) shared.set('q', state.q);
  const stages = state.filters.filter((f): f is PieceStage =>
    (PIECE_STAGES as readonly string[]).includes(f),
  );
  // The kanban shows the most the API gives in one page (newest first).
  const query = pageQuery(state, state.view === 'kanban' ? 100 : 50);
  for (const [k, v] of shared) query.set(k, v);
  if (stages.length) query.set('stages', stages.join(','));
  const [page, counted] = await Promise.all([
    api.get<Page<PieceView>>(`/pieces?${query}`),
    api.get<PieceCounts>(`/pieces/counts?${shared}`),
  ]);
  if (!page.ok) throw new Response(page.message, { status: page.status });
  const counts: PieceCounts = counted.ok
    ? counted.data
    : { stages: {}, pieces: 0, grams: 0, cost: '0.00' };
  return {
    state,
    period,
    today: studioToday(),
    pieces: page.data,
    counts,
    total: state.q
      ? undefined
      : [...(stages.length ? stages : PIECE_STAGES)].reduce<number>(
          (n, s) => n + (counts.stages[s] ?? 0),
          0,
        ),
    columns: stages.length ? stages : [...PIECE_STAGES],
  };
}

/**
 * A card dragged to another column: where it is now. Given, sold or with someone asks who, on
 * the piece's page; a print still on the printer is finished there too.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const id = text(form, 'id') ?? '';
  const to = text(form, 'to') as PieceStage | undefined;
  const from = text(form, 'from');
  if (/^[0-9a-f-]{36}$/.test(id)) {
    if (from === PieceStage.PRINTING)
      throw redirect(`/admin/pieces/${id}?finish=1`);
    if (to && PIECE_HELD_STAGES.includes(to))
      throw redirect(`/admin/pieces/${id}?move=${to}`);
  }
  return save(UpdatePieceDto, { stage: to }, (dto) =>
    context.get(apiContext).patch(`/pieces/${encodeURIComponent(id)}`, dto),
  );
}

const PRINTED = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const printedDay = (p: PieceView) => formatDay(studioDay(p.printedAt));
const monthOf = (p: PieceView) =>
  PRINTED.format(new Date(`${studioDay(p.printedAt)}T00:00:00Z`));
const who = (p: PieceView) =>
  p.holder ?? p.holderAccount?.name ?? p.holderAccount?.email ?? null;

const COLUMNS: ListColumn<PieceView>[] = [
  {
    key: 'printed',
    label: 'Printed on',
    sort: 'printedAt',
    cell: (p) => <span className="whitespace-nowrap">{printedDay(p)}</span>,
  },
  {
    key: 'name',
    label: 'Piece',
    sort: 'name',
    cell: (p) => (
      <span className="grid gap-0.5">
        <span>
          {p.quantity > 1 && `${p.quantity} × `}
          {p.name}
        </span>
        {p.orderNumber && (
          <span className="font-mono text-xs text-text-muted">
            {p.orderNumber}
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'stage',
    label: 'Where it is',
    cell: (p) => PIECE_STAGE_LABELS[p.stage],
  },
  {
    key: 'holder',
    label: 'Who has it',
    cell: (p) => who(p) ?? <span className="text-text-muted">—</span>,
  },
  {
    key: 'grams',
    label: 'Filament',
    align: 'right',
    cell: (p) => (p.grams !== null ? `${p.grams} g` : '—'),
  },
  {
    key: 'cost',
    label: 'Cost to make',
    align: 'right',
    cell: (p) => (p.cost !== null ? <Money amount={p.cost} /> : '—'),
  },
];

const href = (p: PieceView) => `/admin/pieces/${p.id}`;

export default function Pieces({ loaderData }: Route.ComponentProps) {
  const { state, period, today, pieces, counts, total, columns } = loaderData;
  const mayMove = useCan()('stock.manage');
  const filters: ListFilter[] = PIECE_STAGES.map((s) => ({
    key: s,
    label: PIECE_STAGE_LABELS[s],
    count: counts.stages[s] ?? 0,
  }));
  return (
    <>
      <AdminHeader
        title="Where it is"
        intro="Everything printed: studio prints, failed prints and orders' pieces, when each was printed and where it is now (in the lab, in the shop, with someone, given or sold). Move a piece with Move to under its card, or drag the card; every move is kept with who made it."
        trail={[{ label: 'Production', to: '/admin/production' }]}
        action={
          mayMove && (
            <Link to="/admin/stock/print" className={buttonClass()}>
              Record a print
            </Link>
          )
        }
      />
      <PrintedPeriod period={period} today={today} />
      <p className="mb-4 text-sm text-text-muted">
        {counts.pieces} piece{counts.pieces === 1 ? '' : 's'} · {counts.grams} g
        of filament · <Money amount={counts.cost} /> to make
        {period.from || period.to ? ' in this period' : ''}.
      </p>
      <ControlPanel
        state={state}
        search="Piece, who has it, note or order number"
        filters={filters}
        groups={GROUPS}
        views={['kanban', 'list']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: pieces.items.length,
                total,
                nextCursor: pieces.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          move={mayMove}
          href={href}
          actions={
            mayMove
              ? (p, column, moveTo) => (
                  <MoveTo
                    piece={p}
                    stages={columns}
                    onMove={moveTo}
                    disabled={column !== p.stage}
                  />
                )
              : undefined
          }
          columns={columns.map((s) => ({
            key: s,
            title: PIECE_STAGE_LABELS[s],
            items: pieces.items.filter((p) => p.stage === s),
          }))}
          title={(p) => `${p.quantity > 1 ? `${p.quantity} × ` : ''}${p.name}`}
          card={(p) => (
            <>
              {p.modelKey && (
                <span className="block aspect-[16/9] w-full overflow-hidden rounded-md bg-surface">
                  <ModelThumbnail
                    modelKey={p.modelKey}
                    color="#9a9ea3"
                    turning={false}
                    fallback={null}
                  />
                </span>
              )}
              <span className="text-text-muted">
                Printed {printedDay(p)}
                {p.grams !== null && ` · ${p.grams} g`}
              </span>
              {who(p) && <span>{who(p)}</span>}
              {p.note && (
                <span className="line-clamp-2 text-xs text-text-muted">
                  {p.note}
                </span>
              )}
            </>
          )}
        />
      ) : (
        <ListView
          label="Pieces"
          rows={pieces.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty="Nothing printed in this period."
          group={(k) =>
            k === 'stage'
              ? {
                  of: (p) => PIECE_STAGE_LABELS[p.stage],
                  order: PIECE_STAGES.map((s) => PIECE_STAGE_LABELS[s]),
                }
              : k === 'month'
                ? { of: monthOf }
                : k === 'holder'
                  ? { of: (p) => who(p) ?? 'Nobody' }
                  : undefined
          }
        />
      )}
    </>
  );
}

/**
 * Where a piece goes next, without dragging: the same move as a drag (with someone, given or
 * sold then asks who on the piece's page; a print still printing is finished there).
 */
function MoveTo({
  piece,
  stages,
  onMove,
  disabled,
}: {
  piece: PieceView;
  stages: readonly PieceStage[];
  onMove: (to: string) => void;
  disabled: boolean;
}) {
  const id = `move-${piece.id}`;
  return (
    <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-xs">
      <span className="text-text-muted">Move to</span>
      <select
        id={id}
        name={id}
        autoComplete="off"
        value=""
        disabled={disabled}
        onChange={(e) => {
          const to = e.currentTarget.value;
          if (to) onMove(to);
        }}
        className="w-full min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-sm"
      >
        <option value="">Choose…</option>
        {stages
          .filter((s) => s !== piece.stage)
          .map((s) => (
            <option key={s} value={s}>
              {PIECE_STAGE_LABELS[s]}
            </option>
          ))}
      </select>
    </label>
  );
}

/**
 * The period the pieces were printed in: this month, last month, this year or all time, or
 * any two days; the board's other choices (view, filters, search) stay as they are.
 */
function PrintedPeriod({
  period,
  today,
}: {
  period: { from: string | null; to: string | null };
  today: string;
}) {
  const [params] = useSearchParams();
  const kept = [...params].filter(
    ([k]) => !['from', 'to', 'cursor', 'at'].includes(k),
  );
  const link = (from: string | null, to: string | null) => {
    const next = new URLSearchParams(kept);
    if (from) next.set('from', from);
    if (to) next.set('to', to);
    return `?${next}`;
  };
  const [y, m] = today.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStart = (yy: number, mm: number) => `${yy}-${pad(mm)}-01`;
  const monthEnd = (yy: number, mm: number) =>
    new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const last = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const presets = [
    { label: 'All time', from: null, to: null },
    { label: 'This month', from: monthStart(y, m), to: today },
    {
      label: 'Last month',
      from: monthStart(last.y, last.m),
      to: monthEnd(last.y, last.m),
    },
    { label: 'This year', from: `${y}-01-01`, to: today },
  ];
  return (
    <div className="mb-4 grid gap-3">
      <nav aria-label="Printed in" className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = p.from === period.from && p.to === period.to;
          return (
            <Link
              key={p.label}
              to={link(p.from, p.to)}
              aria-current={active ? 'page' : undefined}
              className={`rounded-pill border px-3 py-1 text-sm ${
                active
                  ? 'border-accent bg-accent text-on-accent'
                  : 'border-border bg-surface text-text hover:border-accent'
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      <Form
        key={`${period.from}:${period.to}`}
        method="get"
        className="flex flex-wrap items-end gap-3"
      >
        {kept.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Field
          label="Printed from"
          name="from"
          type="date"
          defaultValue={period.from ?? ''}
        />
        <Field
          label="to"
          name="to"
          type="date"
          defaultValue={period.to ?? ''}
        />
        <button type="submit" className={buttonClass('secondary')}>
          Show
        </button>
      </Form>
    </div>
  );
}
