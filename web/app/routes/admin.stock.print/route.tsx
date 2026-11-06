import {
  StudioPrintForm,
  startingPrintable,
} from '~/features/stock/stock-forms';
import { printChoices, studioPrint } from '~/features/stock/stock.server';
import { RecordPage } from '~/features/stock/stock-ui';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  return printChoices(context.get(apiContext), url);
}

export async function action({ request, context }: Route.ActionArgs) {
  return studioPrint(context.get(apiContext), await request.formData(), false);
}

export default function StudioPrint({ loaderData }: Route.ComponentProps) {
  const { printables, line } = loaderData;
  return (
    <RecordPage
      title="Printed for the studio"
      intro="Pieces the studio printed for itself (samples, displays, gifts): the product's filament comes off the shelf, costed with machine time."
      line={line}
    >
      <StudioPrintForm
        requestKey={loaderData.requestKey}
        failed={false}
        printables={printables}
        start={startingPrintable(printables, line)}
      />
    </RecordPage>
  );
}
