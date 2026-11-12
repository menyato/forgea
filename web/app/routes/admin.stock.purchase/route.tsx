import { randomUUID } from 'node:crypto';
import type { MaterialView } from '@forgea/types';
import { VendorPurchaseDto } from '@forgea/validation';
import { VENDOR_PURCHASE_LINES_MAX } from '@forgea/validation/constants';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { shelfChoices } from '~/features/stock/stock.server';
import {
  Chip,
  RecordPage,
  Submit,
  Summary,
  usd,
} from '~/features/stock/stock-ui';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const choices = await shelfChoices(context.get(apiContext), url);
  return { ...choices, requestKey: randomUUID() };
}

/** The whole bill in one call: every reel on the shelf, the bill booked once. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(
    VendorPurchaseDto,
    {
      requestKey: text(form, 'requestKey'),
      vendor: text(form, 'vendor'),
      reference: text(form, 'reference'),
      discount: text(form, 'discount') ?? '0',
      paidFrom: text(form, 'paidFrom'),
      lines: jsonField(form, 'lines') ?? [],
    },
    (dto) => context.get(apiContext).post('/stock/purchases', dto),
  );
}

interface Line {
  materialId: string;
  colour: string;
  hex: string;
  spools: string;
  spoolGrams: string;
  pricePerSpool: string;
}

const SPOOL_SIZES = [250, 500, 750, 1000, 2000, 3000, 5000];

export default function VendorPurchase({ loaderData }: Route.ComponentProps) {
  const { materials, colours, canBook, requestKey } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const blank = (): Line => ({
    materialId: materials[0]?.id ?? '',
    colour: '',
    hex: '#888888',
    spools: '1',
    spoolGrams: '1000',
    pricePerSpool: '',
  });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [discount, setDiscount] = useState('0');
  const [paidFrom, setPaidFrom] = useState(canBook ? 'BANK' : '');
  const set = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const gross = lines.reduce(
    (n, l) => n + (Number(l.spools) || 0) * (Number(l.pricePerSpool) || 0),
    0,
  );
  const off = Number(discount) || 0;

  return (
    <RecordPage
      title="Vendor bill"
      intro="A supplier's bill as it reads: one line per filament (its name as bought, its colour, how many spools and the price of one), the discount on the whole bill, and where it was paid from. Every reel goes on the shelf at what it really cost, and the bill is booked once."
      line={null}
    >
      <fetcher.Form
        method="post"
        key={fetcher.data?.ok ? 'reset' : 'form'}
        className="grid gap-4"
      >
        <input type="hidden" name="requestKey" value={requestKey} />
        <input
          type="hidden"
          name="lines"
          value={JSON.stringify(
            lines.map((l) => ({
              materialId: l.materialId,
              colour: l.colour,
              ...(l.hex !== '#888888' ? { hex: l.hex } : {}),
              spools: l.spools,
              spoolGrams: l.spoolGrams,
              pricePerSpool: l.pricePerSpool,
            })),
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor"
            name="vendor"
            required
            placeholder="e.g. Elegoo store"
            error={errors['vendor']}
          />
          <Field
            label="Their invoice number (optional)"
            name="reference"
            placeholder="e.g. INV/2026/00437"
            error={errors['reference']}
          />
        </div>
        <datalist id="vendor-colours">
          {colours.map((c) => (
            <option key={c.label} value={c.label} />
          ))}
        </datalist>
        <ul aria-label="Bill lines" className="grid gap-3">
          {lines.map((l, i) => (
            <li
              key={i}
              className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_5rem_7rem_7rem_auto] lg:items-end"
            >
              <SelectField
                label="Material"
                name={`line-${i}-material`}
                value={l.materialId}
                onChange={(e) => set(i, { materialId: e.currentTarget.value })}
              >
                {materials.map((m: MaterialView) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.code})
                  </option>
                ))}
              </SelectField>
              <Field
                label="Filament as bought"
                name={`line-${i}-colour`}
                list="vendor-colours"
                required
                value={l.colour}
                onChange={(e) => {
                  const colour = e.currentTarget.value;
                  const known = colours.find((c) => c.label === colour);
                  set(i, {
                    colour,
                    ...(known?.swatchHex ? { hex: known.swatchHex } : {}),
                  });
                }}
                placeholder="e.g. Elegoo PLA Matte (White)"
              />
              <label className="grid gap-1.5 text-sm font-medium">
                Colour
                <input
                  type="color"
                  id={`line-${i}-hex`}
                  name={`line-${i}-hex`}
                  autoComplete="off"
                  value={l.hex}
                  onChange={(e) =>
                    set(i, { hex: e.currentTarget.value.toLowerCase() })
                  }
                  className="h-10 w-14 cursor-pointer rounded-md border border-border bg-surface p-1"
                />
              </label>
              <Field
                label="Spools"
                name={`line-${i}-spools`}
                type="number"
                min={1}
                value={l.spools}
                onChange={(e) => set(i, { spools: e.currentTarget.value })}
              />
              <SelectField
                label="Each holds"
                name={`line-${i}-spool-grams`}
                value={l.spoolGrams}
                onChange={(e) => set(i, { spoolGrams: e.currentTarget.value })}
              >
                {SPOOL_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s >= 1000 ? `${s / 1000} kg` : `${s} g`}
                  </option>
                ))}
              </SelectField>
              <Field
                label="Price of one (USD)"
                name={`line-${i}-price`}
                inputMode="decimal"
                required
                value={l.pricePerSpool}
                onChange={(e) =>
                  set(i, { pricePerSpool: e.currentTarget.value })
                }
              />
              <Button
                variant="quiet"
                aria-label={`Remove line ${i + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
        <p>
          <Button
            variant="secondary"
            disabled={lines.length >= VENDOR_PURCHASE_LINES_MAX}
            onClick={() => setLines([...lines, blank()])}
          >
            Add a line
          </Button>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Discount on the bill (USD)"
            name="discount"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.currentTarget.value)}
            error={errors['discount']}
            hint="Shared across the lines by their price"
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Paid from</legend>
            <input type="hidden" name="paidFrom" value={paidFrom} />
            <div role="radiogroup" className="flex flex-wrap gap-2">
              {canBook && (
                <>
                  <Chip
                    active={paidFrom === 'CASH'}
                    onClick={() => setPaidFrom('CASH')}
                  >
                    Cash box
                  </Chip>
                  <Chip
                    active={paidFrom === 'BANK'}
                    onClick={() => setPaidFrom('BANK')}
                  >
                    Money transfer
                  </Chip>
                </>
              )}
              <Chip active={paidFrom === ''} onClick={() => setPaidFrom('')}>
                Not booked
              </Chip>
            </div>
          </fieldset>
        </div>
        <Summary>
          {lines.length} line{lines.length === 1 ? '' : 's'} ·{' '}
          <strong>{usd(gross)}</strong>
          {off > 0 && (
            <>
              {' '}
              less {usd(off)} = <strong>{usd(Math.max(gross - off, 0))}</strong>
            </>
          )}
          {paidFrom ? ' · booked as a purchase' : ' · not booked'}
        </Summary>
        <Submit label="Add the bill to the shelf" fetcher={fetcher} />
      </fetcher.Form>
    </RecordPage>
  );
}
