import { ORDER_STATUS_LABELS, type CustomerOrder } from '@forgea/types';
import { Form, useNavigation } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
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
      className="grid gap-5 rounded-lg border border-border bg-surface p-5 md:grid-cols-[minmax(0,1fr)_16rem]"
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
          {order.items.map((item, n) => (
            <li key={n} className="flex justify-between gap-4">
              <span className="min-w-0">
                {item.quantity} × {item.name}
                {item.options.length > 0 && (
                  <span className="block text-text-muted">
                    {item.options
                      .map((o) => `${o.group}: ${o.value}`)
                      .join(' · ')}
                  </span>
                )}
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
      {order.invoices.length > 0 && (
        <section aria-label="Invoices" className="grid gap-2">
          <h3 className="text-sm font-semibold">Invoices</h3>
          <ul className="grid gap-1 text-sm">
            {order.invoices.map((i) => (
              <li
                key={i.number}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  <span className="font-mono">{i.number}</span>{' '}
                  <span className="text-text-muted">
                    · {i.kind} · {new Date(i.date).toLocaleDateString('en-GB')}
                  </span>
                </span>
                <span>
                  <Money amount={i.total} />{' '}
                  {i.kind === 'credit note' ? (
                    // Money owed back to the customer, not by them.
                    Number(i.residual) > 0 ? (
                      <span className="text-warning">
                        <Money amount={i.residual} /> coming back to you
                      </span>
                    ) : (
                      <span className="text-text-muted">settled</span>
                    )
                  ) : i.paid ? (
                    <span className="text-success">paid</span>
                  ) : (
                    <span className="text-warning">
                      <Money amount={i.residual} /> to pay
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <OrderActions order={order} />
      <section aria-label="Status history">
        <h3 className="mb-3 text-sm font-semibold">Progress</h3>
        <OrderTimeline history={order.history} />
      </section>
    </article>
  );
}

/** "Order again", and cancelling while the studio hasn't started (the API checks both). */
function OrderActions({ order }: { order: CustomerOrder }) {
  const busy = useNavigation().state !== 'idle';
  return (
    <div className="flex flex-wrap gap-3">
      <Form method="post">
        <input type="hidden" name="number" value={order.orderNumber} />
        <Button
          type="submit"
          name="intent"
          value="reorder"
          variant="secondary"
          disabled={busy}
        >
          Order again
        </Button>
      </Form>
      {order.canCancel && (
        <Form
          method="post"
          onSubmit={(e) => {
            if (!window.confirm(`Cancel order ${order.orderNumber}?`))
              e.preventDefault();
          }}
        >
          <input type="hidden" name="number" value={order.orderNumber} />
          <Button
            type="submit"
            name="intent"
            value="cancel"
            variant="quiet"
            disabled={busy}
          >
            Cancel this order
          </Button>
        </Form>
      )}
    </div>
  );
}
