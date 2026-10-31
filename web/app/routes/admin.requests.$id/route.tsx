import {
  CUSTOM_REQUEST_STATUS_LABELS,
  CustomRequestStatus,
  type StaffCustomRequest,
} from '@forgea/types';
import {
  CloseCustomRequestDto,
  QuoteCustomRequestDto,
} from '@forgea/validation';
import { data, Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { Field, TextAreaField } from '~/components/ui/field';
import { can } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  type SaveResult,
  save,
  staffContext,
  text,
} from '~/features/admin/staff.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { RequestFileView } from '~/features/custom-requests/request-file-view';
import { RequestTimeline } from '~/features/custom-requests/request-timeline';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<StaffCustomRequest>(
      `/custom-requests/${encodeURIComponent(params.id)}`,
    );
  if (!r.ok) throw new Response(r.message, { status: r.status });
  // Only what their permissions allow is offered (the API checks it too).
  const staff = context.get(staffContext);
  return {
    request: r.data,
    canQuote: can(staff, 'requests.quote'),
    canDesign: can(staff, 'requests.design'),
  };
}

/** design (upload) | quote | cancel */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const base = `/custom-requests/${encodeURIComponent(params.id)}`;
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent === 'design') {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return data<SaveResult>({ error: 'Choose a file' }, { status: 400 });
    }
    const upload = new FormData();
    upload.set('file', file, file.name);
    const r = await api.postForm(`${base}/design`, upload);
    return r.ok
      ? data<SaveResult>({ ok: true })
      : data<SaveResult>({ error: r.message }, { status: r.status });
  }
  if (intent === 'cancel') {
    return save(CloseCustomRequestDto, { note: text(form, 'note') }, (dto) =>
      api.post(`${base}/cancel`, dto),
    );
  }
  return save(
    QuoteCustomRequestDto,
    { price: text(form, 'price'), note: text(form, 'note') },
    (dto) => api.post(`${base}/quote`, dto),
  );
}

export default function RequestAdmin({ loaderData }: Route.ComponentProps) {
  const { request: r, canQuote, canDesign } = loaderData;
  const open =
    r.status === CustomRequestStatus.SUBMITTED ||
    r.status === CustomRequestStatus.QUOTED;

  return (
    <>
      <AdminHeader
        title={r.title}
        intro={`${r.requestNumber} · ${r.expired ? 'Quote expired' : CUSTOM_REQUEST_STATUS_LABELS[r.status].title} · ${new Date(r.createdAt).toLocaleString('en-GB')}`}
        action={
          <Link
            to="/admin/requests"
            className="text-sm underline underline-offset-4"
          >
            All requests
          </Link>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid content-start gap-6">
          <Panel title="What they asked for">
            <p className="whitespace-pre-line">{r.description}</p>
            <p className="text-sm text-text-muted">
              {r.quantity} piece{r.quantity === 1 ? '' : 's'}
              {r.material && ` · ${r.material.name}`}
              {r.colour && ` · ${r.colour}`}
              {r.estimate && (
                <>
                  {' · instant estimate '}
                  <Money amount={r.estimate.low} />–
                  <Money amount={r.estimate.high} />
                </>
              )}
            </p>
            {r.file && (
              <RequestFileView file={r.file} label="the customer's file" />
            )}
          </Panel>
          <Panel title="Our design">
            {r.design ? (
              <RequestFileView file={r.design} label="our design" />
            ) : (
              <p className="text-sm text-text-muted">
                No design yet. The customer sees it next to the quote.
              </p>
            )}
            {open && canDesign && <DesignUpload />}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Customer">
            <p>
              {r.customer.name ?? r.customer.email}
              <span className="block text-sm text-text-muted">
                {r.customer.email}
              </span>
            </p>
            {r.customer.phone && (
              <WhatsAppLink
                phone={r.customer.phone}
                message={`Hello, this is Forgea about your request ${r.requestNumber}.`}
                className="text-sm underline underline-offset-4"
              >
                Message them on WhatsApp
              </WhatsAppLink>
            )}
          </Panel>
          {r.quote && (
            <Panel title="Quote sent">
              <p className="text-2xl font-bold">
                <Money amount={r.quote.price} />
              </p>
              {r.quote.note && <p className="text-sm">{r.quote.note}</p>}
              <p className="text-sm text-text-muted">
                {r.expired ? 'Expired' : 'Open until'}{' '}
                {new Date(r.quote.expiresAt).toLocaleString('en-GB')}
              </p>
            </Panel>
          )}
          {r.orderNumber && (
            <Panel title="Order">
              <p>
                Accepted: order{' '}
                <span className="font-mono">{r.orderNumber}</span>.
              </p>
            </Panel>
          )}
          {open && canQuote && <QuoteForm quoted={r.quote !== null} />}
          {open && canQuote && <CancelForm />}
          <Panel title="History">
            <RequestTimeline history={r.history} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function DesignUpload() {
  const fetcher = useFetcher<SaveResult>();
  return (
    <fetcher.Form
      method="post"
      encType="multipart/form-data"
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="intent" value="design" />
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Design file (STL, GLB or an image)</span>
        <input
          type="file"
          name="file"
          accept=".stl,.glb,.png,.jpg,.jpeg,.webp"
          required
        />
      </label>
      <Button
        type="submit"
        variant="secondary"
        disabled={fetcher.state !== 'idle'}
      >
        Add the design
      </Button>
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </fetcher.Form>
  );
}

function QuoteForm({ quoted }: { quoted: boolean }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <Panel title={quoted ? 'Send a new quote' : 'Send the quote'}>
      <fetcher.Form method="post" className="grid gap-3">
        <input type="hidden" name="intent" value="quote" />
        <Field
          label="Price (USD, for everything)"
          name="price"
          inputMode="decimal"
          required
          error={errors['price']}
        />
        <TextAreaField
          label="Note for the customer (optional)"
          name="note"
          rows={3}
          error={errors['note']}
        />
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          Send the quote
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </fetcher.Form>
    </Panel>
  );
}

function CancelForm() {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title="Can't make it?">
      <fetcher.Form
        method="post"
        className="grid gap-3"
        onSubmit={(e) => {
          // Final: the customer is told and can no longer accept a quote.
          if (!window.confirm('Cancel this request? The customer is told.'))
            e.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="cancel" />
        <TextAreaField
          label="Why (the customer sees this)"
          name="note"
          rows={2}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={fetcher.state !== 'idle'}
        >
          Cancel the request
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </fetcher.Form>
    </Panel>
  );
}
