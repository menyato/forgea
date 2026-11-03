import { CountForm } from '~/features/stock/stock-forms';
import { shelfChoices, weighSpools } from '~/features/stock/stock.server';
import { RecordPage } from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  return shelfChoices(context.get(apiContext), url);
}

export async function action({ request, context }: Route.ActionArgs) {
  return weighSpools(context.get(apiContext), await request.formData());
}

export default function WeighSpools({ loaderData }: Route.ComponentProps) {
  const { materials, colours, items, line, start } = loaderData;
  return (
    <RecordPage
      title="Weigh the spools"
      intro="What the scale says is on the shelf: the difference from what the shelf should hold is recorded as a correction."
      line={line}
    >
      <CountForm
        materials={materials}
        colours={colours}
        items={items}
        start={start}
      />
    </RecordPage>
  );
}
