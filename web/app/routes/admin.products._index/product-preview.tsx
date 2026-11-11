import type { AdminProductListItem } from '@forgea/types';
import { useState } from 'react';
import { ModelThumbnail } from '~/features/model-viewer/model-thumbnail';

/** Grey for products whose options have no colour swatch (as in the shop). */
const NEUTRAL = '#9a9ea3';

/**
 * A product's 3D model in the dashboard's list and kanban, as the shop's cards show it: on its
 * print plate, in its file's colours (or its first colour), turning while pointed at. A
 * product without a model shows its material.
 */
export function ProductPreview({
  product,
  className = '',
}: {
  product: AdminProductListItem;
  className?: string;
}) {
  const [active, setActive] = useState(false);
  const tile = (
    <span
      aria-hidden="true"
      className="grid h-full place-items-center text-xs font-semibold text-text-muted"
    >
      {product.material}
    </span>
  );
  return (
    <span
      className={`block overflow-hidden rounded-md bg-surface ${className}`}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
    >
      {product.modelKey ? (
        <ModelThumbnail
          modelKey={product.modelKey}
          color={product.previewColor ?? NEUTRAL}
          turning={active}
          fallback={tile}
        />
      ) : (
        tile
      )}
    </span>
  );
}
