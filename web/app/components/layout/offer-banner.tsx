import type { CurrentFreeOffer } from '@forgea/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { studioDateTime } from '~/lib/studio-time';

/**
 * The free offer running now, across the top of the shop: what it is, how long is left (the
 * time ticks down in the browser), how many are left, and a link to claim it on its page.
 */
export function OfferBanner({ offer }: { offer: CurrentFreeOffer }) {
  const left = useTimeLeft(offer.endsAt);
  if (left === 'over') return null;
  return (
    <aside aria-label="Free offer" className="bg-accent text-on-accent">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2 text-center text-sm">
        <p>
          <strong className="font-semibold">{offer.title}</strong>
          {' · '}
          <span>
            free for a limited time
            {left
              ? `: ${left} left`
              : `, until ${studioDateTime(offer.endsAt)}`}
          </span>
          {offer.left !== null && (
            <span>
              {' · '}
              {offer.left === 1 ? 'the last one' : `${offer.left} to give`}
            </span>
          )}
        </p>
        <Link
          to={`/products/${offer.product.slug}?offer=${offer.id}`}
          className="rounded-pill bg-background px-3 py-1 font-semibold text-text underline-offset-2 hover:underline"
        >
          Claim yours
        </Link>
      </div>
    </aside>
  );
}

/**
 * "2 days 4 h", "3 h 12 min", "8 min" until `iso`, once the page runs in the browser (the server
 * page shows the end date instead); "over" once it passed. Updated every minute.
 */
export function useTimeLeft(iso: string): string | null | 'over' {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'over';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes % 60} min`;
  return `${Math.max(1, minutes)} min`;
}
