import { relayPrintFile } from '~/features/orders/print-file.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** An order line's model with its text and logos as ordered, as one 3MF project. */
export function loader({ params, context }: Route.LoaderArgs) {
  const path = [params.id, 'items', params.itemId, 'slots-project']
    .map(encodeURIComponent)
    .join('/');
  return relayPrintFile(context.get(apiContext), `/orders/${path}`);
}
