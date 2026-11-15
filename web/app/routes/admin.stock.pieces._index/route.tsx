import type { ReadyPieceView, StockPrintable } from '@forgea/types';
import { AddReadyPiecesDto } from '@forgea/validation';
import { randomUUID } from 'node:crypto';
import { useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { StudioPrintForm } from '~/features/stock/stock-forms';
import { studioPrint } from '~/features/stock/stock.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const all = url.searchParams.get('all') === 'true';
  const [pieces, products] = await Promise.all([
    api.get<ReadyPieceView[]>(`/ready-pieces${all ? '?all=true' : ''}`),
    api.get<StockPrintable[]>('/stock/printables'),
  ]);
  if (!pieces.ok) throw new Response(pieces.message, { status: pieces.status });
  return {
    all,
    // A fresh one-time key each load (after a save too): sent twice, added once.
    requestKey: randomUUID(),
    // Its own key: the two forms are two different things to record.
    printKey: randomUUID(),
    pieces: pieces.data,
    printables: products.ok ? products.data : [],
    products: products.ok
      ? products.data.map((p) => ({
          id: p.id,
          name: p.name,
          // What one costs to make, from its model's grams and time (filament + machine).
          unitCost: p.unitCost,
        }))
      : [],
  };
}

/** Pieces just printed to sell (their filament comes off the shelf), or put on it by hand. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'print')
    return studioPrint(context.get(apiContext), form, false);
  return save(
    AddReadyPiecesDto,
    {
      productId: text(form, 'productId'),
      name: text(form, 'name'),
      details: text(form, 'details'),
      quantity: text(form, 'quantity'),
      unitCost: text(form, 'unitCost'),
      note: text(form, 'note'),
      requestKey: text(form, 'requestKey'),
    },
    (dto) => context.get(apiContext).post('/ready-pieces', dto),
  );
}

export default function ReadyPieces({ loaderData }: Route.ComponentProps) {
  const { all, pieces, products, printables, requestKey, printKey } =
    loaderData;
  const mayManage = useCan()('stock.manage');
  const total = pieces.reduce((n, p) => n + p.onHand, 0);
  const value = pieces.reduce((n, p) => n + Number(p.value), 0).toFixed(2);
  return (
    <>
      <AdminHeader
        title="Ready pieces"
        intro="Pieces printed and not sold yet: studio prints made to sell, a full plate's spares, orders cancelled after printing, and pieces added by hand. At what they cost to make."
        trail={[{ label: 'Filament stock', to: '/admin/stock' }]}
      />
      <p className="mb-4 text-sm">
        <strong>{total}</strong> piece{total === 1 ? '' : 's'} on the shelf,
        worth <Money amount={value} /> at cost.{' '}
        <Link to={all ? '?' : '?all=true'} className="underline">
          {all ? 'Only what is on the shelf' : 'Also show sold-out ones'}
        </Link>
      </p>
      {pieces.length === 0 ? (
        <p className="mb-6 text-text-muted">
          Nothing on the shelf. Pieces arrive here when a studio print is kept
          to sell, a print run has spares, or an order is cancelled after
          printing.
        </p>
      ) : (
        <div className="mb-6 overflow-x-auto rounded-lg border border-border bg-surface">
          <table aria-label="Ready pieces" className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Piece
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  On the shelf
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Cost each
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {pieces.map((p) => (
                <tr
                  key={p.id}
                  className="relative border-t border-border hover:bg-surface-raised"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/admin/stock/pieces/${p.id}`}
                      className="font-semibold after:absolute after:inset-0 hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.details && (
                      <span className="block text-xs text-text-muted">
                        {p.details}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {p.onHand}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money amount={p.unitCost} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money amount={p.value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mayManage && printables.length > 0 && (
        <Panel title="Printed to sell">
          <p className="mb-3 text-sm text-text-muted">
            Choose the product and the colour each part was printed in: the
            filament comes off those reels and the pieces go on the shelf at
            what they cost to make.
          </p>
          <StudioPrintForm
            shelf
            failed={false}
            printables={printables}
            start={null}
            requestKey={printKey}
          />
        </Panel>
      )}
      {mayManage && <AddForm products={products} requestKey={requestKey} />}
    </>
  );
}

function AddForm({
  products,
  requestKey,
}: {
  products: readonly { id: string; name: string; unitCost: string }[];
  requestKey: string;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [custom, setCustom] = useState(products.length === 0);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const product = custom ? undefined : products.find((p) => p.id === productId);
  return (
    <Panel title="Add pieces by hand">
      <p className="mb-3 text-sm text-text-muted">
        For pieces made before or elsewhere: nothing comes off the filament
        shelf. Just printed them? Use <strong>Printed to sell</strong> above.
      </p>
      <fetcher.Form
        method="post"
        key={fetcher.data?.ok ? 'reset' : 'form'}
        className="grid gap-3 sm:grid-cols-2"
      >
        <input type="hidden" name="requestKey" value={requestKey} />
        <div className="sm:col-span-2">
          <CheckboxField
            label="A custom design (not a product of the shop)"
            name="custom"
            checked={custom}
            onChange={(e) => setCustom(e.currentTarget.checked)}
          />
        </div>
        {custom ? (
          <Field
            label="What it is"
            name="name"
            required
            placeholder="e.g. Wedding favour, Nour & Karim"
            error={errors['name']}
          />
        ) : (
          <SelectField
            label="Product"
            name="productId"
            required
            value={productId}
            onChange={(e) => setProductId(e.currentTarget.value)}
            error={errors['productId']}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        )}
        <Field
          label="Colour, size, text (optional)"
          name="details"
          placeholder="e.g. Red · 18 × 12 × 9 cm"
          error={errors['details']}
        />
        <Field
          label="How many"
          name="quantity"
          type="number"
          min={1}
          required
          error={errors['quantity']}
        />
        <Field
          // A product's cost fills in from its model's grams and time; change it if it differed.
          key={product?.id ?? 'custom'}
          label="What one cost to make (USD)"
          name="unitCost"
          inputMode="decimal"
          required
          defaultValue={product?.unitCost ?? ''}
          hint={
            product
              ? "From the product's grams and print time (filament and machine)."
              : undefined
          }
          error={errors['unitCost']}
        />
        <Field label="Note (optional)" name="note" error={errors['note']} />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Add to the shelf
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}
