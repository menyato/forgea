import { type InvoiceListItem, Role } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { staffContext } from '~/features/admin/staff.server';
import { InvoiceTable } from '~/features/accounting/invoice-table';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<InvoiceListItem[]>('/accounting/invoices');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    invoices: r.data,
    admin: context.get(staffContext).role === Role.ADMIN,
  };
}

export default function Accounting({ loaderData }: Route.ComponentProps) {
  const { invoices, admin } = loaderData;
  const owed = invoices
    .filter((i) => i.type === 'INVOICE')
    .reduce((s, i) => s + Number(i.residual), 0);
  return (
    <>
      <AdminHeader
        title="Invoices"
        intro="Invoices are made by the orders themselves: a deposit invoice when the deposit arrives, the final invoice on delivery (cash on delivery is recorded as paid). Record other payments from the order's page."
        action={
          admin ? (
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
        <InvoiceTable invoices={invoices} />
      </Panel>
    </>
  );
}
