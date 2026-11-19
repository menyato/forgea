import { CART_QUANTITY_MAX } from '@forgea/validation/constants';
import type { CartLine } from '@forgea/types';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { DesignLines } from '~/features/text-studio/design-lines';
import { SlotLines } from '~/features/design-slots/slot-lines';

/** One line with inline quantity change and removal (no page navigation). */
export function CartLineRow({ line }: { line: CartLine }) {
  const update = useFetcher<{ error?: string }>();
  const remove = useFetcher<{ error?: string }>();
  // Optimistic: hide the row as soon as removal is requested.
  if (remove.state !== 'idle') return null;
  const error = update.data?.error ?? remove.data?.error;

  return (
    <article className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="min-w-48 flex-1">
        <h2 className="font-semibold">
          <Link to={`/products/${line.slug}`} className="hover:underline">
            {line.name}
          </Link>
        </h2>
        {line.options.length > 0 && (
          <p className="text-sm">
            {line.options.map((o) => `${o.group}: ${o.value}`).join(' · ')}
          </p>
        )}
        {line.design && <DesignLines design={line.design} />}
        <SlotLines slots={line.slots} />
        <p className="text-sm text-text-muted">
          {line.materialCode} · <Money amount={line.unitPrice} /> each
          {line.isCustom && ' · made to order (50% deposit)'}
        </p>
      </div>
      <update.Form
        method="post"
        action="/cart"
        className="flex items-end gap-2"
      >
        <input type="hidden" name="intent" value="update" />
        <input type="hidden" name="lineId" value={line.id} />
        <label className="grid gap-1 text-sm">
          <span>Quantity</span>
          <input
            type="number"
            name="quantity"
            autoComplete="off"
            min={1}
            max={CART_QUANTITY_MAX}
            defaultValue={line.quantity}
            className="w-20 rounded-md border border-border bg-surface px-2 py-1.5"
          />
        </label>
        <Button
          type="submit"
          variant="secondary"
          disabled={update.state !== 'idle'}
        >
          Update
        </Button>
      </update.Form>
      <remove.Form method="post" action="/cart">
        <input type="hidden" name="intent" value="remove" />
        <input type="hidden" name="lineId" value={line.id} />
        <Button
          type="submit"
          variant="quiet"
          aria-label={`Remove ${[line.name, ...line.options.map((o) => o.value)].join(', ')}`}
        >
          Remove
        </Button>
      </remove.Form>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </article>
  );
}
