import type { PrinterView } from '@forgea/types';
import { SavePrinterDto } from '@forgea/validation';
import { redirect } from 'react-router';
import { AdminHeader } from '~/features/admin/admin-ui';
import { save } from '~/features/admin/staff.server';
import { PrinterForm } from '~/features/production/printer-form';
import { printerValues } from '~/features/production/printer-values.server';
import { apiContext } from '~/lib/request.server';
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
  let created: string | undefined;
  const result = await save(
    SavePrinterDto,
    printerValues(form),
    async (dto) => {
      const r = isNew
        ? await api.post<PrinterView>('/printers', dto)
        : await api.put<PrinterView>(
            `/printers/${encodeURIComponent(params.id)}`,
            dto,
          );
      if (isNew && r.ok) created = r.data.id;
      return r;
    },
  );
  if (created) throw redirect(`/admin/printers/${created}`);
  return result;
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
      <PrinterForm key={printer?.id ?? 'new'} printer={printer} />
    </>
  );
}
