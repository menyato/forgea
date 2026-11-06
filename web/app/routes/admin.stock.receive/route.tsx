import { ReceiveForm } from '~/features/stock/stock-forms';
import { receiveSpools, shelfChoices } from '~/features/stock/stock.server';
import { RecordPage } from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  return shelfChoices(context.get(apiContext), url);
}

export async function action({ request, context }: Route.ActionArgs) {
  return receiveSpools(context.get(apiContext), await request.formData());
}

export default function ReceiveSpools({ loaderData }: Route.ComponentProps) {
  const { materials, colours, canBook, line, start } = loaderData;
  return (
    <RecordPage
      title="Spools received"
      intro="Spools that came in, with their price: grams go on the shelf, the price becomes the material's cost per gram, and paid spools are booked in the accounts."
      line={line}
    >
      <ReceiveForm
        requestKey={loaderData.requestKey}
        materials={materials}
        colours={colours}
        canBook={canBook}
        start={start}
      />
    </RecordPage>
  );
}
