import {
  BOARD_LIMITS,
  BOARD_MOTIF_LABELS,
  BOARD_MOTIFS,
  type BoardItem,
  type BoardMotif,
  isArabic,
} from '@forgea/text3d/design';
import type { ProductDetail, ProductTextOffer } from '@forgea/types';
import { CART_QUANTITY_MAX } from '@forgea/validation/constants';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { LogoOutline } from '~/features/admin-logos/logo-outline';
import { useHydrated } from '~/features/model-viewer/model-viewer';
import { OwnLogoField } from '~/features/own-logo/own-logo-field';
import { useFontFaces } from '~/features/text-studio/use-font-faces';
import { fontFor, itemId, lookFor, looksFor } from './board-looks';
import { Loading, Swatches, TEXT_INPUT } from './text-designer-parts';
import { useLivePrice } from './use-live-price';

// three.js and HarfBuzz are large: they load only here, and only in the browser.
const TextPreview = lazy(
  () => import('~/features/text-studio/text-preview.client'),
);
const BoardCanvas = lazy(
  () => import('~/features/text-studio/board-canvas.client'),
);

const SMALL_BUTTON =
  'rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm hover:border-accent disabled:opacity-50';

/**
 * A piece designed freely (a standing initial, a trophy): it starts from a ready-made look,
 * and the customer drags each thing on it (names, dates, weights, decorations, logos) where
 * they like, sizes, turns and colours it, adds and removes things, sees it flat and in 3D as
 * it will print, and the API prices it.
 */
export function BoardDesigner({
  product,
  offer,
}: {
  product: ProductDetail;
  offer: ProductTextOffer;
}) {
  useFontFaces(offer.fonts);
  const hydrated = useHydrated();
  const standing = offer.style === 'STANDING_INITIAL';
  // A logo standing: the logo it is made of (offered or the customer's own) and its colour.
  const logoStanding = offer.style === 'STANDING_LOGO';
  const [baseLogoId, setBaseLogoId] = useState(offer.logos[0]?.id ?? '');
  const [logoColour, setLogoColour] = useState(
    offer.colours.find(
      (c) => c.id !== (offer.defaultColourId ?? offer.colours[0]?.id),
    )?.id ?? '',
  );
  const looks = looksFor(offer);
  const heights = [offer.letterHeightMm, ...offer.sizesMm].sort(
    (a, b) => Number(a) - Number(b),
  );
  const [heightMm, setHeightMm] = useState(offer.letterHeightMm);
  const h = Number(heightMm);
  // Logos the customer brought, offered beside the studio's.
  const [ownLogos, setOwnLogos] = useState<ProductTextOffer['logos']>([]);
  const shownOffer = useMemo(
    () => ({ ...offer, logos: [...offer.logos, ...ownLogos] }),
    [offer, ownLogos],
  );

  // It opens dressed in the first look, so the page shows a finished piece at once.
  const [start] = useState(() =>
    looks[0]
      ? lookFor(looks[0], offer, Number(offer.letterHeightMm))
      : { initial: 'A', baseColour: offer.defaultColourId ?? '', items: [] },
  );
  const [lookLabel, setLookLabel] = useState(looks[0]?.label ?? '');
  const [initial, setInitial] = useState(start.initial);
  const [baseColour, setBaseColour] = useState(
    start.baseColour || offer.defaultColourId || offer.colours[0]?.id || '',
  );
  const [items, setItems] = useState<BoardItem[]>(start.items);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'flat' | '3d'>('flat');
  const arabic = isArabic(initial);
  const initialFonts = offer.fonts.filter((f) => (arabic ? f.arabic : f.latin));
  // A chunky letter stands best and carries what is on it.
  const [fontId, setFontId] = useState(
    () => fontFor(offer.fonts, 'bold') ?? fontFor(offer.fonts, 'plain') ?? '',
  );
  const font = initialFonts.some((f) => f.id === fontId)
    ? fontId
    : (initialFonts[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const onProblem = useCallback((p: string | null) => setProblem(p), []);

  const design = {
    text: standing ? initial.trim() : '',
    fontId: font,
    textColour: baseColour,
    ...(logoStanding && baseLogoId
      ? {
          logoId: baseLogoId,
          ...(logoColour ? { accentColour: logoColour } : {}),
        }
      : {}),
    ...(heightMm !== offer.letterHeightMm ? { heightMm } : {}),
    items,
  };
  const designJson = JSON.stringify(design);
  const designed = standing
    ? initial.trim() !== ''
    : logoStanding
      ? baseLogoId !== ''
      : true;
  const live = useLivePrice(designJson, designed && font !== '');

  const cart = useFetcher<{ ok?: boolean; error?: string }>();
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const added =
    cart.state === 'idle' && cart.data?.ok === true && addedFor === designJson;
  const blocked = !designed || !!problem || !!live.error || !font;

  const chosen = items.find((i) => i.id === selected) ?? null;
  const change = (id: string, patch: Partial<BoardItem>) =>
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const onMove = useCallback(
    (id: string, x: number, y: number) =>
      setItems((all) => all.map((i) => (i.id === id ? { ...i, x, y } : i))),
    [],
  );
  const accent =
    items.find((i) => i.colour !== baseColour)?.colour ??
    offer.colours.find((c) => c.id !== baseColour)?.id ??
    baseColour;
  const add = (
    item: Omit<BoardItem, 'id' | 'x' | 'y' | 'rotation' | 'colour'>,
  ) => {
    if (items.length >= BOARD_LIMITS.maxItems) return;
    const next: BoardItem = {
      id: itemId(),
      x: 0,
      // A little lower each time, so a new thing never hides under the last one.
      y: Math.round((0.15 - (items.length % 4) * 0.1) * h),
      rotation: 0,
      colour: accent,
      ...item,
    };
    setItems((all) => [...all, next]);
    setSelected(next.id);
    setView('flat');
  };
  const maxSize = Math.min(BOARD_LIMITS.maxSizeMm, Math.round(h * 0.8));
  const label = (i: BoardItem) =>
    i.kind === 'TEXT'
      ? i.text || 'Empty line'
      : i.kind === 'MOTIF'
        ? BOARD_MOTIF_LABELS[i.motif ?? 'HEART']
        : (shownOffer.logos.find((l) => l.id === i.logoId)?.name ?? 'Logo');

  return (
    <main
      className={`${PAGE_WIDTH} grid gap-x-12 gap-y-8 pb-10 sm:pt-8 lg:grid-cols-[minmax(0,7fr)_minmax(22rem,5fr)]`}
    >
      <div className="-mx-4 grid gap-2 sm:mx-0 lg:sticky lg:top-24 lg:self-start">
        <div
          role="tablist"
          aria-label="How to see it"
          className="flex justify-center gap-2 px-4 sm:px-0"
        >
          {(
            [
              ['flat', 'Arrange (drag)'],
              ['3d', 'See it in 3D'],
            ] as const
          ).map(([v, text]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className="rounded-pill border border-border px-4 py-1.5 text-sm aria-selected:border-accent aria-selected:bg-accent aria-selected:text-on-accent"
            >
              {text}
            </button>
          ))}
        </div>
        <div className="relative aspect-square w-full overflow-hidden bg-surface sm:rounded-lg lg:aspect-auto lg:h-[min(72dvh,48rem)]">
          {!hydrated ? (
            <Loading />
          ) : (
            <Suspense fallback={<Loading />}>
              {view === 'flat' ? (
                <BoardCanvas
                  offer={shownOffer}
                  design={design}
                  selected={selected}
                  onSelect={setSelected}
                  onMove={onMove}
                  onProblem={onProblem}
                />
              ) : (
                <TextPreview
                  offer={shownOffer}
                  design={design}
                  label={`3D preview of your ${product.name}. Drag to turn it.`}
                  onProblem={onProblem}
                  onMeasured={live.onMeasured}
                />
              )}
            </Suspense>
          )}
          {view === 'flat' && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-sm text-text-muted">
              Drag anything to move it · tap one to change it
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

        {looks.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">
              Start from a look{' '}
              <span className="font-normal text-text-muted">
                (then change anything)
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {looks.map((look) => (
                <button
                  key={look.label}
                  type="button"
                  aria-pressed={lookLabel === look.label}
                  onClick={() => {
                    const made = lookFor(look, offer, h);
                    setLookLabel(look.label);
                    if (standing) setInitial(made.initial);
                    setBaseColour(made.baseColour);
                    setItems(made.items);
                    setSelected(null);
                  }}
                  className="rounded-pill border border-border px-3 py-1.5 text-sm aria-pressed:border-accent aria-pressed:bg-accent/10"
                >
                  {look.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setLookLabel('');
                  setItems([]);
                  setSelected(null);
                }}
                className="rounded-pill border border-dashed border-border px-3 py-1.5 text-sm"
              >
                Start blank
              </button>
            </div>
          </fieldset>
        )}

        {logoStanding && (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">
              Your logo{' '}
              <span className="font-normal text-text-muted">
                (upload yours below, or pick one)
              </span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {shownOffer.logos.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  title={l.name}
                  aria-pressed={baseLogoId === l.id}
                  onClick={() => setBaseLogoId(l.id)}
                  className="grid w-20 justify-items-center gap-1 rounded-md border border-border p-1.5 text-xs aria-pressed:border-accent aria-pressed:bg-accent/10"
                >
                  <LogoOutline
                    outline={l.outline}
                    label={l.name}
                    className="h-12 w-12"
                  />
                  <span className="w-full truncate text-center">{l.name}</span>
                </button>
              ))}
            </div>
            <Swatches
              legend="The logo's colour"
              name="design-logo-colour"
              colours={offer.colours}
              value={logoColour}
              onChange={(v) => v && setLogoColour(v)}
            />
          </fieldset>
        )}

        {standing && (
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">The letter</span>
              <input
                name="design-initial"
                autoComplete="off"
                dir="auto"
                maxLength={2}
                value={initial}
                onChange={(e) =>
                  setInitial(
                    [...e.currentTarget.value.trim()].slice(-1).join(''),
                  )
                }
                aria-invalid={problem && !initial ? true : undefined}
                className={`${TEXT_INPUT} text-center`}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-medium">The letter's font</span>
              <select
                name="design-initial-font"
                autoComplete="off"
                value={font}
                onChange={(e) => setFontId(e.currentTarget.value)}
                className="rounded-md border border-border bg-surface px-3 py-2.5"
              >
                {initialFonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {heights.length > 1 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Size</legend>
            <div className="flex flex-wrap gap-2">
              {heights.map((mm) => (
                <label
                  key={mm}
                  className="cursor-pointer rounded-pill border border-border px-3 py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10"
                >
                  <input
                    type="radio"
                    name="design-height"
                    className="sr-only"
                    checked={heightMm === mm}
                    onChange={() => {
                      // Everything on it grows or shrinks with it.
                      const k = Number(mm) / h;
                      setItems((all) =>
                        all.map((i) => ({
                          ...i,
                          x: round1(i.x * k),
                          y: round1(i.y * k),
                          size: Math.min(
                            BOARD_LIMITS.maxSizeMm,
                            Math.max(
                              BOARD_LIMITS.minSizeMm,
                              round1(i.size * k),
                            ),
                          ),
                        })),
                      );
                      setHeightMm(mm);
                    }}
                  />
                  {Number(mm) / 10} cm tall
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Swatches
          legend={
            standing
              ? "The letter's colour"
              : logoStanding
                ? "The backing's colour"
                : "The plaque's colour"
          }
          name="design-base-colour"
          colours={offer.colours}
          value={baseColour}
          onChange={(v) => v && setBaseColour(v)}
          note={
            Number(offer.extraColourPrice) > 0 ? (
              <>
                Each extra colour adds <Money amount={offer.extraColourPrice} />
              </>
            ) : null
          }
        />

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">
            On it{' '}
            <span className="font-normal text-text-muted">
              ({items.length} of {BOARD_LIMITS.maxItems})
            </span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                aria-pressed={selected === i.id}
                onClick={() => {
                  setSelected(i.id);
                  setView('flat');
                }}
                className="flex max-w-full items-center gap-1.5 rounded-pill border border-border px-3 py-1 text-sm aria-pressed:border-accent aria-pressed:bg-accent/10"
              >
                <span
                  aria-hidden
                  className="h-3 w-3 shrink-0 rounded-full border border-border"
                  style={{
                    backgroundColor:
                      offer.colours.find((c) => c.id === i.colour)?.swatchHex ??
                      undefined,
                  }}
                />
                <span className="truncate">{label(i)}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={items.length >= BOARD_LIMITS.maxItems}
              onClick={() =>
                add({
                  kind: 'TEXT',
                  text: 'Your text',
                  fontId: fontFor(offer.fonts, 'plain') ?? font,
                  size: round1(h * 0.08),
                })
              }
            >
              + Text
            </button>
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={items.length >= BOARD_LIMITS.maxItems}
              onClick={() =>
                add({ kind: 'MOTIF', motif: 'HEART', size: round1(h * 0.08) })
              }
            >
              + Decoration
            </button>
            {shownOffer.logos.length > 0 && (
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={items.length >= BOARD_LIMITS.maxItems}
                onClick={() =>
                  add({
                    kind: 'LOGO',
                    logoId: shownOffer.logos[0]!.id,
                    size: round1(h * 0.25),
                  })
                }
              >
                + Logo
              </button>
            )}
          </div>
          {offer.ownLogo && (
            <OwnLogoField
              label="Add your own logo"
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
                // A logo standing is made of the logo; elsewhere it goes on the piece.
                if (logoStanding) setBaseLogoId(logo.id);
                else
                  add({
                    kind: 'LOGO',
                    logoId: logo.id,
                    size: round1(h * 0.25),
                  });
              }}
            />
          )}
        </fieldset>

        {chosen && (
          <ItemEditor
            key={chosen.id}
            item={chosen}
            offer={shownOffer}
            maxSize={maxSize}
            onChange={(patch) => change(chosen.id, patch)}
            onRemove={() => {
              setItems((all) => all.filter((i) => i.id !== chosen.id));
              setSelected(null);
            }}
            onDuplicate={() => {
              if (items.length >= BOARD_LIMITS.maxItems) return;
              const copy = {
                ...chosen,
                id: itemId(),
                x: round1(chosen.x + h * 0.05),
                y: round1(chosen.y - h * 0.05),
              };
              setItems((all) => [...all, copy]);
              setSelected(copy.id);
            }}
            onLayer={(to) =>
              setItems((all) => {
                const rest = all.filter((i) => i.id !== chosen.id);
                return to === 'front' ? [...rest, chosen] : [chosen, ...rest];
              })
            }
            onDone={() => setSelected(null)}
          />
        )}

        <div aria-live="polite" aria-busy={live.stale} className="grid gap-1">
          <p className="text-3xl font-bold">
            {live.price ? (
              <Money amount={live.price} />
            ) : (
              <span className="text-base font-normal text-text-muted">
                {designed
                  ? 'Working out the price…'
                  : logoStanding
                    ? 'Add your logo to see the price'
                    : 'Type the letter to see the price'}
              </span>
            )}
            {live.price && live.stale && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                updating…
              </span>
            )}
          </p>
          {(problem ?? live.error) && (
            <p id="design-problem" className="text-sm text-danger">
              {problem ?? live.error}
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
          {live.measuredJson && (
            <input type="hidden" name="measured" value={live.measuredJson} />
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
              logoStanding ? (
                'Add your logo first'
              ) : (
                'Type the letter first'
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

/** The thing chosen on the piece: what it is or says, its size, turn, colour and place. */
function ItemEditor({
  item,
  offer,
  maxSize,
  onChange,
  onRemove,
  onDuplicate,
  onLayer,
  onDone,
}: {
  item: BoardItem;
  offer: ProductTextOffer;
  maxSize: number;
  onChange: (patch: Partial<BoardItem>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onLayer: (to: 'front' | 'back') => void;
  onDone: () => void;
}) {
  const arabic = isArabic(item.text ?? '');
  const fonts = offer.fonts.filter((f) => (arabic ? f.arabic : f.latin));
  const nudge = (dx: number, dy: number) =>
    onChange({ x: round1(item.x + dx), y: round1(item.y + dy) });
  return (
    <section
      aria-label="The thing chosen"
      className="grid gap-4 rounded-lg border border-accent/60 bg-surface p-4"
    >
      {item.kind === 'TEXT' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Text</span>
            <input
              name="design-item-text"
              autoComplete="off"
              dir="auto"
              maxLength={BOARD_LIMITS.maxTextChars}
              value={item.text ?? ''}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => onChange({ text: e.currentTarget.value })}
              className={TEXT_INPUT}
            />
          </label>
          <label className="grid gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Font</span>
            <select
              name="design-item-font"
              autoComplete="off"
              value={fonts.some((f) => f.id === item.fontId) ? item.fontId : ''}
              onChange={(e) =>
                onChange({ fontId: e.currentTarget.value || undefined })
              }
              className="rounded-md border border-border bg-background px-3 py-2"
            >
              <option value="">As the letter</option>
              {fonts.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {item.kind === 'MOTIF' && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Decoration</legend>
          <div className="flex flex-wrap gap-2">
            {BOARD_MOTIFS.map((m: BoardMotif) => (
              <button
                key={m}
                type="button"
                aria-pressed={item.motif === m}
                onClick={() => onChange({ motif: m })}
                className="rounded-pill border border-border px-3 py-1 text-sm aria-pressed:border-accent aria-pressed:bg-accent/10"
              >
                {BOARD_MOTIF_LABELS[m]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {item.kind === 'LOGO' && (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Logo</legend>
          <div className="flex flex-wrap gap-2">
            {offer.logos.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.name}
                aria-pressed={item.logoId === l.id}
                onClick={() => onChange({ logoId: l.id })}
                className="grid w-20 justify-items-center gap-1 rounded-md border border-border p-1.5 text-xs aria-pressed:border-accent aria-pressed:bg-accent/10"
              >
                <LogoOutline
                  outline={l.outline}
                  label={l.name}
                  className="h-12 w-12"
                />
                <span className="w-full truncate text-center">{l.name}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>
            Size: <strong>{item.size} mm</strong>
          </span>
          <input
            type="range"
            name="design-item-size"
            autoComplete="off"
            min={BOARD_LIMITS.minSizeMm}
            max={Math.max(maxSize, item.size)}
            step={0.5}
            value={item.size}
            onChange={(e) => onChange({ size: Number(e.currentTarget.value) })}
            className="accent-accent"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>
            Turn: <strong>{item.rotation}°</strong>
          </span>
          <input
            type="range"
            name="design-item-turn"
            autoComplete="off"
            min={-180}
            max={180}
            step={5}
            value={item.rotation}
            onChange={(e) =>
              onChange({ rotation: Number(e.currentTarget.value) })
            }
            className="accent-accent"
          />
        </label>
      </div>

      <Swatches
        legend="Colour"
        name="design-item-colour"
        colours={offer.colours}
        value={item.colour}
        onChange={(v) => v && onChange({ colour: v })}
        small
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Move</span>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => nudge(-1, 0)}
          aria-label="Left 1 mm"
        >
          ←
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => nudge(0, 1)}
          aria-label="Up 1 mm"
        >
          ↑
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => nudge(0, -1)}
          aria-label="Down 1 mm"
        >
          ↓
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => nudge(1, 0)}
          aria-label="Right 1 mm"
        >
          →
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => onChange({ x: 0 })}
        >
          Centre across
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => onChange({ rotation: 0 })}
        >
          Straighten
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => onLayer('front')}
        >
          Bring to front
        </button>
        <button
          type="button"
          className={SMALL_BUTTON}
          onClick={() => onLayer('back')}
        >
          Send to back
        </button>
        <button type="button" className={SMALL_BUTTON} onClick={onDuplicate}>
          Duplicate
        </button>
        <button
          type="button"
          className={`${SMALL_BUTTON} text-danger`}
          onClick={onRemove}
        >
          Remove
        </button>
        <button
          type="button"
          className={`${SMALL_BUTTON} ml-auto`}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </section>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
