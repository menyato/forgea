import { relayPrintFile } from '~/features/orders/print-file.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** One of the sliced print files of an order line's product, as it was uploaded. */
export function loader({ params, context }: Route.LoaderArgs) {
  const path = [params.id, 'items', params.itemId, 'print-files', params.fileId]
    .map(encodeURIComponent)
    .join('/');
  return relayPrintFile(context.get(apiContext), `/orders/${path}`);
}
