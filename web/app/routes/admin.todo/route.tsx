import type { TodoItem } from '@forgea/types';
import { data, Link, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel } from '~/features/admin/admin-ui';
import { FOLLOW_UP_KINDS, followUpTime } from '~/features/admin/follow-ups';
import { type SaveResult, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import { studioDay } from '~/lib/studio-time';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const who = url.searchParams.get('who') === 'all' ? 'all' : 'mine';
  const items = await context
    .get(apiContext)
    .get<TodoItem[]>(`/leads/activities?who=${who}`);
  if (!items.ok) throw new Response(items.message, { status: items.status });
  return { who, items: items.data, now: new Date().toISOString() };
}

/** Marks a follow-up done (it is written in its lead's log). */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const lead = encodeURIComponent(text(form, 'leadId') ?? '');
  const id = encodeURIComponent(text(form, 'activityId') ?? '');
  const r = await context
    .get(apiContext)
    .post(`/leads/${lead}/activities/${id}/done`);
  return r.ok
    ? data<SaveResult>({ ok: true })
    : data<SaveResult>({ error: r.message }, { status: r.status });
}

const tab =
  'rounded-md px-3 py-1.5 text-sm aria-[current=page]:bg-surface-raised aria-[current=page]:font-medium';

export default function Todo({ loaderData }: Route.ComponentProps) {
  const { who, items, now } = loaderData;
  const today = studioDay(now);
  const late = items.filter((i) => i.dueAt < now);
  const todays = items.filter(
    (i) => i.dueAt >= now && studioDay(i.dueAt) === today,
  );
  const later = items.filter((i) => studioDay(i.dueAt) > today);
  const all = who === 'all';
  return (
    <>
      <AdminHeader
        title="To-do"
        intro="The follow-ups planned on open leads, soonest first. Done ones are written in the lead's log."
        action={
          <nav aria-label="Whose follow-ups" className="flex gap-2">
            <Link
              to="?who=mine"
              aria-current={all ? undefined : 'page'}
              className={tab}
            >
              Mine
            </Link>
            <Link
              to="?who=all"
              aria-current={all ? 'page' : undefined}
              className={tab}
            >
              Everyone's
            </Link>
          </nav>
        }
      />
      {items.length === 0 ? (
        <p className="text-text-muted">
          Nothing to do. Plan follow-ups from a lead's page.
        </p>
      ) : (
        <div className="grid gap-6">
          <Section title="Late" items={late} late showWho={all} />
          <Section title="Today" items={todays} showWho={all} />
          <Section title="Coming up" items={later} showWho={all} />
        </div>
      )}
    </>
  );
}

function Section({
  title,
  items,
  late = false,
  showWho,
}: {
  title: string;
  items: TodoItem[];
  late?: boolean;
  showWho: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Panel title={`${title} (${items.length})`}>
      <ul className="grid gap-3 text-sm">
        {items.map((i) => (
          <Row key={i.id} item={i} late={late} showWho={showWho} />
        ))}
      </ul>
    </Panel>
  );
}

function Row({
  item: i,
  late,
  showWho,
}: {
  item: TodoItem;
  late: boolean;
  showWho: boolean;
}) {
  const can = useCan();
  const fetcher = useFetcher<SaveResult>();
  if (fetcher.data?.ok) return null;
  return (
    <li className="flex items-start justify-between gap-3">
      <span>
        <span className={late ? 'text-danger' : ''}>
          {FOLLOW_UP_KINDS[i.kind]}: {i.summary}
        </span>
        <span className="block text-xs text-text-muted">
          {followUpTime.format(new Date(i.dueAt))} ·{' '}
          <Link to={`/admin/leads/${i.lead.id}`} className="underline">
            {i.lead.name}
          </Link>{' '}
          ({i.lead.stage}){showWho && i.assignedTo ? ` · ${i.assignedTo}` : ''}
        </span>
        {fetcher.data?.error && (
          <span className="block text-xs text-danger">
            {fetcher.data.error}
          </span>
        )}
      </span>
      {can('leads.manage') && (
        <fetcher.Form method="post">
          <input type="hidden" name="leadId" value={i.lead.id} />
          <input type="hidden" name="activityId" value={i.id} />
          <Button
            type="submit"
            variant="secondary"
            className="px-2 py-1 text-xs"
            disabled={fetcher.state !== 'idle'}
            aria-label={`Done: ${i.summary}`}
          >
            Done
          </Button>
        </fetcher.Form>
      )}
    </li>
  );
}
