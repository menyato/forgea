import type { InvoiceListItem } from '@forgea/types';
import { Link, useSearchParams } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { can } from '~/features/admin/access';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { staffContext } from '~/features/admin/staff.server';
import { InvoiceTable } from '~/features/accounting/invoice-table';
import { ViewTabs } from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<InvoiceListItem[]>('/accounting/invoices');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    invoices: r.data,
    books: can(context.get(staffContext), 'books.view'),
  };
}

export default function Accounting({ loaderData }: Route.ComponentProps) {
  const { invoices, books } = loaderData;
  const tab = useSearchParams()[0].get('tab') ?? 'unpaid';
  const unpaid = invoices.filter(
    (i) => i.type === 'INVOICE' && Number(i.residual) > 0,
  );
  const shown =
    tab === 'unpaid'
      ? unpaid
      : tab === 'paid'
        ? invoices.filter(
            (i) => i.type === 'INVOICE' && Number(i.residual) <= 0,
          )
        : tab === 'credit'
          ? invoices.filter((i) => i.type !== 'INVOICE')
          : invoices;
  const owed = invoices
    .filter((i) => i.type === 'INVOICE')
    .reduce((s, i) => s + Number(i.residual), 0);
  return (
    <>
      <AdminHeader
        title="Invoices"
        intro="Invoices are made by the orders themselves: a deposit invoice when the deposit arrives, the final invoice on delivery (cash on delivery is recorded as paid). Record other payments from the order's page."
        action={
          books ? (
            <span className="flex gap-2">
              <Link
                to="/admin/accounting/reports"
                className={buttonClass('secondary')}
              >
                Reports
              </Link>
              <Link
                to="/admin/accounting/books"
                className={buttonClass('secondary')}
              >
                Books
              </Link>
            </span>
          ) : undefined
        }
      />
      <Panel title={`Still owed: $${owed.toFixed(2)}`}>
        <ViewTabs
          label="Invoice groups"
          current={tab}
          tabs={[
            { key: 'unpaid', label: 'Unpaid', count: unpaid.length },
            { key: 'paid', label: 'Paid' },
            { key: 'credit', label: 'Credit notes' },
            { key: 'all', label: 'All' },
          ]}
        />
        <InvoiceTable invoices={shown} />
      </Panel>
    </>
  );
}
