import type { LeadListItem, LeadStageView, Page } from '@forgea/types';
import { MoveLeadDto } from '@forgea/validation';
import { Link } from 'react-router';
import { Money } from '~/components/money';
import { buttonClass } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import { save, staffContext, text } from '~/features/admin/staff.server';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import { studioFormat } from '~/lib/studio-time';
import type { Route } from './+types/route';

/**
 * The filters: new leads nobody has opened yet and the ones assigned to me combine with
 * one of open, won or lost (the API takes one of those at a time).
 */
const FILTERS = [
  { key: 'new', label: 'New', apart: true },
  { key: 'mine', label: 'Assigned to me', apart: true },
  { key: 'open', label: 'Open', only: 'state' },
  { key: 'won', label: 'Won', only: 'state' },
  { key: 'lost', label: 'Lost', only: 'state' },
] as const;

const GROUPS = [
  { key: 'stage', label: 'Stage' },
  { key: 'assigned', label: 'Assigned to' },
];

const DEFAULTS = {
  filters: ['open'],
  sorts: ['createdAt', 'name'],
  view: 'kanban',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const query = pageQuery(state, state.view === 'kanban' ? 100 : 50);
  const has = (key: string) => state.filters.includes(key);
  query.set('state', has('won') ? 'won' : has('lost') ? 'lost' : 'open');
  if (has('new')) query.set('unopened', 'true');
  if (has('mine')) query.set('assignedToId', context.get(staffContext).id);
  const [leads, stages, counts] = await Promise.all([
    api.get<Page<LeadListItem>>(`/leads?${query}`),
    api.get<LeadStageView[]>('/lead-stages'),
    api.get<{ unopened: number }>('/leads/counts'),
  ]);
  if (!leads.ok) throw new Response(leads.message, { status: leads.status });
  return {
    state,
    leads: leads.data,
    unopened: counts.ok ? counts.data.unopened : 0,
    stages: stages.ok ? stages.data.filter((s) => s.active) : [],
  };
}

/** A card dragged to another stage on the kanban. Into the won stage wins it. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const id = text(form, 'id') ?? '';
  return save(MoveLeadDto, { stageId: text(form, 'to') }, (dto) =>
    context.get(apiContext).post(`/leads/${encodeURIComponent(id)}/stage`, dto),
  );
}

const COLUMNS: ListColumn<LeadListItem>[] = [
  {
    key: 'name',
    label: 'Lead',
    sort: 'name',
    cell: (l) => (
      <>
        {l.name}
        {l.isNew && (
          <span className="ml-2 rounded-pill bg-accent px-2 text-xs text-on-accent">
            New
          </span>
        )}
        {l.decisionNeeded && l.state === 'open' && (
          <span
            title={l.decisionNeeded}
            className="ml-2 rounded-pill border border-accent px-2 text-xs"
          >
            Needs your decision
          </span>
        )}
      </>
    ),
  },
  { key: 'email', label: 'Email', cell: (l) => l.email },
  { key: 'stage', label: 'Stage', cell: (l) => l.stage.name },
  {
    key: 'assigned',
    label: 'Assigned to',
    cell: (l) =>
      l.assignedTo ? (
        (l.assignedTo.name ?? l.assignedTo.email)
      ) : (
        <span className="text-text-muted">Nobody</span>
      ),
  },
  {
    key: 'next',
    label: 'Next activity',
    cell: (l) => <NextActivity lead={l} />,
  },
  {
    key: 'revenue',
    label: 'Expected',
    align: 'right',
    cell: (l) =>
      l.expectedRevenue ? (
        <>
          <Money amount={l.expectedRevenue} />{' '}
          <span className="text-text-muted">· {l.probability}%</span>
        </>
      ) : (
        '—'
      ),
  },
  {
    key: 'created',
    label: 'Came in',
    sort: 'createdAt',
    cell: (l) => (
      <span className="text-text-muted">
        {studioFormat({ dateStyle: 'short' }).format(new Date(l.createdAt))}
      </span>
    ),
  },
];

const href = (l: LeadListItem) => `/admin/leads/${l.id}`;

export default function Leads({ loaderData }: Route.ComponentProps) {
  const { state, leads, stages, unopened } = loaderData;
  const mayWork = useCan()('leads.manage');
  const weighted = leads.items.reduce(
    (s, l) => s + Number(l.proratedRevenue ?? 0),
    0,
  );
  return (
    <>
      <AdminHeader
        title="Leads"
        intro="Everyone who might buy: from the custom-design form, from custom requests, and the ones you add. Drag them through your stages; won when they reach the won stage."
        action={
          <>
            <Link
              to="/admin/lead-stages"
              className="text-sm underline underline-offset-4"
            >
              Stages and lost reasons
            </Link>
            {mayWork && (
              <Link to="/admin/leads/new" className={buttonClass()}>
                New lead
              </Link>
            )}
          </>
        }
      />
      <ControlPanel
        state={state}
        search="Name or email"
        filters={FILTERS.map((f) =>
          f.key === 'new' ? { ...f, count: unopened } : f,
        )}
        groups={GROUPS}
        views={['kanban', 'list']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: leads.items.length,
                nextCursor: leads.nextCursor,
              },
            }
          : {})}
      />
      {weighted > 0 && (
        <p className="mb-4 text-right text-sm text-text-muted">
          Weighted pipeline: <Money amount={weighted.toFixed(2)} />
        </p>
      )}
      {state.view === 'kanban' ? (
        <KanbanView
          move={mayWork}
          href={href}
          columns={stages.map((s) => ({
            key: s.id,
            title: s.name,
            items: leads.items.filter((l) => l.stage.id === s.id),
          }))}
          title={(l) => (l.isNew ? `${l.name} · New` : l.name)}
          card={(l) => (
            <>
              <span className="text-text-muted">
                {l.messagePreview.slice(0, 90)}
              </span>
              <span className="flex flex-wrap gap-x-3 text-xs text-text-muted">
                {l.expectedRevenue && (
                  <span>
                    <Money amount={l.expectedRevenue} /> · {l.probability}%
                  </span>
                )}
                {l.source === 'CUSTOM_REQUEST' && <span>Custom request</span>}
                {l.assignedTo && (
                  <span>{l.assignedTo.name ?? l.assignedTo.email}</span>
                )}
              </span>
              <NextActivity lead={l} />
            </>
          )}
        />
      ) : (
        <ListView
          remove="lead"
          label="Leads"
          rows={leads.items}
          columns={COLUMNS}
          href={href}
          state={state}
          empty={
            state.filters.includes('new')
              ? 'No new leads: every one has been opened.'
              : 'No leads here.'
          }
          group={(k) =>
            k === 'stage'
              ? { of: (l) => l.stage.name, order: stages.map((s) => s.name) }
              : k === 'assigned'
                ? {
                    of: (l) =>
                      l.assignedTo
                        ? (l.assignedTo.name ?? l.assignedTo.email)
                        : 'Nobody',
                  }
                : undefined
          }
        />
      )}
    </>
  );
}

function NextActivity({ lead: l }: { lead: LeadListItem }) {
  if (!l.nextActivity) return null;
  const late = new Date(l.nextActivity.dueAt) < new Date();
  return (
    <span
      className={`text-xs ${late ? 'font-semibold text-danger' : 'text-text-muted'}`}
    >
      {l.nextActivity.summary} (
      {studioFormat({ dateStyle: 'short' }).format(
        new Date(l.nextActivity.dueAt),
      )}
      )
    </span>
  );
}
