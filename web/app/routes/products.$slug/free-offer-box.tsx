import type { CurrentFreeOffer } from '@forgea/types';
import { Link, useFetcher } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { useTimeLeft } from '~/components/layout/offer-banner';
import { Button, buttonClass } from '~/components/ui/button';
import { studioDateTime } from '~/lib/studio-time';

/**
 * On the page of the piece a free offer gives: what it is, how long and how many are left,
 * and "Claim it free": one piece, as designed on the page, in the cart at no charge.
 */
export function FreeOfferBox({
  offer,
  productId,
  optionsJson,
  slotsJson,
  disabled,
}: {
  offer: CurrentFreeOffer;
  productId: string;
  /** The page's choices, as its own Add to cart sends them. */
  optionsJson: string;
  slotsJson: string;
  disabled: boolean;
}) {
  const claim = useFetcher<{ ok?: boolean; error?: string }>();
  const left = useTimeLeft(offer.endsAt);
  if (left === 'over') return null;
  const claimed = claim.state === 'idle' && claim.data?.ok === true;
  return (
    <section
      aria-labelledby="free-offer"
      className="grid gap-2 rounded-lg border-2 border-accent bg-accent/10 p-4"
    >
      <h2 id="free-offer" className="font-display text-lg font-bold">
        {offer.title}: free for a limited time
      </h2>
      {offer.description && <p className="text-sm">{offer.description}</p>}
      <p className="text-sm text-text-muted">
        {left ? `${left} left` : `Until ${studioDateTime(offer.endsAt)}`}
        {offer.left !== null &&
          ` · ${offer.left === 1 ? 'the last one' : `${offer.left} to give`}`}
        {' · one per customer, with an account'}
      </p>
      <claim.Form method="post" action="/cart">
        <input type="hidden" name="intent" value="add" />
        <input type="hidden" name="productId" value={productId} />
        <input type="hidden" name="options" value={optionsJson} />
        <input type="hidden" name="slots" value={slotsJson} />
        <input type="hidden" name="quantity" value="1" />
        <input type="hidden" name="freeOfferId" value={offer.id} />
        <Button
          type="submit"
          disabled={disabled || claim.state !== 'idle'}
          className="w-full py-2.5 text-base"
        >
          {claim.state !== 'idle' ? (
            <Busy label="Claiming…" />
          ) : claimed ? (
            'Claimed: it is in your cart'
          ) : (
            'Claim it free'
          )}
        </Button>
      </claim.Form>
      {claim.data?.error && (
        <p className="text-sm text-danger">{claim.data.error}</p>
      )}
      {claimed && (
        <Link to="/cart" className={buttonClass('quiet', 'justify-self-start')}>
          View cart
        </Link>
      )}
    </section>
  );
}
