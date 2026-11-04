import {
  ACCENT_STYLES,
  COUPLE_JOIN,
  isArabic,
  lettersOf,
  PER_LETTER_STYLES,
} from '@forgea/text3d/design';
import type {
  DesignMeasurement,
  ProductDetail,
  ProductTextOffer,
  TextDesignInput,
} from '@forgea/types';
import { CART_QUANTITY_MAX } from '@forgea/validation/constants';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link, useFetcher } from 'react-router';
import { PrintingLogo } from '~/components/brand/printing-logo';
import { Busy } from '~/components/brand/busy';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { useHydrated } from '~/features/model-viewer/model-viewer';
import {
  fontFamilyOf,
  useFontFaces,
} from '~/features/text-studio/use-font-faces';

// three.js and HarfBuzz are large: they load only here, and only in the browser.
const TextPreview = lazy(
  () => import('~/features/text-studio/text-preview.client'),
);

/** What the empty preview shows, by style. */
const SAMPLE: Record<ProductTextOffer['style'], string> = {
  KEYCHAIN: 'Sara',
  NAME: 'Sara',
  MONOGRAM: 'SAM',
  LETTERS: 'ABC',
  INITIAL_NAME: 'Lina',
  COUPLE: `Sara${COUPLE_JOIN}Ali`,
};

/** What the accent colour paints, by style. */
const ACCENT_LEGEND: Partial<Record<ProductTextOffer['style'], string>> = {
  INITIAL_NAME: 'Initial and decorations colour',
  COUPLE: 'Heart colour',
};

/**
 * A personalised product's page: the customer types their text (Arabic or English), picks
 * fonts and colours, sees the piece in 3D as it will be printed, and the API prices it.
 */
export function TextDesigner({
  product,
  offer,
}: {
  product: ProductDetail;
  offer: ProductTextOffer;
}) {
  useFontFaces(offer.fonts);
  const hydrated = useHydrated();
  const perLetter = PER_LETTER_STYLES.includes(offer.style);
  const couple = offer.style === 'COUPLE';
  const [text, setText] = useState('');
  // A couple's two names, sent as one text joined by "&".
  const [names, setNames] = useState(['', '']);
  const typed = couple
    ? names.some((n) => n.trim())
      ? names.map((n) => n.trim()).join(COUPLE_JOIN)
      : ''
    : text.trim();
  const arabic = isArabic(typed);
  // Only fonts that write what was typed.
  const fonts = offer.fonts.filter((f) => (arabic ? f.arabic : f.latin));
  const [fontId, setFontId] = useState(
    offer.fonts.find((f) => f.latin)?.id ?? '',
  );
  const font = fonts.some((f) => f.id === fontId)
    ? fontId
    : (fonts[0]?.id ?? '');
  // The product's starting colours (ours: copper letters on black, unless the owner changed them).
  const [textColour, setTextColour] = useState(
    offer.defaultColourId ?? offer.colours[0]?.id ?? '',
  );
  const [baseColour, setBaseColour] = useState<string | null>(
    offer.defaultBaseColourId,
  );
  const heights = [offer.letterHeightMm, ...offer.sizesMm].sort(
    (a, b) => Number(a) - Number(b),
  );
  const [heightMm, setHeightMm] = useState(offer.letterHeightMm);
  const accented = ACCENT_STYLES.includes(offer.style);
  const [accentColour, setAccentColour] = useState<string | null>(
    offer.defaultAccentColourId,
  );
  const [initialFontId, setInitialFontId] = useState('');
  // The initial's own font only while it writes what was typed.
  const initialFont =
    offer.style === 'INITIAL_NAME' && fonts.some((f) => f.id === initialFontId)
      ? initialFontId
      : undefined;
  const [letters, setLetters] = useState<
    { fontId?: string; colour?: string }[]
  >([]);
  const [quantity, setQuantity] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const onProblem = useCallback((p: string | null) => setProblem(p), []);

  const chars = lettersOf(typed);
  const design: TextDesignInput = {
    text: typed,
    fontId: font,
    textColour,
    ...(baseColour ? { baseColour } : {}),
    ...(accented && accentColour ? { accentColour } : {}),
    ...(initialFont ? { accentFontId: initialFont } : {}),
    ...(heightMm !== offer.letterHeightMm ? { heightMm } : {}),
    ...(perLetter
      ? {
          letters: chars.map((_, i) => {
            const l = letters[i] ?? {};
            // A letter's own font only if it writes that letter's script.
            const own =
              l.fontId && fonts.some((f) => f.id === l.fontId)
                ? l.fontId
                : undefined;
            return {
              ...(own ? { fontId: own } : {}),
              ...(l.colour ? { colour: l.colour } : {}),
            };
          }),
        }
      : {}),
  };
  const designJson = JSON.stringify(design);
  const shown = typed
    ? design
    : { ...design, text: SAMPLE[offer.style], letters: [] };

  // What the preview built (in this browser), for the design it was built from.
  const [measured, setMeasured] = useState<{
    design: string;
    json: string;
  } | null>(null);
  const onMeasured = useCallback(
    (design: string, m: DesignMeasurement) =>
      setMeasured({ design, json: JSON.stringify(m) }),
    [],
  );
  const measuredJson = measured?.design === designJson ? measured.json : null;

  // The price, from the API, a moment after the design settles: priced from what the
  // browser built, so the server does no geometry while the customer types. If the preview
  // can't build it (no WebGL, an old browser), the API builds it after a short wait.
  const pricing = useFetcher<{ unitPrice?: string; error?: string }>();
  const { submit: requestPrice } = pricing;
  // The design the latest answer is for: until the current one is priced, it shows as updating.
  const [pricedFor, setPricedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!typed || !font) return;
    const timer = setTimeout(
      () => {
        setPricedFor(designJson);
        void requestPrice(
          {
            options: '[]',
            design: designJson,
            ...(measuredJson ? { measured: measuredJson } : {}),
          },
          { method: 'post' },
        );
      },
      measuredJson ? 250 : 2500,
    );
    return () => clearTimeout(timer);
  }, [requestPrice, designJson, measuredJson, typed, font]);
  const stale = pricedFor !== designJson || pricing.state !== 'idle';
  const price =
    typed && pricing.data?.unitPrice ? pricing.data.unitPrice : null;
  // A refusal counts only for the design on screen (the next change may fix it).
  const priceError = typed && !stale ? pricing.data?.error : undefined;

  const cart = useFetcher<{ ok?: boolean; error?: string }>();
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const added =
    cart.state === 'idle' && cart.data?.ok === true && addedFor === designJson;
  const blocked = !typed || !!problem || !!priceError || !font;
  const colourName = useMemo(
    () => new Map(offer.colours.map((c) => [c.id, c.label])),
    [offer.colours],
  );

  return (
    <main
      className={`${PAGE_WIDTH} grid gap-x-12 gap-y-8 pb-10 sm:pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,5fr)]`}
    >
      <div className="-mx-4 sm:mx-0 lg:sticky lg:top-24 lg:self-start">
        <div className="relative aspect-square w-full overflow-hidden bg-surface sm:rounded-lg lg:aspect-auto lg:h-[min(78dvh,52rem)]">
          {hydrated ? (
            <Suspense fallback={<Loading />}>
              <TextPreview
                offer={offer}
                design={shown}
                label={`3D preview of ${product.name}: ${typed || 'a sample'}. Drag to turn it.`}
                onProblem={onProblem}
                onMeasured={typed ? onMeasured : undefined}
              />
            </Suspense>
          ) : (
            <Loading />
          )}
          {!typed && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-text-muted">
              A sample: type yours to see it
            </p>
          )}
        </div>
      </div>

      <div className="grid content-start gap-6 lg:py-4">
        <nav aria-label="Breadcrumb" className="text-sm text-text-muted">
          <Link to="/shop" className="hover:underline">
            Shop
          </Link>
          {product.category && (
            <>
              {' / '}
              <Link
                to={`/shop?category=${product.category.slug}`}
                className="hover:underline"
              >
                {product.category.name}
              </Link>
            </>
          )}
        </nav>
        <header className="grid gap-2">
          <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight text-balance">
            {product.name}
          </h1>
          <p className="max-w-[60ch] text-lg text-text-muted">
            {product.description}
          </p>
        </header>

        <div className="grid gap-1.5">
          {couple ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {(['First name', 'Second name'] as const).map((label, i) => (
                <label key={label} className="grid gap-1.5">
                  <span className="text-sm font-medium">
                    {label}{' '}
                    <span className="font-normal text-text-muted">
                      (up to {offer.maxChars})
                    </span>
                  </span>
                  <input
                    name={`design-name-${i + 1}`}
                    autoComplete="off"
                    dir="auto"
                    maxLength={offer.maxChars + 4}
                    value={names[i]}
                    onChange={(e) => {
                      const v = e.currentTarget.value.replaceAll('&', '');
                      setNames((all) => all.map((n, j) => (j === i ? v : n)));
                    }}
                    placeholder={i === 0 ? 'Sara' : 'Ali'}
                    aria-invalid={problem && typed ? true : undefined}
                    aria-describedby="design-problem"
                    className={TEXT_INPUT}
                  />
                </label>
              ))}
              <p className="text-sm text-text-muted sm:col-span-2">
                Arabic or English, both names in the same.
              </p>
            </div>
          ) : (
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">
                {offer.style === 'MONOGRAM'
                  ? 'Your initials'
                  : offer.style === 'INITIAL_NAME'
                    ? 'The name'
                    : 'Your text'}{' '}
                <span className="font-normal text-text-muted">
                  (Arabic or English, up to {offer.maxChars})
                </span>
              </span>
              <input
                name="design-text"
                autoComplete="off"
                dir="auto"
                maxLength={offer.maxChars + 4}
                value={text}
                onChange={(e) => setText(e.currentTarget.value)}
                placeholder={SAMPLE[offer.style]}
                aria-invalid={problem && typed ? true : undefined}
                aria-describedby="design-problem"
                className={TEXT_INPUT}
              />
            </label>
          )}
          {offer.style === 'INITIAL_NAME' && (
            <span className="text-sm text-text-muted">
              Its first letter is the big initial.
            </span>
          )}
          <span
            id="design-problem"
            className="text-sm text-danger"
            aria-live="polite"
          >
            {typed ? (problem ?? priceError ?? '') : ''}
          </span>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">
            Font{' '}
            {perLetter && (
              <span className="font-normal text-text-muted">
                (for every letter, unless one has its own)
              </span>
            )}
          </legend>
          {fonts.length === 0 ? (
            <p className="text-sm text-text-muted">No font writes this yet.</p>
          ) : (
            <div
              className="grid grid-cols-2 gap-2"
              role="radiogroup"
              aria-label="Font"
            >
              {fonts.map((f) => (
                <label
                  key={f.id}
                  className="relative flex min-w-0 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent/10"
                >
                  <input
                    type="radio"
                    name="design-font"
                    className="sr-only"
                    checked={font === f.id}
                    onChange={() => setFontId(f.id)}
                  />
                  <span
                    className="min-w-0 truncate text-lg"
                    style={{
                      fontFamily: `'${fontFamilyOf(f.id)}', sans-serif`,
                    }}
                  >
                    {typed && [...typed].length <= 14 ? typed : f.name}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-text-muted">
                    {f.name}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {offer.style === 'INITIAL_NAME' && fonts.length > 1 && (
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium">Font for the big initial</span>
            <select
              name="design-initial-font"
              autoComplete="off"
              value={initialFont ?? ''}
              onChange={(e) => setInitialFontId(e.currentTarget.value)}
              className="rounded-md border border-border bg-surface px-2 py-2"
            >
              <option value="">Same as the name</option>
              {fonts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {heights.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">
              Size{' '}
              <span className="font-normal text-text-muted">
                {offer.style === 'INITIAL_NAME'
                  ? '(how tall the initial is)'
                  : '(how tall the letters are)'}
              </span>
            </legend>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Size"
            >
              {heights.map((h) => (
                <label
                  key={h}
                  className="relative cursor-pointer rounded-pill border border-border px-4 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:font-semibold"
                >
                  <input
                    type="radio"
                    name="design-size"
                    className="sr-only"
                    checked={heightMm === h}
                    onChange={() => setHeightMm(h)}
                  />
                  {Number(h)} mm{' '}
                  {offer.style === 'INITIAL_NAME' ? 'initial' : 'letters'}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Swatches
          legend="Letters colour"
          name="design-text-colour"
          colours={offer.colours}
          value={textColour}
          // The letters always have a colour: "none" isn't offered here.
          onChange={(v) => v && setTextColour(v)}
        />
        {accented && (
          <Swatches
            legend={ACCENT_LEGEND[offer.style] ?? 'Accent colour'}
            name="design-accent-colour"
            colours={offer.colours}
            value={accentColour}
            onChange={setAccentColour}
            same="Same as the letters"
          />
        )}
        <Swatches
          legend="Backing colour"
          name="design-base-colour"
          colours={offer.colours}
          value={baseColour}
          onChange={setBaseColour}
          same="Same as the letters"
          note={
            Number(offer.extraColourPrice) > 0 ? (
              <>
                Each extra colour adds <Money amount={offer.extraColourPrice} />
              </>
            ) : null
          }
        />

        {perLetter && chars.length > 0 && (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Each letter</legend>
            {chars.map((c, i) => (
              <div
                key={`${i}-${c}`}
                className="grid gap-2 rounded-md border border-border p-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="w-10 text-center text-2xl"
                    style={{
                      fontFamily: `'${fontFamilyOf(design.letters?.[i]?.fontId ?? font)}', sans-serif`,
                    }}
                  >
                    {c}
                  </span>
                  <label className="grid min-w-0 flex-1 gap-1 text-sm">
                    <span>Font for {c}</span>
                    <select
                      name={`design-letter-${i}-font`}
                      autoComplete="off"
                      value={design.letters?.[i]?.fontId ?? ''}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setLetters((all) =>
                          withLetter(all, i, { fontId: v || undefined }),
                        );
                      }}
                      className="rounded-md border border-border bg-surface px-2 py-1.5"
                    >
                      <option value="">As above</option>
                      {fonts.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Swatches
                  legend={`Colour for ${c}`}
                  name={`design-letter-${i}-colour`}
                  colours={offer.colours}
                  value={design.letters?.[i]?.colour ?? null}
                  onChange={(v) =>
                    setLetters((all) =>
                      withLetter(all, i, { colour: v ?? undefined }),
                    )
                  }
                  same="As above"
                  small
                />
              </div>
            ))}
          </fieldset>
        )}

        <div
          aria-live="polite"
          aria-busy={typed !== '' && stale}
          className="grid gap-1"
        >
          <p className="text-3xl font-bold">
            {price ? (
              <Money amount={price} />
            ) : (
              <span className="text-base font-normal text-text-muted">
                {typed
                  ? 'Working out the price…'
                  : 'Type your text to see the price'}
              </span>
            )}
            {price && stale && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                updating…
              </span>
            )}
          </p>
          {typed && (
            <p className="text-sm text-text-muted">
              {colourName.get(textColour)} letters
              {accented && accentColour
                ? `, ${colourName.get(accentColour)} ${couple ? 'heart' : 'initial'}`
                : ''}
              {baseColour ? ` on ${colourName.get(baseColour)}` : ''}
            </p>
          )}
        </div>

        <cart.Form
          method="post"
          action="/cart"
          className="flex flex-wrap items-end gap-3"
          onSubmit={() => setAddedFor(designJson)}
        >
          <input type="hidden" name="intent" value="add" />
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="options" value="[]" />
          <input type="hidden" name="design" value={designJson} />
          {measuredJson && (
            <input type="hidden" name="measured" value={measuredJson} />
          )}
          <label className="grid gap-1 text-sm">
            <span>Quantity</span>
            <input
              type="number"
              name="quantity"
              autoComplete="off"
              min={1}
              max={CART_QUANTITY_MAX}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.currentTarget.value) || 1)}
              className="w-20 rounded-md border border-border bg-surface px-2 py-2"
            />
          </label>
          <Button
            type="submit"
            disabled={blocked || cart.state !== 'idle'}
            className="flex-1 py-2.5 text-base"
          >
            {!typed ? (
              'Type your text first'
            ) : cart.state !== 'idle' ? (
              <Busy label="Adding…" />
            ) : added ? (
              'Added — add another'
            ) : (
              'Add to cart'
            )}
          </Button>
        </cart.Form>
        {cart.data?.error && (
          <p className="text-sm text-danger">{cart.data.error}</p>
        )}
        {added && (
          <p className="text-sm">
            In your cart.{' '}
            <Link to="/cart" className={buttonClass('quiet')}>
              View cart
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}

const TEXT_INPUT =
  'w-full rounded-md border border-border bg-surface px-3 py-2.5 text-xl text-text aria-[invalid=true]:border-danger';

function withLetter(
  all: { fontId?: string; colour?: string }[],
  i: number,
  patch: { fontId?: string | undefined; colour?: string | undefined },
) {
  const next = [...all];
  while (next.length <= i) next.push({});
  const merged: { fontId?: string; colour?: string } = { ...next[i] };
  if ('fontId' in patch) {
    if (patch.fontId) merged.fontId = patch.fontId;
    else delete merged.fontId;
  }
  if ('colour' in patch) {
    if (patch.colour) merged.colour = patch.colour;
    else delete merged.colour;
  }
  next[i] = merged;
  return next;
}

/** Colour swatches as a radio group; `same` adds "no colour of its own". */
function Swatches({
  legend,
  name,
  colours,
  value,
  onChange,
  same,
  note,
  small = false,
}: {
  legend: string;
  name: string;
  colours: ProductTextOffer['colours'];
  value: string | null;
  onChange: (id: string | null) => void;
  same?: string;
  note?: React.ReactNode;
  small?: boolean;
}) {
  const size = small ? 'h-6 w-6' : 'h-8 w-8';
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">
        {legend}
        {value && (
          <span className="font-normal text-text-muted">
            : {colours.find((c) => c.id === value)?.label}
          </span>
        )}
      </legend>
      <div
        className="flex flex-wrap items-center gap-2"
        role="radiogroup"
        aria-label={legend}
      >
        {same && (
          <label className="relative cursor-pointer rounded-pill border border-border px-3 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10">
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === null}
              onChange={() => onChange(null)}
            />
            {same}
          </label>
        )}
        {colours.map((c) => (
          <label
            key={c.id}
            title={c.label}
            className={`${size} relative cursor-pointer rounded-full border-2 border-border has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring`}
            style={{ backgroundColor: c.swatchHex ?? undefined }}
          >
            <input
              type="radio"
              name={name}
              className="sr-only"
              checked={value === c.id}
              onChange={() => onChange(c.id)}
              aria-label={c.label}
            />
          </label>
        ))}
      </div>
      {note && <p className="text-xs text-text-muted">{note}</p>}
    </fieldset>
  );
}

function Loading() {
  return (
    <div className="grid h-full place-content-center justify-items-center gap-3 text-sm text-text-muted">
      <PrintingLogo mode="loop" className="w-14" />
      Loading the 3D studio…
    </div>
  );
}
