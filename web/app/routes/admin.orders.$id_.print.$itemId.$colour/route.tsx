import { relayPrintFile } from '~/features/orders/print-file.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** One colour of a personalised piece as an STL. */
export function loader({ params, context }: Route.LoaderArgs) {
  const path = [params.id, 'items', params.itemId, 'print', params.colour]
    .map(encodeURIComponent)
    .join('/');
  return relayPrintFile(context.get(apiContext), `/orders/${path}`);
}
