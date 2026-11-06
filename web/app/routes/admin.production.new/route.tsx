import { randomUUID } from 'node:crypto';
import type {
  OrderListItem,
  Page,
  PrintJobListItem,
  StaffOrder,
} from '@forgea/types';
import { CreatePrintJobDto } from '@forgea/validation';
import { Form, redirect, useFetcher } from 'react-router';
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
import { PrinterField, ReelField } from '~/features/production/choice-fields';
import { productionChoices } from '~/features/production/choices.server';
import { apiContext } from '~/lib/request.server';
import { fromStudioInput } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const chosen = url.searchParams.get('order');
  const [orders, choices, order] = await Promise.all([
    // Only orders being produced, however old: print runs are made for those.
    api.get<Page<OrderListItem>>(
      '/orders?limit=100&statuses=CONFIRMED,IN_PRODUCTION',
    ),
    productionChoices(api),
    chosen && /^[0-9a-f-]{36}$/.test(chosen)
      ? api.get<StaffOrder>(`/orders/${chosen}`)
      : null,
  ]);
  if (!orders.ok) throw new Response(orders.message, { status: orders.status });
  return {
    // Sent twice, the run is planned once (the second opens it).
    requestKey: randomUUID(),
    orders: orders.data.items,
    ...choices,
    order: order?.ok ? order.data : null,
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
      ...(text(form, 'orderItemId')
        ? { orderItemId: text(form, 'orderItemId') }
        : {}),
      ...(text(form, 'printerId')
        ? { printerId: text(form, 'printerId') }
        : {}),
      ...(text(form, 'stockItemId')
        ? { stockItemId: text(form, 'stockItemId') }
        : {}),
      quantity: text(form, 'quantity'),
      grams: text(form, 'grams'),
      hours: text(form, 'hours'),
      ...(when ? { scheduledDate: fromStudioInput(when) } : {}),
      requestKey: text(form, 'requestKey'),
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
  const { orders, order, printers, reels } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const mayWork = useCan()('production.manage');
  return (
    <>
      <AdminHeader
        title="Plan a print run"
        intro="Orders going into production get their runs by themselves; add one here for a reprint, a split run or work that isn't one line. With a day and time it is scheduled (and goes on the studio's calendar); without, it waits in the queue."
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
            {/* Choosing the order loads its lines. */}
            <Form method="get" className="mb-4 flex flex-wrap items-end gap-3">
              <SelectField
                label="Order"
                name="order"
                defaultValue={order?.id ?? ''}
              >
                <option value="" disabled>
                  Choose the order…
                </option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber} · {o.customerEmail}
                  </option>
                ))}
              </SelectField>
              <Button type="submit" variant="secondary">
                Show its lines
              </Button>
            </Form>
            {order && (
              <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
                <input
                  type="hidden"
                  name="requestKey"
                  value={loaderData.requestKey}
                />
                <input type="hidden" name="orderId" value={order.id} />
                <SelectField
                  label="Line it prints"
                  name="orderItemId"
                  error={errors['orderItemId']}
                >
                  {order.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.quantity} × {i.name}
                    </option>
                  ))}
                  <option value="">
                    Not one line (other work for this order)
                  </option>
                </SelectField>
                <Field
                  label="Pieces"
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={1}
                  required
                  error={errors['quantity']}
                />
                <PrinterField printers={printers} error={errors['printerId']} />
                <ReelField reels={reels} error={errors['stockItemId']} />
                <Field
                  label="Grams (estimate)"
                  name="grams"
                  inputMode="decimal"
                  required
                  error={errors['grams']}
                />
                <Field
                  label="Hours (estimate)"
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
            )}
          </ViewOnly>
        )}
      </Panel>
    </>
  );
}
