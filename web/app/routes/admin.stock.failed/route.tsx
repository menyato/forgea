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
  return studioPrint(context.get(apiContext), await request.formData(), true);
}

export default function FailedPrint({ loaderData }: Route.ComponentProps) {
  const { printables, line } = loaderData;
  return (
    <RecordPage
      title="Failed print"
      intro="A print that failed: the filament it used, as far as it got, is lost."
      line={line}
    >
      <StudioPrintForm
        requestKey={loaderData.requestKey}
        failed={true}
        printables={printables}
        start={startingPrintable(printables, line)}
      />
    </RecordPage>
  );
}
