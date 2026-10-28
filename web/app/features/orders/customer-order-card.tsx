import { ORDER_STATUS_LABELS, type CustomerOrder } from '@forgea/types';
import { Money } from '~/components/money';
import { OrderTimeline } from './order-timeline';

const placed = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeZone: 'Asia/Beirut',
});

/** One order with its items, totals and status history — used by "My orders" and "Track". */
export function CustomerOrderCard({ order }: { order: CustomerOrder }) {
  const status = ORDER_STATUS_LABELS[order.status];
  const depositOutstanding =
    Number(order.depositRequired) > 0 && !order.depositPaid;

  return (
    <article
      aria-labelledby={`order-${order.orderNumber}`}
      className="grid gap-5 rounded-lg border border-border bg-surface p-5 md:grid-cols-[1fr_16rem]"
    >
      <div className="grid content-start gap-4">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id={`order-${order.orderNumber}`}
            className="font-mono text-lg font-semibold"
          >
            {order.orderNumber}
          </h2>
          <p className="text-sm text-text-muted">
            Placed {placed.format(new Date(order.createdAt))}
          </p>
        </header>
        <p>
          <span className="rounded-pill bg-background px-3 py-1 text-sm font-semibold">
            {status.title}
          </span>
        </p>
        <ul className="grid gap-1 text-sm">
          {order.items.map((item) => (
            <li key={item.name} className="flex justify-between gap-4">
              <span>
                {item.quantity} × {item.name}
              </span>
              <Money amount={item.lineTotal} />
            </li>
          ))}
        </ul>
        <p className="flex justify-between gap-4 border-t border-border pt-3 font-semibold">
          <span>Total</span>
          <span>
            <Money amount={order.total} />
            {order.currencyCode !== 'USD' && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                ({Number(order.totalInCurrency).toLocaleString('en-US')}{' '}
                {order.currencyCode})
              </span>
            )}
          </span>
        </p>
        {depositOutstanding && (
          <p className="rounded-md bg-background p-3 text-sm">
            Deposit of <Money amount={order.depositRequired} /> needed before we
            start — the transfer details are in your email.
          </p>
        )}
        <p className="text-sm text-text-muted">
          {order.delivery ? 'Delivery' : 'Pickup from the studio'} ·{' '}
          {order.paymentMethod === 'COD' ? 'cash on delivery' : 'bank transfer'}
        </p>
      </div>
      <section aria-label="Status history">
        <h3 className="mb-3 text-sm font-semibold">Progress</h3>
        <OrderTimeline history={order.history} />
      </section>
    </article>
  );
}
