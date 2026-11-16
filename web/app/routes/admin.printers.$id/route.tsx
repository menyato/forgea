import type { PrinterView } from '@forgea/types';
import { SavePrinterDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { saveNew } from '~/features/admin/staff.server';
import { PrinterForm } from '~/features/production/printer-form';
import { printerValues } from '~/features/production/printer-values.server';
import { apiContext } from '~/lib/request.server';
import { DeleteRecord } from '~/features/admin/delete-record';
import { Money } from '~/components/money';
import { SmartButtons } from '~/features/admin/smart-buttons';
import { printerJobs } from '~/features/production/links';
import type { Route } from './+types/route';

/** One printer, or a new one at /admin/printers/new. */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (params.id === 'new') return { printer: null };
  const r = await context
    .get(apiContext)
    .get<PrinterView>(`/printers/${encodeURIComponent(params.id)}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { printer: r.data };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const api = context.get(apiContext);
  const isNew = params.id === 'new';
  return saveNew(
    SavePrinterDto,
    printerValues(form),
    (dto) =>
      isNew
        ? api.post<PrinterView>('/printers', dto)
        : api.put<PrinterView>(
            `/printers/${encodeURIComponent(params.id)}`,
            dto,
          ),
    (saved) => (isNew ? `/admin/printers/${saved.id}` : null),
  );
}

export default function Printer({ loaderData }: Route.ComponentProps) {
  const { printer } = loaderData;
  return (
    <>
      <AdminHeader
        title={printer?.name ?? 'Add a printer'}
        intro={
          printer
            ? `${printer.jobs} print job${printer.jobs === 1 ? '' : 's'} so far.`
            : 'A printer jobs can be planned on.'
        }
        trail={[{ label: 'Printers', to: '/admin/printers' }]}
      />
      {printer && (
        <SmartButtons
          label="This printer in figures"
          buttons={[
            {
              label: 'Print jobs',
              value: printer.jobs,
              hint: 'open the list',
              to: printerJobs(printer.id),
            },
            {
              label: 'Wear per hour',
              value: printer.wearPerHour ? (
                <Money amount={printer.wearPerHour} />
              ) : (
                '—'
              ),
              hint: printer.wearPerHour
                ? 'price ÷ hours it lasts'
                : 'fill in price and life',
            },
            { label: 'Power', value: `${printer.watts} W` },
          ]}
        />
      )}
      <PrinterForm key={printer?.id ?? 'new'} printer={printer} />
      {printer && (
        <div className="mt-8 border-t border-border pt-4">
          <DeleteRecord kind="printer" id={printer.id} what={'this printer'} />
        </div>
      )}
    </>
  );
}
