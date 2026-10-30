import type { LeadListItem, LeadStageView, Page } from '@forgea/types';
import { SaveLeadDto } from '@forgea/validation';
import { Link, redirect, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { Field, TextAreaField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  type SaveResult,
  save,
  staffContext,
  text,
} from '~/features/admin/staff.server';
import { ViewTabs } from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/**
 * The tabs: new leads nobody has opened yet, the ones assigned to me, the whole pipeline as
 * a board by stage, and the closed ones.
 */
const TABS = [
  { key: 'new', label: 'New', state: 'open' },
  { key: 'mine', label: 'Assigned to me', state: 'open' },
  { key: 'open', label: 'Pipeline', state: 'open' },
  { key: 'won', label: 'Won', state: 'won' },
  { key: 'lost', label: 'Lost', state: 'lost' },
] as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  // "?state=" was the old address of these tabs; it still works.
  const key =
    url.searchParams.get('tab') ?? url.searchParams.get('state') ?? 'open';
  const tab = TABS.find((t) => t.key === key) ?? TABS[2];
  const query = new URLSearchParams({ limit: '100', state: tab.state });
  if (tab.key === 'new') query.set('unopened', 'true');
  if (tab.key === 'mine')
    query.set('assignedToId', context.get(staffContext).id);
  const q = url.searchParams.get('q');
  if (q) query.set('q', q);
  const [leads, stages, counts] = await Promise.all([
    api.get<Page<LeadListItem>>(`/leads?${query}`),
    api.get<LeadStageView[]>('/lead-stages'),
    api.get<{ unopened: number }>('/leads/counts'),
  ]);
  if (!leads.ok) throw new Response(leads.message, { status: leads.status });
  return {
    tab: tab.key,
    state: tab.state,
    leads: leads.data.items,
    unopened: counts.ok ? counts.data.unopened : 0,
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
  const { tab, leads, stages, unopened } = loaderData;
  const mayWork = useCan()('leads.manage');
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
      <ViewTabs
        label="Lead groups"
        current={tab}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          ...(t.key === 'new' ? { count: unopened } : {}),
        }))}
      />
      {tab === 'open' && leads.length > 0 && (
        <p className="mb-4 text-right text-sm text-text-muted">
          Weighted pipeline: <Money amount={total.toFixed(2)} />
        </p>
      )}

      {tab === 'open' ? (
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
          {leads.length === 0 && (
            <p className="text-text-muted">
              {tab === 'new'
                ? 'No new leads: every one has been opened.'
                : tab === 'mine'
                  ? 'No open leads are assigned to you.'
                  : 'None yet.'}
            </p>
          )}
          {leads.map((l) => (
            <LeadCard key={l.id} lead={l} />
          ))}
        </div>
      )}
      {mayWork && tab !== 'won' && tab !== 'lost' && <NewLead />}
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
      <span className="flex items-center justify-between gap-2 font-semibold">
        {l.name}
        {l.isNew && (
          <span className="rounded-pill bg-accent px-2 text-xs text-on-accent">
            New
          </span>
        )}
      </span>
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
