import {
  ACCENT_STYLES,
  COUPLE_JOIN,
  isArabic,
  lettersOf,
  PER_LETTER_STYLES,
  KEYCHAIN_SHAPE_LABELS,
  type KeychainShape,
  nearestColour,
  SUBTITLE_MAX_CHARS,
  SUBTITLE_STYLES,
  TEXT_DECOR_LABELS,
  TEXT_DECORS,
  type TextDecor,
} from '@forgea/text3d/design';
import type {
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
import { Busy } from '~/components/brand/busy';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { useHydrated } from '~/features/model-viewer/model-viewer';
import { OwnLogoField } from '~/features/own-logo/own-logo-field';
import {
  fontFamilyOf,
  useFontFaces,
} from '~/features/text-studio/use-font-faces';
import { useLivePrice } from './use-live-price';
import {
  TEXT_INPUT,
  QuickLooks,
  withLetter,
  Swatches,
  Loading,
} from './text-designer-parts';

// three.js and HarfBuzz are large: they load only here, and only in the browser.
const TextPreview = lazy(
  () => import('~/features/text-studio/text-preview.client'),
);

/** What the empty preview shows, by style. */
const SAMPLE: Record<ProductTextOffer['style'], string> = {
  KEYCHAIN: 'Your name',
  NAME: 'Your name',
  MONOGRAM: 'SAM',
  LETTERS: 'ABC',
  INITIAL_NAME: 'Your name',
  COUPLE: `Your name${COUPLE_JOIN}Their name`,
  // Designed freely on their own page (BoardDesigner).
  STANDING_INITIAL: 'A',
  TROPHY: '',
  STANDING_LOGO: '',
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
  // Its example names: the owner's ("Your name & Their name"), split at the "&".
  const coupleSample = (offer.sample || SAMPLE.COUPLE)
    .split('&')
    .map((n) => n.trim());
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
  // A big initial's decorations (the product's to start) and their own colour.
  const [decor, setDecor] = useState<TextDecor>(offer.decor ?? 'HEARTS');
  const [decorColour, setDecorColour] = useState<string | null>(null);
  // A line under the name: a baby's weight and birth date, a couple's date.
  const [subtitle, setSubtitle] = useState('');
  const withSubtitle = SUBTITLE_STYLES.includes(offer.style);
  // The initial's own font only while it writes what was typed.
  const initialFont =
    offer.style === 'INITIAL_NAME' && fonts.some((f) => f.id === initialFontId)
      ? initialFontId
      : undefined;
  const [letters, setLetters] = useState<
    { fontId?: string; colour?: string }[]
  >([]);
  // A keychain's plate shape and logo, among the ones the product offers.
  const [shape, setShape] = useState<KeychainShape>('OUTLINE');
  const [logoId, setLogoId] = useState('');
  // Logos the customer brought (their picture or drawing), offered beside the studio's.
  const [ownLogos, setOwnLogos] = useState<ProductTextOffer['logos']>([]);
  const shownOffer = useMemo(
    () => ({ ...offer, logos: [...offer.logos, ...ownLogos] }),
    [offer, ownLogos],
  );
  const keychain = offer.style === 'KEYCHAIN';
  // A logo in its own colours: a shop colour for each of its colours (the closest to start).
  const inks = shownOffer.logos.find((l) => l.id === logoId)?.inks ?? null;
  const [logoInColour, setLogoInColour] = useState(true);
  const [inkPicks, setInkPicks] = useState<Record<string, string[]>>({});
  const logoColours =
    keychain && inks && logoInColour
      ? inks.map(
          (ink, i) =>
            inkPicks[logoId]?.[i] ??
            nearestColour(ink.hex, offer.colours)?.id ??
            textColour,
        )
      : null;
  // Something to make: a text, or on a keychain a logo alone.
  const designed = typed !== '' || (keychain && logoId !== '');
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
    ...(offer.style === 'INITIAL_NAME' && decor !== (offer.decor ?? 'HEARTS')
      ? { decor }
      : {}),
    ...(offer.style === 'INITIAL_NAME' && decorColour ? { decorColour } : {}),
    ...(withSubtitle && subtitle.trim() ? { subtitle: subtitle.trim() } : {}),
    ...(heightMm !== offer.letterHeightMm ? { heightMm } : {}),
    ...(shape !== 'OUTLINE' ? { shape } : {}),
    ...(logoId ? { logoId } : {}),
    ...(logoColours ? { logoColours } : {}),
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
  const shown = designed
    ? design
    : { ...design, text: offer.sample || SAMPLE[offer.style], letters: [] };

  const live = useLivePrice(designJson, designed && font !== '');
  const { onMeasured, measuredJson, stale, price } = live;
  const priceError = live.error;

  const cart = useFetcher<{ ok?: boolean; error?: string }>();
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const added =
    cart.state === 'idle' && cart.data?.ok === true && addedFor === designJson;
  const blocked = !designed || !!problem || !!priceError || !font;
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
                offer={shownOffer}
                design={shown}
                label={`3D preview of ${product.name}: ${typed || (designed ? 'your logo' : 'a sample')}. Drag to turn it.`}
                onProblem={onProblem}
                onMeasured={designed ? onMeasured : undefined}
              />
            </Suspense>
          ) : (
            <Loading />
          )}
          {!designed && (
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
                    placeholder={coupleSample[i]}
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
                placeholder={offer.sample || SAMPLE[offer.style]}
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
          {withSubtitle && (
            <label className="mt-2 grid gap-1.5">
              <span className="text-sm font-medium">
                A line under the name{' '}
                <span className="font-normal text-text-muted">
                  (optional:{' '}
                  {offer.style === 'COUPLE'
                    ? 'a date, “Since 2020”'
                    : 'weight, date of birth, time'}
                  )
                </span>
              </span>
              <input
                name="design-subtitle"
                autoComplete="off"
                dir="auto"
                maxLength={SUBTITLE_MAX_CHARS}
                value={subtitle}
                onChange={(e) => setSubtitle(e.currentTarget.value)}
                placeholder={
                  offer.style === 'COUPLE'
                    ? '14 . 02 . 2026'
                    : '3.2 kg · 12/05/2026'
                }
                className="w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </label>
          )}
          <span
            id="design-problem"
            className="text-sm text-danger"
            aria-live="polite"
          >
            {designed ? (problem ?? priceError ?? '') : ''}
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

        {offer.style === 'INITIAL_NAME' && (
          <>
            <QuickLooks
              colours={offer.colours}
              onPick={(look) => {
                setDecor(look.decor);
                if (look.accent) setAccentColour(look.accent);
                if (look.letters) setTextColour(look.letters);
                setDecorColour(null);
              }}
            />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Decorations</legend>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Decorations"
              >
                {TEXT_DECORS.map((d) => (
                  <label
                    key={d}
                    className="relative cursor-pointer rounded-pill border border-border px-4 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:font-semibold"
                  >
                    <input
                      type="radio"
                      name="design-decor"
                      className="sr-only"
                      checked={decor === d}
                      onChange={() => setDecor(d)}
                    />
                    {TEXT_DECOR_LABELS[d]}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
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

        {offer.shapes.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Shape</legend>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Shape"
            >
              {(['OUTLINE', ...offer.shapes] as KeychainShape[]).map((s) => (
                <label
                  key={s}
                  className="relative cursor-pointer rounded-pill border border-border px-4 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:font-semibold"
                >
                  <input
                    type="radio"
                    name="design-shape"
                    className="sr-only"
                    checked={shape === s}
                    onChange={() => setShape(s)}
                  />
                  {KEYCHAIN_SHAPE_LABELS[s]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {(offer.logos.length > 0 || offer.ownLogo) && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Logo</legend>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Logo"
            >
              {[{ id: '', name: 'No logo' }, ...shownOffer.logos].map((l) => (
                <label
                  key={l.id || 'none'}
                  className="relative cursor-pointer rounded-pill border border-border px-4 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:checked]:font-semibold"
                >
                  <input
                    type="radio"
                    name="design-logo"
                    className="sr-only"
                    checked={logoId === l.id}
                    onChange={() => setLogoId(l.id)}
                  />
                  {l.name}
                </label>
              ))}
            </div>
            {offer.ownLogo && (
              <OwnLogoField
                onLogo={(logo) => {
                  setOwnLogos((all) =>
                    all.some((l) => l.id === logo.id)
                      ? all
                      : [
                          ...all,
                          {
                            id: logo.id,
                            name: 'Your logo',
                            outline: logo.outline,
                            inks: logo.inks,
                          },
                        ],
                  );
                  setLogoId(logo.id);
                }}
              />
            )}
            {keychain && offer.ownLogo && (
              <p className="text-sm text-text-muted">
                Your logo prints beside your name, or alone if you leave the
                name empty.
              </p>
            )}
            {keychain && inks && (
              <div className="grid gap-3 rounded-md border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="design-logo-in-colour"
                    autoComplete="off"
                    checked={logoInColour}
                    onChange={(e) => setLogoInColour(e.currentTarget.checked)}
                  />
                  Print the logo in its own colours
                </label>
                {logoColours ? (
                  inks.map((ink, i) => (
                    <Swatches
                      key={`${logoId}-${i}`}
                      small
                      legend={`Logo colour ${i + 1}`}
                      name={`design-logo-colour-${i}`}
                      colours={offer.colours}
                      value={logoColours[i] ?? null}
                      onChange={(id) =>
                        id &&
                        setInkPicks((all) => {
                          const next = [...logoColours];
                          next[i] = id;
                          return { ...all, [logoId]: next };
                        })
                      }
                      note={
                        <>
                          <span
                            aria-hidden
                            className="mr-1 inline-block h-3 w-3 rounded-full border border-border align-middle"
                            style={{ backgroundColor: ink.hex }}
                          />
                          In your logo; we start with the closest filament.
                        </>
                      }
                    />
                  ))
                ) : (
                  <p className="text-sm text-text-muted">
                    The whole logo prints in the letters' colour.
                  </p>
                )}
              </div>
            )}
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
        {offer.style === 'INITIAL_NAME' && (
          <Swatches
            legend="Decorations colour"
            name="design-decor-colour"
            colours={offer.colours}
            value={decorColour}
            onChange={setDecorColour}
            same="Same as the initial"
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
                {designed
                  ? 'Working out the price…'
                  : keychain && offer.ownLogo
                    ? 'Type your name or add your logo to see the price'
                    : 'Type your text to see the price'}
              </span>
            )}
            {price && stale && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                updating…
              </span>
            )}
          </p>
          {designed && (
            <p className="text-sm text-text-muted">
              {colourName.get(textColour)} {typed ? 'letters' : 'logo'}
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
            {!designed ? (
              keychain && offer.ownLogo ? (
                'Type your name or add your logo'
              ) : (
                'Type your text first'
              )
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
