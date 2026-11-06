import {
  READY_PIECE_MOVEMENT_LABELS,
  READY_PIECE_TAKE_KINDS,
  type ReadyPieceDetail,
} from '@forgea/types';
import { CountReadyPiecesDto, TakeReadyPiecesDto } from '@forgea/validation';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import { studioFormat } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<ReadyPieceDetail>(`/ready-pieces/${encodeURIComponent(params.id)}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { piece: r.data };
}

/** take | count */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const api = context.get(apiContext);
  const base = `/ready-pieces/${encodeURIComponent(params.id)}`;
  if (form.get('intent') === 'count')
    return save(
      CountReadyPiecesDto,
      { counted: text(form, 'counted'), note: text(form, 'note') },
      (dto) => api.post(`${base}/count`, dto),
    );
  return save(
    TakeReadyPiecesDto,
    {
      kind: text(form, 'kind'),
      quantity: text(form, 'quantity'),
      orderNumber: text(form, 'orderNumber'),
      note: text(form, 'note'),
    },
    (dto) => api.post(`${base}/take`, dto),
  );
}

const WHEN = studioFormat({ dateStyle: 'medium', timeStyle: 'short' });

export default function ReadyPiecePage({ loaderData }: Route.ComponentProps) {
  const { piece: p } = loaderData;
  const mayManage = useCan()('stock.manage');
  const take = useFetcher<SaveResult>();
  const count = useFetcher<SaveResult>();
  return (
    <>
      <AdminHeader
        title={p.name}
        intro={`${p.details ? `${p.details} · ` : ''}${p.onHand} on the shelf, at an average cost of $${p.unitCost} each.`}
        trail={[
          { label: 'Filament stock', to: '/admin/stock' },
          { label: 'Ready pieces', to: '/admin/stock/pieces' },
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {mayManage && p.onHand > 0 && (
          <Panel title="Take pieces off the shelf">
            <take.Form
              method="post"
              key={take.data?.ok ? `t${p.onHand}` : 'take'}
              className="grid gap-3 sm:grid-cols-2"
            >
              <input type="hidden" name="intent" value="take" />
              <SelectField label="Why" name="kind" defaultValue="SOLD">
                {READY_PIECE_TAKE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {READY_PIECE_MOVEMENT_LABELS[k]}
                  </option>
                ))}
              </SelectField>
              <Field
                label="How many"
                name="quantity"
                type="number"
                min={1}
                max={p.onHand}
                required
                error={take.data?.errors?.['quantity']}
              />
              <Field
                label="Sold in order (optional)"
                name="orderNumber"
                placeholder="FG-2026-0012"
                error={take.data?.errors?.['orderNumber']}
              />
              <Field
                label="Note (optional)"
                name="note"
                placeholder="e.g. market stall, gift to a client"
                error={take.data?.errors?.['note']}
              />
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button type="submit" disabled={take.state !== 'idle'}>
                  Take them off
                </Button>
                <SaveStatus state={take.state} result={take.data} />
              </div>
              <p className="text-xs text-text-muted sm:col-span-2">
                A sale outside an order isn't in the books: record its payment
                in Accounting.
              </p>
            </take.Form>
          </Panel>
        )}
        {mayManage && (
          <Panel title="Count the shelf">
            <count.Form
              method="post"
              key={count.data?.ok ? `c${p.onHand}` : 'count'}
              className="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="intent" value="count" />
              <Field
                label="How many there really are"
                name="counted"
                type="number"
                min={0}
                defaultValue={p.onHand}
                required
                error={count.data?.errors?.['counted']}
              />
              <Field
                label="Note (optional)"
                name="note"
                error={count.data?.errors?.['note']}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={count.state !== 'idle'}
              >
                Save the count
              </Button>
              <SaveStatus state={count.state} result={count.data} />
            </count.Form>
          </Panel>
        )}
      </div>
      <Panel title="History" className="mt-6">
        <ul className="grid gap-2 text-sm">
          {p.movements.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2">
              <span>
                <strong className="tabular-nums">
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </strong>{' '}
                {READY_PIECE_MOVEMENT_LABELS[m.kind]}
                {m.order && (
                  <>
                    {' · '}
                    <Link
                      to={`/admin/orders/${m.order.id}`}
                      className="font-mono underline"
                    >
                      {m.order.number}
                    </Link>
                  </>
                )}
                {m.printJobId && (
                  <>
                    {' · '}
                    <Link
                      to={`/admin/production/${m.printJobId}`}
                      className="underline"
                    >
                      print run
                    </Link>
                  </>
                )}
                {m.note && <span className="text-text-muted"> · {m.note}</span>}
              </span>
              <span className="text-xs text-text-muted">
                <Money amount={m.unitCost} /> each ·{' '}
                {WHEN.format(new Date(m.createdAt))}
                {m.by ? ` · ${m.by}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
