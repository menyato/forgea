import {
  PRICE_LINES,
  type RequestPrice,
  type StaffCustomRequest,
} from '@forgea/types';
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, FormAlert } from '~/components/ui/field';
import { Panel } from '~/features/admin/admin-ui';

export type PriceResult =
  | { price: RequestPrice; error?: undefined; errors?: undefined }
  | {
      price?: undefined;
      error: string;
      errors?: Partial<Record<string, string>> | undefined;
    };

type Figures = NonNullable<StaffCustomRequest['printFigures']>;

/** What one piece takes, from the file that prices the request and that its order prints. */
export function PrintFigures({ figures }: { figures: Figures }) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-medium">
        Priced and printed from{' '}
        {figures.source === 'design' ? 'our design' : "the customer's file"}
        {figures.sliced ? ' (sliced)' : ' (estimated from the model)'}
      </p>
      <p className="text-text-muted">
        One piece: {figures.grams} g · {Number(figures.printHours).toFixed(2)} h
        {figures.colours.length > 0 &&
          ` · ${figures.colours.map((c) => `${c.colour} ${c.grams} g`).join(', ')}`}
      </p>
    </div>
  );
}

/**
 * The request priced by the shop's rules (the same as a product), line by line: untick a line
 * to leave it out, add the studio's own costs, then use the total in the quote. Nothing is
 * saved or sent until the quote is.
 */
export function PricePanel({ onUse }: { onUse: (price: string) => void }) {
  const fetcher = useFetcher<PriceResult>();
  const [rows, setRows] = useState(0);
  const started = useRef(false);
  const result = fetcher.data;
  const price = result?.price;
  // The shop's price at once, every line on.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const form = new FormData();
    form.set('intent', 'preview');
    for (const l of PRICE_LINES) form.append('on', l.key);
    void fetcher.submit(form, { method: 'post' });
  }, [fetcher]);
  const amount = (key: string) =>
    price?.lines.find((l) => l.key === key)?.amount;

  return (
    <Panel title="Price by the shop's rules">
      <fetcher.Form method="post" className="grid gap-3">
        <input type="hidden" name="intent" value="preview" />
        <div className="grid gap-2">
          {PRICE_LINES.map((l) => (
            <div key={l.key} className="flex items-start justify-between gap-3">
              <CheckboxField
                label={l.label}
                name="on"
                value={l.key}
                defaultChecked
                hint={
                  l.key === 'profit' && price
                    ? price.profitRule.kind === 'PERCENT'
                      ? `${price.profitRule.value} % of the cost`
                      : `$${price.profitRule.value} a piece`
                    : undefined
                }
              />
              <span className="text-sm tabular-nums">
                {amount(l.key) ? <Money amount={amount(l.key)!} /> : '…'}
              </span>
            </div>
          ))}
        </div>
        {rows > 0 && (
          <div className="grid gap-2">
            <p className="text-sm font-medium">
              Our own costs (for the whole request)
            </p>
            {Array.from({ length: rows }, (_, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2"
              >
                <Field
                  label={`Cost ${i + 1}`}
                  name="costLabel"
                  placeholder="Key ring, paint, delivery…"
                  error={result?.errors?.[`added.${i}.label`]}
                />
                <Field
                  label="USD"
                  name="costAmount"
                  inputMode="decimal"
                  error={result?.errors?.[`added.${i}.amount`]}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((n) => Math.min(n + 1, 20))}
          >
            Add a cost
          </Button>
          <Button
            type="submit"
            variant="secondary"
            disabled={fetcher.state !== 'idle'}
          >
            Work out the price
          </Button>
        </div>
        <FormAlert message={result?.error} />
        {price && (
          <div className="grid gap-1 border-t border-border pt-3 text-sm">
            <p className="flex justify-between gap-3">
              <span>Cost</span>
              <Money amount={price.subtotal} />
            </p>
            <p className="flex justify-between gap-3">
              <span>Profit</span>
              <Money amount={price.profit} />
            </p>
            <p className="flex justify-between gap-3 text-lg font-bold">
              <span>
                Price ({price.pieces} piece{price.pieces === 1 ? '' : 's'})
              </span>
              <Money amount={price.price} />
            </p>
            <Button type="button" onClick={() => onUse(price.price)}>
              Use this price in the quote
            </Button>
          </div>
        )}
      </fetcher.Form>
    </Panel>
  );
}
