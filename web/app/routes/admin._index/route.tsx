import type {
  CustomerSummary,
  CustomRequestStatus,
  InvoiceCounts,
  MaterialView,
  OrderStatus,
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

  const [
    orders,
    requests,
    leads,
    quotations,
    invoices,
    materials,
    products,
    customers,
  ] = await Promise.all([
    may('orders.view')
      ? api.get<Partial<Record<OrderStatus, number>>>('/orders/counts').then(ok)
      : null,
    may('requests.view')
      ? api
          .get<Partial<Record<CustomRequestStatus, number>>>(
            '/custom-requests/counts',
          )
          .then(ok)
      : null,
    may('leads.view')
      ? api
          .get<{ unopened: number; followUpsDue: number }>('/leads/counts')
          .then(ok)
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
          .get<{ shownWithoutModel: number }>('/products/manage/counts')
          .then(ok)
      : null,
    may('customers.view')
      ? api.get<CustomerSummary>('/customers/summary').then(ok)
      : null,
  ]);
  // What the server's settings leave undone (no email in production…): admins only.
  const warnings = may('store.manage')
    ? ((await api.get<string[]>('/store-settings/setup-warnings').then(ok)) ??
      [])
    : [];

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
      key: 'follow-ups',
      count: leads.followUpsDue,
      label: 'of my follow-ups due today or late',
      to: '/admin/todo',
      urgent: leads.followUpsDue > 0,
    });
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
      to: '/admin/quotations?filter=sent',
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
      to: '/admin/materials?filter=active,low',
      urgent: low.length > 0,
    });
  }
  if (products) {
    const without3d = products.shownWithoutModel;
    cards.push({
      key: 'models',
      count: without3d,
      label: 'products in the shop without a 3D model',
      to: '/admin/products?filter=shown,no3d',
      urgent: false,
    });
  }
  return { cards, customers, warnings, name: staff.name ?? staff.email };
}

export default function Overview({ loaderData }: Route.ComponentProps) {
  const { cards, customers, warnings, name } = loaderData;
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
      {warnings.length > 0 && (
        <div
          role="alert"
          className="mb-6 grid gap-1 rounded-lg border-2 border-danger bg-surface p-4 text-sm"
        >
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
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
      {customers && (
        <section
          aria-labelledby="customers-heading"
          className="mt-8 grid gap-3"
        >
          <h2 id="customers-heading" className="font-display text-xl font-bold">
            Customers
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              {
                n: customers.accounts,
                label: 'customer accounts',
                to: '/admin/customers?filter=account',
              },
              {
                n: customers.newThisWeek,
                label: 'new accounts this week',
                to: '/admin/customers?filter=account,new',
              },
              {
                n: customers.seenThisWeek,
                label: 'signed in this week',
                to: '/admin/customers?filter=account,seen',
              },
              {
                n: customers.withoutAccount,
                label: 'known only by email (no account)',
                to: '/admin/customers?filter=guest',
              },
              {
                n: customers.guestCarts,
                label: 'visitors with a cart, not signed in',
                // Nobody to list: they never gave an address.
                to: null,
              },
            ].map((c) =>
              c.to ? (
                <Link
                  key={c.label}
                  to={c.to}
                  className="grid gap-1 rounded-lg border border-border bg-surface p-5 hover:border-accent"
                >
                  <span className="text-3xl font-bold">{c.n}</span>
                  <span className="text-sm text-text-muted">{c.label}</span>
                </Link>
              ) : (
                <div
                  key={c.label}
                  className="grid gap-1 rounded-lg border border-border bg-surface p-5"
                >
                  <span className="text-3xl font-bold">{c.n}</span>
                  <span className="text-sm text-text-muted">{c.label}</span>
                </div>
              ),
            )}
          </div>
        </section>
      )}
      {cards.length === 0 && !customers && (
        <Panel>
          <p className="text-text-muted">
            Your pages are in the menu on the left.
          </p>
        </Panel>
      )}
    </>
  );
}
