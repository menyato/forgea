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
  shownColours,
  startingChoice,
} from '@forgea/types';
import { useCallback, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { ColoursEditor, type Filament } from './colours-editor';
import { PricePanel } from './price-panel';
import { type PrintFileRef, PrintFilesField } from './print-files-field';
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
import { ShownColours } from '~/features/admin/shown-colours';
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
  filaments,
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
  /** The filaments on the shelf a colour may be printed from. */
  filaments: readonly Filament[];
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
  const [extraCosts, setExtraCosts] = useState<
    { label: string; amount: string }[]
  >(product?.extraCosts ?? []);
  const [colours, setColoursOnly] = useState<ProductColourView[]>(
    product?.colours ?? [],
  );
  const [partGroupId, setPartGroupId] = useState(
    product?.partColourGroupId ?? '',
  );
  const [printFiles, setPrintFiles] = useState<PrintFileRef[]>(
    (product?.printFiles ?? []).map((p) => ({ key: p.fileKey, name: p.name })),
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
      <SetupSteps
        steps={[
          {
            to: '#product-model',
            label: '3D model',
            done: modelKey !== null,
            hint: 'Upload the sliced .gcode.3mf: grams, time, size, colours and material fill in by themselves.',
          },
          {
            to: '#product-details',
            label: 'Name and category',
            done: name.trim() !== '',
            hint: 'What customers read; the web address follows the name.',
          },
          {
            to: '#product-printing',
            label: 'Grams and print time',
            done: grams !== '' && hours !== '',
            hint: 'From the file, or typed in. They make the price.',
          },
          {
            to: '#product-printing',
            label: 'Each colour from a reel',
            done: colours.length === 0 || colours.every((c) => c.stockItemId),
            hint: 'Printed from: the reel its cost and stock come from. Tick the parts customers may recolour.',
          },
          {
            to: '#product-printing',
            label: 'In the shop or hidden',
            done: null,
            hint: 'Untick Visible in the shop for studio-only pieces (tests, gifts, one client).',
          },
        ]}
      />
      <div className="grid content-start gap-6">
        <Panel title="3D model" anchor="product-model">
          <ModelField
            modelKey={modelKey}
            onModelKey={setModelKey}
            material={materials.find((m) => m.id === materialId)}
            onSuggest={suggest}
            autoUse={grams === ''}
            // Read from the file: its material (by the filament type), and each colour
            // printed from the reel on the shelf closest to it. Read again, parts keep their
            // names and reels (by file colour).
            onColours={(next, type) => {
              const fileMaterial = type
                ? materials.find(
                    (m) =>
                      m.active && m.code.toUpperCase() === type.toUpperCase(),
                  )
                : undefined;
              if (fileMaterial) setMaterialId(fileMaterial.id);
              const code =
                fileMaterial?.code ??
                materials.find((m) => m.id === materialId)?.code;
              const reels = filaments
                .filter((f) => f.material === code)
                .map((f) => ({
                  label: f.colour,
                  swatchHex: f.swatchHex,
                  stockItemId: f.id,
                }));
              setColours(
                next.map((c) => {
                  const before = colours.find((o) => o.hex === c.hex);
                  const reel = before
                    ? undefined
                    : startingChoice(reels, { colour: c.colour, hex: c.hex });
                  return {
                    ...c,
                    // A colour printed from a reel takes the reel's name, as when picked.
                    colour: reel?.label ?? c.colour,
                    part: before?.part ?? null,
                    startsAs: before?.startsAs ?? null,
                    stockItemId:
                      before?.stockItemId ?? reel?.stockItemId ?? null,
                  };
                }),
              );
            }}
            name={name}
          />
          {/* What the shop shows it in first: each part in its starting colour. */}
          {colours.length > 0 && (
            <div className="mt-3 grid gap-1">
              <p className="text-sm font-medium">Shown in</p>
              <ShownColours
                colours={shownColours(
                  colours,
                  groups
                    .find((g) => g.id === partGroupId)
                    ?.values.filter((v) => v.active && v.swatchHex),
                )}
                className="text-sm"
              />
            </div>
          )}
        </Panel>
        <Panel title="Print files">
          <PrintFilesField
            files={printFiles}
            onFiles={setPrintFiles}
            material={materials.find((m) => m.id === materialId)}
            onUse={(total) => {
              setHours(total.printHours);
              // Colours keep the names customers see (by file colour).
              setColours(
                total.colours.map((c) => ({
                  colour: c.colour.startsWith('#') ? '' : c.colour,
                  hex: c.hex,
                  grams: c.grams,
                  part: colours.find((o) => o.hex === c.hex)?.part ?? null,
                  startsAs:
                    colours.find((o) => o.hex === c.hex)?.startsAs ?? null,
                  stockItemId:
                    colours.find((o) => o.hex === c.hex)?.stockItemId ?? null,
                })),
              );
            }}
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
        <input
          type="hidden"
          name="printFiles"
          value={JSON.stringify(printFiles)}
        />
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

        <Panel title="Details" anchor="product-details">
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

        <Panel title="Printing and price" anchor="product-printing">
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
            filaments={filaments}
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
            printFileKeys={printFiles.map((p) => p.key)}
            colours={colours}
            profit={profit}
            onProfit={setProfit}
            priceOverride={priceOverride}
            onPriceOverride={setPriceOverride}
            extraCosts={extraCosts}
            onExtraCosts={setExtraCosts}
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

/**
 * What a product needs, in order, each linking to its panel and ticked once it is there: the
 * new-product page reads as five steps instead of one long form.
 */
function SetupSteps({
  steps,
}: {
  steps: readonly {
    to: string;
    label: string;
    /** null: a choice, not something missing. */
    done: boolean | null;
    hint: string;
  }[];
}) {
  return (
    <nav
      aria-label="Steps"
      className="rounded-lg border border-border bg-surface p-4 xl:col-span-2"
    >
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className="grid min-w-0 content-start gap-1 text-sm"
          >
            <a
              href={s.to}
              className="flex items-center gap-2 font-semibold hover:underline"
            >
              <span
                aria-hidden
                className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${
                  s.done
                    ? 'bg-accent text-on-accent'
                    : 'border border-border text-text-muted'
                }`}
              >
                {s.done ? '✓' : i + 1}
              </span>
              {s.label}
              {s.done === false && <span className="sr-only">(to do)</span>}
              {s.done && <span className="sr-only">(done)</span>}
            </a>
            <span className="text-xs text-text-muted">{s.hint}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
