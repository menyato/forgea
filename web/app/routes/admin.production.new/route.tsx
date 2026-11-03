import type {
  MaterialView,
  OrderListItem,
  Page,
  PrintJobListItem,
} from '@forgea/types';
import { CreatePrintJobDto } from '@forgea/validation';
import { redirect, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import { fromStudioInput } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [orders, materials] = await Promise.all([
    // Only orders being produced, however old: print runs are made for those.
    api.get<Page<OrderListItem>>(
      '/orders?limit=100&statuses=CONFIRMED,IN_PRODUCTION',
    ),
    api.get<MaterialView[]>('/materials'),
  ]);
  if (!orders.ok) throw new Response(orders.message, { status: orders.status });
  return {
    orders: orders.data.items,
    materials: materials.ok ? materials.data.filter((m) => m.active) : [],
    order: url.searchParams.get('order'),
  };
}

/** Plans the run and opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const when = text(form, 'scheduledDate');
  let createdId: string | undefined;
  const result = await save(
    CreatePrintJobDto,
    {
      orderId: text(form, 'orderId'),
      materialId: text(form, 'materialId'),
      color: text(form, 'color'),
      grams: text(form, 'grams'),
      hours: text(form, 'hours'),
      machine: text(form, 'machine'),
      ...(when ? { scheduledDate: fromStudioInput(when) } : {}),
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<PrintJobListItem>('/print-jobs', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/production/${createdId}`);
  return result;
}

export default function NewPrintJob({ loaderData }: Route.ComponentProps) {
  const { orders, materials, order } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const mayWork = useCan()('production.manage');
  return (
    <>
      <AdminHeader
        title="Plan a print run"
        intro="One run on one printer for a confirmed order. With a day and time it is scheduled (and goes on the studio's calendar); without, it waits in the queue."
        trail={[{ label: 'Production', to: '/admin/production' }]}
      />
      <Panel>
        {orders.length === 0 ? (
          <p className="text-sm text-text-muted">
            Print runs are planned for confirmed orders. None is waiting right
            now.
          </p>
        ) : (
          <ViewOnly editable={mayWork}>
            <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Order"
                name="orderId"
                defaultValue={order ?? undefined}
                error={errors['orderId']}
              >
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} · {o.customerEmail}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Material"
                name="materialId"
                error={errors['materialId']}
              >
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.stockGrams} g in stock)
                  </option>
                ))}
              </SelectField>
              <Field
                label="Colour"
                name="color"
                required
                error={errors['color']}
              />
              <Field
                label="Printer"
                name="machine"
                required
                defaultValue="Printer 1"
                error={errors['machine']}
              />
              <Field
                label="Grams"
                name="grams"
                inputMode="decimal"
                required
                error={errors['grams']}
              />
              <Field
                label="Hours"
                name="hours"
                inputMode="decimal"
                required
                error={errors['hours']}
              />
              <Field
                label="When (optional, Beirut time)"
                name="scheduledDate"
                type="datetime-local"
                error={errors['scheduledDate']}
              />
              <div className="flex items-end gap-3">
                <Button type="submit" disabled={fetcher.state !== 'idle'}>
                  Plan it
                </Button>
                <SaveStatus state={fetcher.state} result={fetcher.data} />
              </div>
            </fetcher.Form>
          </ViewOnly>
        )}
      </Panel>
    </>
  );
}
