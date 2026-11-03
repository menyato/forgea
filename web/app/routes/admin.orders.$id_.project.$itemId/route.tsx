import { relayPrintFile } from '~/features/orders/print-file.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** Every colour of a personalised piece as one 3MF project: one object, a part per colour. */
export function loader({ params, context }: Route.LoaderArgs) {
  const path = [params.id, 'items', params.itemId, 'project']
    .map(encodeURIComponent)
    .join('/');
  return relayPrintFile(context.get(apiContext), `/orders/${path}`);
}
