import {
  CUSTOM_REQUEST_STATUS_LABELS,
  type CustomerDetail,
  ORDER_STATUS_LABELS,
} from '@forgea/types';
import { CustomerDetailsDto, MergeCustomersDto } from '@forgea/validation';
import { type ReactNode, useId } from 'react';
import { data, Link, redirect, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { useIsAdmin } from '~/features/admin/access';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { accountText } from '~/features/customers/account-text';
import { apiContext } from '~/lib/request.server';
import { STUDIO_TIME_ZONE } from '~/lib/studio-time';
import type { Route } from './+types/route';

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    {
      title: `${loaderData?.customer.name ?? loaderData?.customer.email ?? 'Customer'} — Forgea`,
    },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<CustomerDetail>(
      `/customers/one?email=${encodeURIComponent(params.email)}`,
    );
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { customer: r.data };
}

/**
 * Merges this customer into another (admin only; the API refuses anyone else): everything they
 * have becomes the other's and this account is removed; the page opens the kept customer.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'details')
    return save(
      CustomerDetailsDto,
      {
        email: params.email,
        name: text(form, 'name'),
        phone: text(form, 'phone'),
      },
      (dto) => context.get(apiContext).put('/customers/details', dto),
    );
  if (form.get('confirm') !== 'on')
    return data<SaveResult>(
      { error: 'Tick the box to confirm the merge' },
      { status: 400 },
    );
  let into: string | undefined;
  const result = await save(
    MergeCustomersDto,
    { from: params.email, into: text(form, 'into') },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<{ into: string }>('/customers/merge', dto);
      if (r.ok) into = r.data.into;
      return r;
    },
  );
  if (into) throw redirect(`/admin/customers/${encodeURIComponent(into)}`);
  return result;
}

/** Day and time, in the studio's own time zone (Beirut). */
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: STUDIO_TIME_ZONE,
  });

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: STUDIO_TIME_ZONE,
  });

/** One kind of record they have, newest first, each opening its own page. */
function History<T>({
  title,
  rows,
  empty,
  row,
}: {
  title: string;
  rows: readonly T[];
  empty: string;
  row: (item: T) => {
    key: string;
    to: string;
    label: string;
    detail: ReactNode;
  };
}) {
  return (
    <Panel title={`${title} (${rows.length})`}>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="grid gap-1 text-sm">
          {rows.map((item) => {
            const r = row(item);
            return (
              <li key={r.key} className="flex flex-wrap gap-x-2">
                <Link to={r.to} className="font-mono underline">
                  {r.label}
                </Link>
                <span className="text-text-muted">{r.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export default function Customer({ loaderData }: Route.ComponentProps) {
  const { customer: c } = loaderData;
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Customers', to: '/admin/customers' }]}
        title={c.name ?? c.email}
        intro={`${c.email}${c.phone ? ` · ${c.phone}` : ''} · ${accountText(c)}${c.account ? ` since ${date(c.account.since)}${c.account.confirmed ? '' : ' (address not confirmed)'}` : ''}`}
      />
      <div className="mb-6 flex flex-wrap gap-6 text-sm">
        <p>
          <strong className="text-2xl">{c.orders}</strong> order
          {c.orders === 1 ? '' : 's'}
        </p>
        <p>
          <strong className="text-2xl">
            <Money amount={c.spent} />
          </strong>{' '}
          spent
        </p>
        <p>Last activity {date(c.lastActivity)}</p>
        {c.account && (
          <p>
            {c.lastSeen
              ? `Last signed in ${when(c.lastSeen)}`
              : 'Never signed in'}
          </p>
        )}
        {c.cart && (
          <p>
            {c.cart.lines} item{c.cart.lines === 1 ? '' : 's'} in their cart (
            {date(c.cart.updatedAt)})
          </p>
        )}
        {c.phone && (
          <WhatsAppLink
            phone={c.phone}
            message={`Hello ${c.name ?? ''}, this is Forgea.`}
            className="underline underline-offset-4"
          >
            Message on WhatsApp
          </WhatsAppLink>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <History
          title="Orders"
          rows={c.history.orders}
          empty={c.account ? 'No orders yet.' : 'No account, so no orders yet.'}
          row={(o) => ({
            key: o.id,
            to: `/admin/orders/${o.id}`,
            label: o.number,
            detail: (
              <>
                {ORDER_STATUS_LABELS[o.status].title} ·{' '}
                <Money amount={o.total} /> · {date(o.createdAt)}
              </>
            ),
          })}
        />
        <History
          title="Quotations"
          rows={c.history.quotations}
          empty="No quotations."
          row={(q) => ({
            key: q.id,
            to: `/admin/quotations/${q.id}`,
            label: q.number,
            detail: (
              <>
                {q.status.toLowerCase()} · <Money amount={q.total} /> ·{' '}
                {date(q.createdAt)}
              </>
            ),
          })}
        />
        <History
          title="Custom requests"
          rows={c.history.requests}
          empty="No custom requests."
          row={(r) => ({
            key: r.id,
            to: `/admin/requests/${r.id}`,
            label: r.number,
            detail: `${r.title} · ${CUSTOM_REQUEST_STATUS_LABELS[r.status].title} · ${date(r.createdAt)}`,
          })}
        />
        {c.account && (
          <Panel title={`Sign-ins (${c.signIns.length})`}>
            {c.signIns.length === 0 ? (
              <p className="text-sm text-text-muted">
                {c.account.signIn.length === 0
                  ? 'The studio made this account; they have not signed in yet.'
                  : 'No sign-ins kept.'}
              </p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {c.signIns.map((s) => (
                  <li key={s.startedAt} className="flex flex-wrap gap-x-2">
                    <span className="font-medium">{s.device}</span>
                    <span className="text-text-muted">
                      signed in {when(s.startedAt)} · last seen{' '}
                      {when(s.lastSeen)}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                    </span>
                    {s.active && (
                      <span className="rounded-pill border border-accent px-2 text-xs">
                        Signed in now
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
        <History
          title="Leads"
          rows={c.history.leads}
          empty="No leads."
          row={(l) => ({
            key: l.id,
            to: `/admin/leads/${l.id}`,
            label: l.name,
            detail: `${l.state === 'open' ? l.stage : l.state} · ${date(l.createdAt)}`,
          })}
        />
      </div>
      {c.account && (
        <CustomerDetails
          key={`${c.name}|${c.phone}`}
          name={c.name}
          phone={c.phone}
        />
      )}
      {c.account && <MergeCustomer email={c.email} />}
    </>
  );
}

/** Admins correct the name and phone of an account the studio made (or a customer's typo). */
function CustomerDetails({
  name,
  phone,
}: {
  name: string | null;
  phone: string | null;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  if (!useIsAdmin()) return null;
  return (
    <div className="mt-8 border-t border-border pt-4">
      <Panel title="Name and phone">
        <fetcher.Form
          method="post"
          className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="intent" value="details" />
          <Field
            label="Name"
            name="name"
            autoComplete="off"
            required
            defaultValue={name ?? ''}
            error={errors['name']}
          />
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="off"
            required
            defaultValue={phone ?? ''}
            error={errors['phone']}
          />
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button
              type="submit"
              variant="secondary"
              disabled={fetcher.state !== 'idle'}
            >
              Save
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      </Panel>
    </div>
  );
}

/** Admins merge a duplicate (a second walk-in account) into the customer to keep. */
function MergeCustomer({ email }: { email: string }) {
  const fetcher = useFetcher<SaveResult>();
  const confirmId = useId();
  if (!useIsAdmin()) return null;
  return (
    <div className="mt-8 border-t border-border pt-4">
      <Panel title="Merge into another customer">
        <p className="max-w-2xl text-sm text-text-muted">
          For a duplicate: this customer&apos;s orders, quotations, requests,
          leads, invoices and payments become the other customer&apos;s, with
          their history, and {email} is removed. It can&apos;t be undone.
        </p>
        <fetcher.Form method="post" className="grid max-w-xl grid-cols-1 gap-3">
          <Field
            label="Keep this customer (their email)"
            name="into"
            type="email"
            autoComplete="off"
            required
            error={fetcher.data?.errors?.['into']}
          />
          <label
            htmlFor={confirmId}
            className="flex items-center gap-2 text-sm"
          >
            <input
              id={confirmId}
              type="checkbox"
              name="confirm"
              autoComplete="off"
              required
            />
            Yes, move everything and remove {email}
          </label>
          <div>
            <Button
              type="submit"
              variant="secondary"
              disabled={fetcher.state !== 'idle'}
            >
              Merge
            </Button>
          </div>
          {fetcher.data?.error && (
            <p role="alert" className="text-sm text-danger">
              {fetcher.data.error}
            </p>
          )}
        </fetcher.Form>
      </Panel>
    </div>
  );
}
