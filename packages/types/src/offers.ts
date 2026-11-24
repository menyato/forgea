/** A free offer as the dashboard sees it (GET /offers, /offers/:id). */
export interface FreeOfferView {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  title: string;
  description: string | null;
  /** ISO times (UTC); pages show them in the studio's time. */
  startsAt: string;
  endsAt: string;
  /** At most this many in all; null: no limit. */
  maxClaims: number | null;
  /** Claimed so far (orders not cancelled). */
  claimed: number;
  active: boolean;
}

/** The offer running now, for the shop's banner and the product page (GET /offers/current). */
export interface CurrentFreeOffer {
  id: string;
  title: string;
  description: string | null;
  endsAt: string;
  /** How many are left; null without a limit. */
  left: number | null;
  product: { id: string; slug: string; name: string };
}
