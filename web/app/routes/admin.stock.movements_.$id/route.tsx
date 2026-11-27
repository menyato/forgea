import {
  type FilamentChoice,
  STOCK_MOVEMENT_LABELS,
  type StockMovementView,
} from '@forgea/types';
import { MoveStockMovementDto } from '@forgea/validation';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { ConfirmButton } from '~/components/ui/confirm-button';
import { SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import {
  grams,
  MovementFor,
  SignedGrams,
  STOCK_TIME,
} from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [movement, filaments] = await Promise.all([
    api.get<StockMovementView>(
      `/stock/movements/${encodeURIComponent(params.id)}`,
    ),
    api.get<FilamentChoice[]>('/stock/filaments'),
  ]);
  if (!movement.ok)
    throw new Response(movement.message, { status: movement.status });
  return {
    movement: movement.data,
    filaments: filaments.ok ? filaments.data : [],
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(
    MoveStockMovementDto,
    { stockItemId: text(form, 'stockItemId') },
    (dto) =>
      context
        .get(apiContext)
        .post(`/stock/movements/${encodeURIComponent(params.id)}/move`, dto),
  );
}

const name = (f: { material: string; colour: string }) =>
  `${f.material} · ${f.colour || 'no colour'}`;

export default function StockMovementPage({
  loaderData,
}: Route.ComponentProps) {
  const { movement: m, filaments } = loaderData;
  const can = useCan();
  const filament = `${m.materialCode} · ${m.colour || 'no colour'}`;
  const out = m.grams < 0;
  return (
    <>
      <AdminHeader
        trail={[
          { label: 'Filament stock', to: '/admin/stock' },
          { label: filament, to: `/admin/stock/${m.stockItemId}` },
        ]}
        title={`${STOCK_MOVEMENT_LABELS[m.kind]}: ${out ? '−' : '+'}${grams(Math.abs(m.grams))}`}
        intro={`${out ? 'Taken from' : 'Put on'} ${filament} on ${STOCK_TIME.format(new Date(m.createdAt))}, ${
          m.by ? `by ${m.by}` : 'automatically'
        }.`}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="What it was">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Filament</dt>
            <dd>
              <Link
                to={`/admin/stock/${m.stockItemId}`}
                className="underline underline-offset-2"
              >
                {filament}
              </Link>
            </dd>
            <dt className="text-text-muted">Grams</dt>
            <dd>
              <SignedGrams value={m.grams} />
            </dd>
            <dt className="text-text-muted">Cost</dt>
            <dd>{m.cost !== null ? <Money amount={m.cost} /> : '—'}</dd>
            <dt className="text-text-muted">For</dt>
            <dd>
              <MovementFor m={m} />
            </dd>
            {m.moved && (
              <>
                <dt className="text-text-muted">Moved</dt>
                <dd>
                  First recorded on {m.moved.from}; moved here on{' '}
                  {STOCK_TIME.format(new Date(m.moved.at))}
                  {m.moved.by ? ` by ${m.moved.by}` : ''}.
                </dd>
              </>
            )}
          </dl>
        </Panel>
        {can('stock.manage') && (
          <Panel title="Printed from another filament?">
            {m.movable ? (
              <MoveForm
                movement={m}
                filaments={filaments}
                filament={filament}
              />
            ) : (
              <p className="text-sm text-text-muted">
                {m.links.orderId && m.kind === 'ORDER'
                  ? "This order's reels are picked per colour: change them on the order's Filaments panel."
                  : 'A count stays on the filament it was weighed on. If the shelf is wrong, weigh it again.'}
              </p>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

function MoveForm({
  movement: m,
  filaments,
  filament,
}: {
  movement: StockMovementView;
  filaments: readonly FilamentChoice[];
  filament: string;
}) {
  const fetcher = useFetcher<SaveResult>();
  const others = filaments.filter((f) => f.id !== m.stockItemId);
  return (
    <fetcher.Form method="post" className="grid gap-3">
      <p className="text-sm text-text-muted">
        Recorded on the wrong filament? Choose the one it really{' '}
        {m.grams < 0 ? 'came off' : 'went on'}: its {grams(Math.abs(m.grams))}{' '}
        {m.grams < 0 ? 'go back on' : 'come off'} {filament} and{' '}
        {m.grams < 0 ? 'come off' : 'go on'} that one. What it was for stays as
        recorded, and the page keeps where it was first.
      </p>
      <SelectField
        label="It really was"
        name="stockItemId"
        defaultValue=""
        error={fetcher.data?.errors?.['stockItemId']}
      >
        <option value="">Choose the filament…</option>
        {others.map((f) => (
          <option key={f.id} value={f.id}>
            {name(f)} ({grams(f.stockGrams)} on the shelf)
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap items-center gap-3">
        <ConfirmButton
          variant="primary"
          question={`Move these ${grams(Math.abs(m.grams))} off ${filament}?`}
          yes="Yes, move them"
          disabled={fetcher.state !== 'idle'}
        >
          Move to that filament
        </ConfirmButton>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}
