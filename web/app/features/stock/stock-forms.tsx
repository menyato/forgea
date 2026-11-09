import type {
  MaterialView,
  StockItemView,
  StockPrintable,
} from '@forgea/types';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import type { SaveResult } from '~/features/admin/staff.server';
import {
  Chip,
  type Colour,
  ColourChoice,
  grams,
  Submit,
  Summary,
  usd,
} from './stock-ui';

/** A stock line to start from (opened from its page), or the first material. */
export interface StartingLine {
  materialId: string;
  colour: string;
}

const SPOOL_SIZES = [250, 500, 750, 1000, 2000, 3000, 5000];

export function ReceiveForm({
  materials,
  colours,
  canBook,
  start,
  requestKey,
}: {
  /** The page's one-time key: the same form sent twice is recorded once. */
  requestKey: string;
  materials: readonly MaterialView[];
  colours: readonly Colour[];
  canBook: boolean;
  start: StartingLine | null;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [materialId, setMaterialId] = useState(
    start?.materialId ?? materials[0]?.id ?? '',
  );
  const material = materials.find((m) => m.id === materialId);
  const [colour, setColour] = useState(start?.colour ?? '');
  const [spools, setSpools] = useState('1');
  const [spoolGrams, setSpoolGrams] = useState(
    String(material?.reelGrams ?? 1000),
  );
  const [price, setPrice] = useState(material?.reelPrice ?? '');
  const [paidFrom, setPaidFrom] = useState(canBook ? 'CASH' : '');
  const n = Number(spools) || 0;
  const g = Number(spoolGrams) || 0;
  const p = Number(price) || 0;
  const perGram = g > 0 ? p / g : 0;
  return (
    <fetcher.Form
      method="post"
      key={fetcher.data?.ok ? 'reset' : 'form'}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="requestKey" value={requestKey} />
      <SelectField
        label="Material"
        name="materialId"
        value={materialId}
        onChange={(e) => {
          const m = materials.find((x) => x.id === e.currentTarget.value);
          setMaterialId(e.currentTarget.value);
          // Its last spool as the starting point.
          if (m?.reelGrams) setSpoolGrams(String(m.reelGrams));
          if (m?.reelPrice) setPrice(m.reelPrice);
        }}
        error={errors['materialId']}
      >
        {materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.code})
          </option>
        ))}
      </SelectField>
      <Field
        label="Spools"
        name="spools"
        type="number"
        min={1}
        value={spools}
        onChange={(e) => setSpools(e.currentTarget.value)}
        error={errors['spools']}
      />
      <SelectField
        label="Each spool holds"
        name="spoolGrams"
        value={spoolGrams}
        onChange={(e) => setSpoolGrams(e.currentTarget.value)}
        error={errors['spoolGrams']}
      >
        {[...new Set([...SPOOL_SIZES, g].filter((x) => x > 0))]
          .sort((a, b) => a - b)
          .map((s) => (
            <option key={s} value={s}>
              {s >= 1000 ? `${s / 1000} kg` : `${s} g`}
            </option>
          ))}
      </SelectField>
      <div className="sm:col-span-2 lg:col-span-3">
        <ColourChoice
          colours={colours}
          value={colour}
          onChange={setColour}
          pickLook
        />
      </div>
      <Field
        label="Price of one spool (USD)"
        name="pricePerSpool"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.currentTarget.value)}
        error={errors['pricePerSpool']}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Paid from</legend>
        <input type="hidden" name="paidFrom" value={paidFrom} />
        <div
          role="radiogroup"
          aria-label="Paid from"
          className="flex flex-wrap gap-2"
        >
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
        <p className="text-xs text-text-muted">
          Paid: booked in the accounts as filament bought.
        </p>
      </fieldset>
      <div className="grid content-start gap-3">
        <CheckboxField
          label="Use this price from now on"
          name="updateCost"
          defaultChecked
          hint="Products are priced with this material’s cost per gram"
        />
      </div>
      <Field
        label="Note (optional)"
        name="note"
        error={errors['note']}
        placeholder="e.g. supplier, invoice number"
      />
      <Summary>
        {n > 0 && g > 0 ? (
          <>
            <strong>+{grams(n * g)}</strong> of {material?.code ?? '…'}{' '}
            {colour || '(any colour)'}
            {p > 0 && (
              <>
                {' '}
                · <strong>{usd(n * p)}</strong> · ${perGram.toFixed(4)} a gram
                {material &&
                  Number(material.pricePerGram) > 0 &&
                  ` (now $${Number(material.pricePerGram).toFixed(4)})`}
              </>
            )}
            {paidFrom &&
              p > 0 &&
              ` · booked from the ${paidFrom === 'CASH' ? 'cash box' : 'transfers'}`}
          </>
        ) : (
          'Enter how many spools came in.'
        )}
      </Summary>
      <Submit label="Add to the shelf" fetcher={fetcher} />
    </fetcher.Form>
  );
}

const STUDIO_REASONS = ['Sample', 'Display', 'Gift', 'Made ahead for stock'];

/**
 * The product to start from for a stock line: one in its material offered in its colour,
 * else one in its material, else the first.
 */
export function startingPrintable(
  printables: readonly StockPrintable[],
  line: StockItemView | null,
): { productId: string; colour: string } | null {
  if (!line) return null;
  const same = printables.filter((p) => p.materialCode === line.material.code);
  const product =
    same.find((p) => p.colours.some((c) => c.label === line.colour)) ?? same[0];
  if (!product) return null;
  return {
    productId: product.id,
    colour: product.colours.some((c) => c.label === line.colour)
      ? line.colour
      : (product.colours[0]?.label ?? ''),
  };
}

export function StudioPrintForm({
  failed,
  printables,
  start,
  requestKey,
}: {
  requestKey: string;
  failed: boolean;
  printables: readonly StockPrintable[];
  start: { productId: string; colour: string } | null;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [productId, setProductId] = useState(
    start?.productId ?? printables[0]?.id ?? '',
  );
  const product = printables.find((p) => p.id === productId);
  const [colour, setColour] = useState(
    start?.colour ?? product?.colours[0]?.label ?? '',
  );
  const [quantity, setQuantity] = useState('1');
  const [progress, setProgress] = useState(50);
  const [note, setNote] = useState('');
  if (printables.length === 0) {
    return (
      <p className="text-sm text-text-muted">
        No product can be costed yet: give products a material, grams and print
        time first.
      </p>
    );
  }
  const q = Number(quantity) || 0;
  const share = failed ? progress / 100 : 1;
  const g = Number(product?.gramsPerUnit ?? 0) * q * share;
  const cost = Number(product?.unitCost ?? 0) * q * share;
  return (
    <fetcher.Form
      method="post"
      key={fetcher.data?.ok ? 'reset' : 'form'}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <input type="hidden" name="requestKey" value={requestKey} />
      <SelectField
        label="Product"
        name="productId"
        value={productId}
        onChange={(e) => {
          const next = printables.find((p) => p.id === e.currentTarget.value);
          setProductId(e.currentTarget.value);
          setColour(next?.colours[0]?.label ?? '');
        }}
        error={errors['productId']}
      >
        {printables.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.materialCode})
          </option>
        ))}
      </SelectField>
      {product && product.sizes.length > 0 && (
        <SelectField
          label="Size"
          name="size"
          key={product.id}
          error={errors['size']}
        >
          {product.sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      )}
      <Field
        label={failed ? 'How many failed' : 'How many'}
        name="quantity"
        type="number"
        min={1}
        value={quantity}
        onChange={(e) => setQuantity(e.currentTarget.value)}
        error={errors['quantity']}
      />
      {product && product.colours.length > 0 && (
        <div className="sm:col-span-2 lg:col-span-3">
          <ColourChoice
            colours={product.colours}
            value={colour}
            onChange={setColour}
            allowAny={false}
            allowOther={false}
            error={errors['colour']}
          />
        </div>
      )}
      {failed && (
        <div className="grid gap-1.5 sm:col-span-2">
          <label htmlFor="stock-progress" className="text-sm font-medium">
            How far it got: {progress}%
          </label>
          <input
            id="stock-progress"
            type="range"
            name="progressPercent"
            autoComplete="off"
            min={1}
            max={100}
            value={progress}
            onChange={(e) => setProgress(Number(e.currentTarget.value))}
            className="w-full accent-accent"
          />
          <p className="text-xs text-text-muted">
            The filament it used up to then is lost.
          </p>
        </div>
      )}
      <div className="grid gap-2 sm:col-span-2 lg:col-span-3">
        {!failed && (
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Why"
          >
            {STUDIO_REASONS.map((r) => (
              <Chip key={r} active={note === r} onClick={() => setNote(r)}>
                {r}
              </Chip>
            ))}
          </div>
        )}
        <Field
          label={failed ? 'What went wrong (optional)' : 'Why (optional)'}
          name="note"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          error={errors['note']}
          placeholder={failed ? 'e.g. came off the bed' : 'e.g. for the fair'}
        />
      </div>
      {!failed && (
        <div className="sm:col-span-2 lg:col-span-3">
          <CheckboxField
            label="Keep them on the shelf to sell"
            name="toShelf"
            defaultChecked
            hint="They go to the ready pieces at what they cost to make; untick for tests and samples"
          />
        </div>
      )}
      <Summary>
        {q > 0 && product ? (
          <>
            <strong>−{grams(g)}</strong> of {product.materialCode}{' '}
            {colour || ''} · about <strong>{usd(cost)}</strong> with machine
            time
            {product.sizes.length > 1 &&
              ' (in its first size; others are worked out when saved)'}
            {failed && ' · counted as lost'}
          </>
        ) : (
          'Choose the product and how many.'
        )}
      </Summary>
      <Submit
        label={failed ? 'Record the failure' : 'Take it off the shelf'}
        fetcher={fetcher}
      />
    </fetcher.Form>
  );
}

export function CountForm({
  materials,
  colours,
  items,
  start,
}: {
  materials: readonly MaterialView[];
  colours: readonly Colour[];
  items: readonly StockItemView[];
  start: StartingLine | null;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [materialId, setMaterialId] = useState(
    start?.materialId ?? materials[0]?.id ?? '',
  );
  const [colour, setColour] = useState(start?.colour ?? '');
  const [onShelf, setOnShelf] = useState('');
  const line = items.find(
    (i) => i.material.id === materialId && i.colour === colour,
  );
  const now = line?.stockGrams ?? 0;
  const weighed = onShelf === '' ? null : Number(onShelf);
  const difference = weighed === null ? null : weighed - now;
  return (
    <fetcher.Form
      method="post"
      key={fetcher.data?.ok ? 'reset' : 'form'}
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <SelectField
        label="Material"
        name="materialId"
        value={materialId}
        onChange={(e) => setMaterialId(e.currentTarget.value)}
        error={errors['materialId']}
      >
        {materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ({m.code})
          </option>
        ))}
      </SelectField>
      <Field
        label="On the shelf now (g)"
        name="gramsOnShelf"
        type="number"
        min={0}
        value={onShelf}
        onChange={(e) => setOnShelf(e.currentTarget.value)}
        error={errors['gramsOnShelf']}
        hint="Weigh the spools, less the empty spools’ weight"
      />
      <Field
        label="Note (optional)"
        name="note"
        error={errors['note']}
        placeholder="e.g. monthly count"
      />
      <div className="sm:col-span-2 lg:col-span-3">
        <ColourChoice
          colours={colours}
          value={colour}
          onChange={setColour}
          pickLook
        />
      </div>
      <Summary>
        The shelf should hold <strong>{grams(now)}</strong>
        {difference !== null &&
          (difference === 0 ? (
            <>: it matches, nothing to record.</>
          ) : (
            <>
              ; recorded as a correction of{' '}
              <strong>
                {difference > 0 ? '+' : '−'}
                {grams(Math.abs(difference))}
              </strong>
              .
            </>
          ))}
      </Summary>
      <Submit label="Save the count" fetcher={fetcher} />
    </fetcher.Form>
  );
}
