import type {
  AdminProductListItem,
  CustomRequestStatus,
  InvoiceCounts,
  MaterialView,
  OrderStatus,
  Page,
  QuotationStatus,
} from '@forgea/types';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { can } from '~/features/admin/access';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { staffContext } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

interface Card {
  key: string;
  count: number;
  label: string;
  to: string;
  /** Shown under the number, e.g. which materials. */
  detail?: string | undefined;
  /** Money still owed, in USD. */
  owed?: string | undefined;
  /** Something is waiting: the card stands out. */
  urgent: boolean;
}

/**
 * "Needs attention": what is waiting for the team right now, each card linking to the list
 * that holds it. Only what this person's permissions show is asked for and listed.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const staff = context.get(staffContext);
  const may = (p: Parameters<typeof can>[1]) => can(staff, p);
  const ok = <T,>(r: { ok: true; data: T } | { ok: false }) =>
    r.ok ? r.data : null;

  const [orders, requests, leads, quotations, invoices, materials, products] =
    await Promise.all([
      may('orders.view')
        ? api
            .get<Partial<Record<OrderStatus, number>>>('/orders/counts')
            .then(ok)
        : null,
      may('requests.view')
        ? api
            .get<Partial<Record<CustomRequestStatus, number>>>(
              '/custom-requests/counts',
            )
            .then(ok)
        : null,
      may('leads.view')
        ? api.get<{ unopened: number }>('/leads/counts').then(ok)
        : null,
      may('quotations.view')
        ? api
            .get<Partial<Record<QuotationStatus, number>>>('/quotations/counts')
            .then(ok)
        : null,
      may('invoices.view')
        ? api.get<InvoiceCounts>('/accounting/invoices/counts').then(ok)
        : null,
      may('materials.view')
        ? api.get<MaterialView[]>('/materials').then(ok)
        : null,
      may('catalog.view')
        ? api
            .get<Page<AdminProductListItem>>('/products/manage?limit=100')
            .then(ok)
        : null,
    ]);

  const cards: Card[] = [];
  if (orders) {
    const confirm = (orders.PENDING ?? 0) + (orders.AWAITING_DEPOSIT ?? 0);
    const delivery = (orders.READY ?? 0) + (orders.OUT_FOR_DELIVERY ?? 0);
    cards.push(
      {
        key: 'confirm',
        count: confirm,
        label: 'orders to confirm or waiting for a deposit',
        to: '/admin/orders?tab=confirm',
        urgent: confirm > 0,
      },
      {
        key: 'production',
        count: (orders.CONFIRMED ?? 0) + (orders.IN_PRODUCTION ?? 0),
        label: 'orders in production',
        to: '/admin/orders?tab=production',
        urgent: false,
      },
      {
        key: 'delivery',
        count: delivery,
        label: 'orders ready or out for delivery',
        to: '/admin/orders?tab=delivery',
        urgent: delivery > 0,
      },
    );
  }
  if (requests) {
    const fresh = requests.SUBMITTED ?? 0;
    cards.push({
      key: 'requests',
      count: fresh,
      label: 'new custom requests to quote',
      to: '/admin/requests?tab=new',
      urgent: fresh > 0,
    });
  }
  if (leads) {
    cards.push({
      key: 'leads',
      count: leads.unopened,
      label: 'new leads nobody has opened',
      to: '/admin/leads?tab=new',
      urgent: leads.unopened > 0,
    });
  }
  if (quotations) {
    cards.push({
      key: 'quotations',
      count: quotations.SENT ?? 0,
      label: 'quotations waiting for an answer',
      to: '/admin/quotations?status=SENT',
      urgent: false,
    });
  }
  if (invoices) {
    cards.push({
      key: 'invoices',
      count: invoices.unpaid,
      label: 'unpaid invoices',
      owed: invoices.unpaid ? invoices.owed : undefined,
      to: '/admin/accounting?filter=unpaid',
      urgent: invoices.unpaid > 0,
    });
  }
  if (materials) {
    const low = materials.filter(
      (m) => m.active && m.stockGrams <= m.lowStockThresholdGrams,
    );
    cards.push({
      key: 'stock',
      count: low.length,
      label: 'materials low on stock',
      detail: low.length ? low.map((m) => m.code).join(', ') : undefined,
      to: '/admin/materials',
      urgent: low.length > 0,
    });
  }
  if (products) {
    const without3d = products.items.filter(
      (p) => p.active && !p.hasModel,
    ).length;
    cards.push({
      key: 'models',
      count: without3d,
      label: 'products in the shop without a 3D model',
      to: '/admin/products',
      urgent: false,
    });
  }
  return { cards, name: staff.name ?? staff.email };
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { cards, name } = loaderData;
  const waiting = cards.filter((c) => c.urgent);
  return (
    <>
      <AdminHeader
        trail={null}
        title="Needs attention"
        intro={
          waiting.length
            ? `Hello ${name}. ${waiting.length === 1 ? 'One thing is' : `${waiting.length} things are`} waiting for you; each card opens the list that holds it.`
            : `Hello ${name}. Nothing is waiting right now.`
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.key}
            to={c.to}
            className={`grid gap-1 rounded-lg border p-5 hover:border-accent ${
              c.urgent && c.count > 0
                ? 'border-accent bg-surface'
                : 'border-border bg-surface'
            }`}
          >
            <span className="text-3xl font-bold">{c.count}</span>
            <span className="text-sm text-text-muted">{c.label}</span>
            {c.detail && <span className="text-sm">{c.detail}</span>}
            {c.owed && (
              <span className="text-sm">
                <Money amount={c.owed} /> still owed
              </span>
            )}
          </Link>
        ))}
      </div>
      {cards.length === 0 && (
        <Panel>
          <p className="text-text-muted">
            Your pages are in the menu on the left.
          </p>
        </Panel>
      )}
    </>
  );
}
