import type { LeadListItem, LeadStageView, Page } from '@forgea/types';
import { SaveLeadDto } from '@forgea/validation';
import { Link, redirect, useFetcher, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { Field, TextAreaField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const STATES = [
  ['open', 'Open'],
  ['won', 'Won'],
  ['lost', 'Lost'],
] as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = url.searchParams.get('state') ?? 'open';
  const query = new URLSearchParams({ limit: '100', state });
  const q = url.searchParams.get('q');
  if (q) query.set('q', q);
  const [leads, stages] = await Promise.all([
    api.get<Page<LeadListItem>>(`/leads?${query}`),
    api.get<LeadStageView[]>('/lead-stages'),
  ]);
  if (!leads.ok) throw new Response(leads.message, { status: leads.status });
  return {
    state,
    leads: leads.data.items,
    stages: stages.ok ? stages.data.filter((s) => s.active) : [],
  };
}

/** A lead the team adds; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    SaveLeadDto,
    {
      name: text(form, 'name'),
      email: text(form, 'email'),
      phone: text(form, 'phone'),
      message: text(form, 'message'),
      expectedRevenue: text(form, 'expectedRevenue'),
      deadline: text(form, 'deadline'),
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<{ id: string }>('/leads/manual', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/leads/${createdId}`);
  return result;
}

export default function Leads({ loaderData }: Route.ComponentProps) {
  const { state, leads, stages } = loaderData;
  const [params] = useSearchParams();
  const total = leads.reduce((s, l) => s + Number(l.proratedRevenue ?? 0), 0);
  return (
    <>
      <AdminHeader
        title="Leads"
        intro="Everyone who might buy: from the custom-design form, from custom requests, and the ones you add. Move them through your stages; won when they reach the won stage."
        action={
          <Link
            to="/admin/pipeline"
            className="text-sm underline underline-offset-4"
          >
            Stages and lost reasons
          </Link>
        }
      />
      <nav
        aria-label="Lead state"
        className="mb-6 flex flex-wrap items-center gap-2"
      >
        {STATES.map(([value, label]) => (
          <Link
            key={value}
            to={`?state=${value}`}
            aria-current={state === value ? 'page' : undefined}
            className={`rounded-pill border px-3 py-1 text-sm ${
              state === value
                ? 'border-accent bg-accent text-on-accent'
                : 'border-border text-text-muted hover:text-text'
            }`}
          >
            {label}
          </Link>
        ))}
        {state === 'open' && leads.length > 0 && (
          <span className="ml-auto text-sm text-text-muted">
            Weighted pipeline: <Money amount={total.toFixed(2)} />
          </span>
        )}
      </nav>

      {state === 'open' ? (
        <div className="mb-8 grid gap-4 overflow-x-auto lg:grid-flow-col lg:auto-cols-[minmax(15rem,1fr)]">
          {stages
            .filter((s) => !s.isWon)
            .map((stage) => {
              const here = leads.filter((l) => l.stage.id === stage.id);
              return (
                <section
                  key={stage.id}
                  aria-label={stage.name}
                  className="grid content-start gap-3"
                >
                  <h2 className="font-display text-lg font-bold">
                    {stage.name}{' '}
                    <span className="text-sm font-normal text-text-muted">
                      ({here.length})
                    </span>
                  </h2>
                  {here.map((l) => (
                    <LeadCard key={l.id} lead={l} />
                  ))}
                </section>
              );
            })}
        </div>
      ) : (
        <div className="mb-8 grid gap-3">
          {leads.length === 0 && <p className="text-text-muted">None yet.</p>}
          {leads.map((l) => (
            <LeadCard key={l.id} lead={l} />
          ))}
        </div>
      )}
      {params.get('state') !== 'won' && params.get('state') !== 'lost' && (
        <NewLead />
      )}
    </>
  );
}

function LeadCard({ lead: l }: { lead: LeadListItem }) {
  const late = l.nextActivity && new Date(l.nextActivity.dueAt) < new Date();
  return (
    <Link
      to={`/admin/leads/${l.id}`}
      className="grid gap-1 rounded-lg border border-border bg-surface p-3 text-sm hover:border-accent"
    >
      <span className="font-semibold">{l.name}</span>
      <span className="text-text-muted">{l.messagePreview.slice(0, 90)}</span>
      <span className="flex flex-wrap gap-x-3 text-xs text-text-muted">
        {l.expectedRevenue && (
          <span>
            <Money amount={l.expectedRevenue} /> · {l.probability}%
          </span>
        )}
        {l.source === 'CUSTOM_REQUEST' && <span>Custom request</span>}
        {l.assignedTo && <span>{l.assignedTo.name ?? l.assignedTo.email}</span>}
      </span>
      {l.nextActivity && (
        <span
          className={`text-xs ${late ? 'font-semibold text-danger' : 'text-text-muted'}`}
        >
          Next: {l.nextActivity.summary} (
          {new Date(l.nextActivity.dueAt).toLocaleDateString('en-GB')})
        </span>
      )}
    </Link>
  );
}

function NewLead() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <Panel title="Add a lead">
      <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required error={errors['name']} />
        <Field
          label="Email"
          name="email"
          type="email"
          required
          error={errors['email']}
        />
        <Field
          label="Phone (optional)"
          name="phone"
          type="tel"
          error={errors['phone']}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Expected revenue (USD)"
            name="expectedRevenue"
            inputMode="decimal"
            error={errors['expectedRevenue']}
          />
          <Field
            label="Expected closing"
            name="deadline"
            type="date"
            error={errors['deadline']}
          />
        </div>
        <div className="sm:col-span-2">
          <TextAreaField
            label="What do they need?"
            name="message"
            required
            error={errors['message']}
          />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Add the lead
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}
