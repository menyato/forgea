import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomRequestView,
  type StoreSettings,
} from '@forgea/types';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Money } from '~/components/money';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { RequestFileView } from './request-file-view';
import { RequestTimeline } from './request-timeline';

/**
 * A custom request as its customer sees it ("My requests"): our design and their file in 3D,
 * what they asked for, the quote and its history. The customer's page adds its forms
 * (`actions`, `accept`); the dashboard's preview shows the same page without them.
 */
export function RequestForCustomer({
  request: r,
  store,
  notice,
  actions,
  accept,
}: {
  request: CustomRequestView;
  store: Pick<StoreSettings, 'whatsappPhone'> | null;
  /** Shown above the title (e.g. "Request sent"). */
  notice?: ReactNode;
  /** Under the quote: decline or cancel. */
  actions?: ReactNode;
  /** Below everything: accepting the quote (the order form). */
  accept?: ReactNode;
}) {
  const status = r.expired
    ? {
        title: 'Quote expired',
        detail: 'Ask us on WhatsApp and we will send a new one.',
      }
    : CUSTOM_REQUEST_STATUS_LABELS[r.status];

  return (
    <main className={`${PAGE_WIDTH} grid gap-10 py-10`}>
      {notice}
      <header className="grid gap-3">
        <Link
          to="/requests"
          className="text-sm text-text-muted hover:underline"
        >
          My requests
        </Link>
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          {r.title}
        </h1>
        <p className="text-text-muted">
          {r.requestNumber} · {status.title}. {status.detail}
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(20rem,5fr)]">
        <section className="grid content-start gap-6">
          {r.design && (
            <figure className="grid gap-2">
              <RequestFileView
                file={r.design}
                label={`our design for ${r.title}`}
              />
              <figcaption className="text-sm text-text-muted">
                Our design
              </figcaption>
            </figure>
          )}
          {r.file && (
            <figure className="grid gap-2">
              <RequestFileView file={r.file} label="your file" />
              <figcaption className="text-sm text-text-muted">
                What you sent
              </figcaption>
            </figure>
          )}
          <p className="max-w-[65ch] whitespace-pre-line">{r.description}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
            <dt className="text-text-muted">How many</dt>
            <dd>{r.quantity}</dd>
            {r.material && (
              <>
                <dt className="text-text-muted">Material</dt>
                <dd>{r.material.name}</dd>
              </>
            )}
            {r.colour && (
              <>
                <dt className="text-text-muted">Colour</dt>
                <dd>{r.colour}</dd>
              </>
            )}
            {r.estimate && (
              <>
                <dt className="text-text-muted">Instant estimate</dt>
                <dd>
                  <Money amount={r.estimate.low} />–
                  <Money amount={r.estimate.high} />
                </dd>
              </>
            )}
          </dl>
        </section>

        <aside className="grid content-start gap-6">
          {r.quote && (
            <div className="grid gap-2 rounded-lg bg-surface p-5">
              <p className="text-sm text-text-muted">Our quote</p>
              <p className="font-display text-4xl font-extrabold">
                <Money amount={r.quote.price} />
              </p>
              {r.quote.note && <p>{r.quote.note}</p>}
              <p className="text-sm text-text-muted">
                {r.expired ? 'Expired' : 'Valid until'}{' '}
                {new Date(r.quote.expiresAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
            </div>
          )}
          {r.orderNumber && (
            <p>
              Order{' '}
              <Link to="/orders" className="font-mono font-semibold underline">
                {r.orderNumber}
              </Link>{' '}
              was created from this request.
            </p>
          )}
          {actions}
          {store && (
            <WhatsAppLink
              phone={store.whatsappPhone}
              message={`Hello Forgea! About request ${r.requestNumber}.`}
              className="text-sm underline underline-offset-4"
            >
              Chat about this request on WhatsApp
            </WhatsAppLink>
          )}
          <RequestTimeline history={r.history} />
        </aside>
      </div>

      {accept}
    </main>
  );
}
