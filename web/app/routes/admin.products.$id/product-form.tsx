import {
  type AdminProduct,
  type CategoryView,
  formatSizeCm,
  type MaterialView,
  type OptionGroupView,
  type ProductColourView,
  type ProductOptionConfig,
  type ProductSizeView,
  type ProductTextSettings,
  type ProductRealCost,
  type ProfitKind,
  type SizeCm,
} from '@forgea/types';
import { useCallback, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { ColoursEditor } from './colours-editor';
import { PricePanel } from './price-panel';
import { RealCostPanel } from './real-cost-panel';
import { TextSettingsPanel } from './text-settings';
import type { loader as productLoader } from './route';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import {
  CheckboxField,
  Field,
  SelectField,
  TextAreaField,
} from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { ProfitValue } from '~/features/admin/profit-rule-field';
import type { SaveResult } from '~/features/admin/staff.server';
import { ImagesField } from './images-field';
import { ModelField } from './model-field';
import { OptionsConfig } from './options-config';
import { NO_SIZE, SizesEditor } from './sizes-editor';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export function ProductForm({
  product,
  categories,
  materials,
  groups,
  others,
  shopProfit,
  realCost,
}: {
  product: AdminProduct | null;
  /** The shop's profit rule; null when the editor may not manage pricing. */
  shopProfit: { kind: ProfitKind; value: string } | null;
  /** What its pieces really cost to print; null for a new product or without production. */
  realCost: ProductRealCost | null;
  /** Other products, to copy their options from. */
  others: readonly { id: string; name: string }[];
  categories: readonly CategoryView[];
  materials: readonly MaterialView[];
  groups: readonly OptionGroupView[];
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(product !== null);
  const [materialId, setMaterialId] = useState(
    product?.materialId ?? materials.find((m) => m.active)?.id ?? '',
  );
  const [grams, setGrams] = useState(product?.grams ?? '');
  const [hours, setHours] = useState(product?.printHours ?? '');
  const [modelKey, setModelKey] = useState(product?.modelFileKey ?? null);
  const [imageKeys, setImageKeys] = useState<string[]>(
    product?.imageKeys ?? [],
  );
  const [options, setOptions] = useState<ProductOptionConfig[]>(
    product?.options ?? [],
  );
  const [measured, setMeasured] = useState<SizeCm>(product?.size ?? NO_SIZE);
  const [sizes, setSizes] = useState<ProductSizeView[]>(product?.sizes ?? []);
  const [text, setText] = useState<ProductTextSettings | null>(
    product?.text ?? null,
  );
  const [profit, setProfit] = useState<ProfitValue>(
    product?.profit
      ? { kind: product.profit.kind, value: product.profit.value }
      : { kind: 'SHOP', value: '' },
  );
  const [priceOverride, setPriceOverride] = useState(
    product?.priceOverride ?? '',
  );
  const [colours, setColoursOnly] = useState<ProductColourView[]>(
    product?.colours ?? [],
  );
  const [partGroupId, setPartGroupId] = useState(
    product?.partColourGroupId ?? '',
  );
  // The colours are the product's grams split up: their sum is its grams.
  const setColours = useCallback((next: ProductColourView[]) => {
    setColoursOnly(next);
    if (next.length > 0) {
      setGrams(next.reduce((n, c) => n + (Number(c.grams) || 0), 0).toFixed(1));
    }
  }, []);
  const suggest = useCallback(
    (e: { grams: string; printHours: string; size: SizeCm }) => {
      setGrams(e.grams);
      setHours(e.printHours);
      setMeasured(e.size);
    },
    [],
  );
  const optionErrors = Object.entries(errors)
    .filter(([k]) => k.startsWith('options'))
    .map(([, m]) => m);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="grid content-start gap-6">
        <Panel title="3D model">
          <ModelField
            modelKey={modelKey}
            onModelKey={setModelKey}
            material={materials.find((m) => m.id === materialId)}
            onSuggest={suggest}
            // Read again from the file: parts keep their names (by file colour).
            onColours={(next) =>
              setColours(
                next.map((c) => ({
                  ...c,
                  part: colours.find((o) => o.hex === c.hex)?.part ?? null,
                })),
              )
            }
            name={name}
          />
        </Panel>
        <Panel title="Photos">
          <ImagesField keys={imageKeys} onChange={setImageKeys} />
        </Panel>
      </div>

      <fetcher.Form method="post" className="grid content-start gap-6">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="modelFileKey" value={modelKey ?? ''} />
        <input
          type="hidden"
          name="imageKeys"
          value={JSON.stringify(imageKeys)}
        />
        <input type="hidden" name="options" value={JSON.stringify(options)} />
        <input type="hidden" name="colours" value={JSON.stringify(colours)} />
        <input type="hidden" name="sizeXcm" value={measured.x} />
        <input type="hidden" name="sizeYcm" value={measured.y} />
        <input type="hidden" name="sizeZcm" value={measured.z} />
        <input
          type="hidden"
          name="sizes"
          value={JSON.stringify(
            sizes.map((s) => ({
              // An emptied name: the size goes by its measurements.
              label: s.label.trim() || formatSizeCm(s.size),
              sizeXcm: s.size.x,
              sizeYcm: s.size.y,
              sizeZcm: s.size.z,
              grams: s.grams,
              printHours: s.printHours,
              isDefault: s.isDefault,
            })),
          )}
        />

        <Panel title="Details">
          <Field
            label="Name"
            name="name"
            required
            value={name}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setName(v);
              if (!slugEdited) setSlug(slugify(v));
            }}
            error={errors['name']}
          />
          <Field
            label="Web address"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlug(e.currentTarget.value);
              setSlugEdited(true);
            }}
            error={errors['slug']}
            hint={`/products/${slug || '…'}`}
          />
          <TextAreaField
            label="Description"
            name="description"
            required
            defaultValue={product?.description}
            error={errors['description']}
          />
          <Field
            label="Designed by (optional)"
            name="designer"
            defaultValue={product?.designer ?? undefined}
            error={errors['designer']}
            hint="Shown on the product page, e.g. Forgea Studio or a guest designer"
          />
          <SelectField
            label="Category"
            name="categoryId"
            defaultValue={product?.categoryId ?? ''}
            error={errors['categoryId']}
          >
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.active && ' (hidden)'}
              </option>
            ))}
          </SelectField>
          {categories.length === 0 && (
            <p className="text-sm text-text-muted">
              <Link to="/admin/categories" className="underline">
                Create categories
              </Link>{' '}
              to group products in the shop.
            </p>
          )}
        </Panel>

        <Panel title="Printing and price">
          <SelectField
            label="Material"
            name="materialId"
            value={materialId}
            onChange={(e) => setMaterialId(e.currentTarget.value)}
            error={errors['materialId']}
            hint="The default; a Material option can switch it"
          >
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.code})
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Material (g)"
              name="grams"
              inputMode="decimal"
              required
              value={grams}
              onChange={(e) => setGrams(e.currentTarget.value)}
              error={errors['grams']}
            />
            <Field
              label="Print time (h)"
              name="printHours"
              inputMode="decimal"
              required
              value={hours}
              onChange={(e) => setHours(e.currentTarget.value)}
              error={errors['printHours']}
            />
          </div>
          <ColoursEditor
            value={colours}
            onChange={setColours}
            partGroupId={partGroupId}
            onPartGroupId={setPartGroupId}
            groups={groups}
            errors={errors}
          />
          <CheckboxField
            label="Made to order"
            name="isCustom"
            defaultChecked={product?.isCustom ?? false}
            hint="Checkout asks for a 50% deposit"
          />
          <CheckboxField
            label="Visible in the shop"
            name="active"
            defaultChecked={product?.active ?? true}
          />
          <PricePanel
            materialId={materialId}
            grams={grams}
            printHours={hours}
            modelFileKey={modelKey}
            profit={profit}
            onProfit={setProfit}
            priceOverride={priceOverride}
            onPriceOverride={setPriceOverride}
            shopProfit={shopProfit}
            errors={errors}
          />
        </Panel>
        {realCost && product && (
          <Panel title="Real cost">
            <RealCostPanel
              cost={realCost}
              grams={product.grams}
              hours={product.printHours}
            />
          </Panel>
        )}

        <Panel title="Personalised text">
          <TextSettingsPanel
            value={text}
            onChange={setText}
            groups={groups}
            errors={errors}
          />
          {text && (
            <input type="hidden" name="text" value={JSON.stringify(text)} />
          )}
        </Panel>

        <Panel title="Size">
          <SizesEditor
            measured={measured}
            onMeasured={setMeasured}
            sizes={sizes}
            onSizes={setSizes}
            grams={grams}
            printHours={hours}
            errors={errors}
          />
        </Panel>

        <Panel title="Options customers choose">
          <CopyOptions others={others} onCopy={setOptions} />
          <OptionsConfig
            groups={groups}
            value={options}
            onChange={setOptions}
          />
          {optionErrors.length > 0 && (
            <p className="text-sm text-danger">{optionErrors[0]}</p>
          )}
        </Panel>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={fetcher.state !== 'idle'}
            className="px-6 py-2.5"
          >
            {product ? 'Save product' : 'Create product'}
          </Button>
          {product && (
            <Link
              to={`/products/${product.slug}`}
              className="text-sm underline underline-offset-4"
            >
              View in the shop
            </Link>
          )}
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </div>
  );
}

/** Another product's colours, materials and other options, in one click (sizes stay this product's). */
function CopyOptions({
  others,
  onCopy,
}: {
  others: readonly { id: string; name: string }[];
  onCopy: (options: ProductOptionConfig[]) => void;
}) {
  const source = useFetcher<typeof productLoader>();
  const [from, setFrom] = useState('');
  const loaded = source.data?.product;
  if (others.length === 0) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-border pb-3">
      <SelectField
        label="Same options as"
        name="copy-options-from"
        value={from}
        onChange={(e) => {
          setFrom(e.currentTarget.value);
          if (e.currentTarget.value)
            source.load(`/admin/products/${e.currentTarget.value}`);
        }}
      >
        <option value="">Choose a product…</option>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
      <Button
        variant="secondary"
        disabled={!from || source.state !== 'idle' || loaded?.id !== from}
        onClick={() => loaded && onCopy(loaded.options)}
      >
        Copy its options
      </Button>
    </div>
  );
}
