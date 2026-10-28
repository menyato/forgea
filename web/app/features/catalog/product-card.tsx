import { CurrencyConverter } from '@forgea/pricing';
import type { CurrencyQuote, ProductListItem } from '@forgea/types';
import { useState } from 'react';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { AddToCart } from '~/features/cart/add-to-cart';
import { ModelThumbnail } from '~/features/model-viewer/model-thumbnail';

/** Grey for products whose options have no colour swatch. */
const NEUTRAL = '#9a9ea3';

/**
 * One catalog tile: the product's real 3D model on its print plate (it turns while the card
 * is hovered or focused), then name, price and the next step.
 */
export function ProductCard({
  product,
  lbp,
}: {
  product: ProductListItem;
  lbp: CurrencyQuote | null | undefined;
}) {
  const [active, setActive] = useState(false);
  const lbpPrice = lbp
    ? new CurrencyConverter(lbp, lbp.rate).convert(product.price)
    : null;
  const materialTile = (
    <div className="grid h-full place-items-center font-display text-4xl font-bold text-text-muted">
      {product.material.code}
    </div>
  );
  return (
    <article
      className="group relative flex h-full flex-col gap-3"
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <div className="aspect-[4/3] overflow-hidden rounded-lg bg-surface transition-colors group-hover:bg-surface-raised">
        {product.modelKey ? (
          <ModelThumbnail
            modelKey={product.modelKey}
            color={product.previewColor ?? NEUTRAL}
            turning={active}
            fallback={materialTile}
          />
        ) : (
          materialTile
        )}
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="font-display text-xl font-bold leading-tight">
            <Link
              to={`/products/${product.slug}`}
              className="rounded-sm after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-focus-ring group-hover:underline"
            >
              {product.name}
            </Link>
          </h2>
          {product.category && (
            <p className="text-sm text-text-muted">{product.category.name}</p>
          )}
        </div>
        <p className="shrink-0 text-right">
          <span className="block text-lg font-semibold">
            {product.hasOptions && (
              <span className="text-sm font-normal text-text-muted">from </span>
            )}
            <Money amount={product.price} />
          </span>
          {lbp && lbpPrice && (
            <span className="block text-xs text-text-muted">
              ≈ <Money amount={lbpPrice} currency={lbp} />
            </span>
          )}
        </p>
      </div>
      <p className="line-clamp-2 text-sm text-text-muted">
        {product.description}
      </p>
      {/* Above the card-wide link, so it stays clickable. */}
      <div className="relative mt-auto">
        {product.hasOptions ? (
          <Link
            to={`/products/${product.slug}`}
            className={buttonClass('secondary', 'w-full')}
            aria-label={`Choose options for ${product.name}`}
          >
            Choose options
          </Link>
        ) : (
          <AddToCart productId={product.id} name={product.name} />
        )}
      </div>
    </article>
  );
}
