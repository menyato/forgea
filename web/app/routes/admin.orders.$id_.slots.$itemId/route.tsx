import { relayPrintFile } from '~/features/orders/print-file.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** An order line ready to print: its print project with the text and logos as ordered (one 3MF). */
export function loader({ params, context }: Route.LoaderArgs) {
  const path = [params.id, 'items', params.itemId, 'slots-project']
    .map(encodeURIComponent)
    .join('/');
  return relayPrintFile(context.get(apiContext), `/orders/${path}`);
}
