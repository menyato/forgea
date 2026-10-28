import { useFetcher } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { Button } from '~/components/ui/button';

/** Adds one unit without leaving the page; the header's cart count updates when the cart reloads. */
export function AddToCart({
  productId,
  name,
}: {
  productId: string;
  name: string;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const busy = fetcher.state !== 'idle';
  const added =
    fetcher.state === 'idle' &&
    fetcher.data !== undefined &&
    !fetcher.data.error;

  return (
    <fetcher.Form method="post" action="/cart" className="grid gap-1">
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="productId" value={productId} />
      <Button type="submit" disabled={busy} aria-label={`Add ${name} to cart`}>
        {busy ? (
          <Busy label="Adding…" />
        ) : added ? (
          'Added — add another'
        ) : (
          'Add to cart'
        )}
      </Button>
      {fetcher.data?.error && (
        <p className="text-sm text-danger">{fetcher.data.error}</p>
      )}
    </fetcher.Form>
  );
}
