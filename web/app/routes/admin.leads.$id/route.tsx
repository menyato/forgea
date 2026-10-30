import type { LeadDetail, LeadStageView, LostReasonView } from '@forgea/types';
import {
  AddActivityDto,
  AddNoteDto,
  LoseLeadDto,
  MoveLeadDto,
} from '@forgea/validation';
import { data, Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { Field, SelectField, TextAreaField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [lead, stages, reasons] = await Promise.all([
    api.get<LeadDetail>(`/leads/${encodeURIComponent(params.id)}`),
    api.get<LeadStageView[]>('/lead-stages'),
    api.get<LostReasonView[]>('/lost-reasons'),
  ]);
  if (!lead.ok) throw new Response(lead.message, { status: lead.status });
  return {
    lead: lead.data,
    stages: stages.ok ? stages.data.filter((s) => s.active) : [],
    reasons: reasons.ok ? reasons.data.filter((r) => r.active) : [],
  };
}

/** stage | lose | restore | activity | done | note */
export async function action({ request, params, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const base = `/leads/${encodeURIComponent(params.id)}`;
  const form = await request.formData();
  switch (form.get('intent')) {
    case 'stage':
      return save(MoveLeadDto, { stageId: text(form, 'stageId') }, (dto) =>
        api.post(`${base}/stage`, dto),
      );
    case 'lose':
      return save(
        LoseLeadDto,
        { lostReasonId: text(form, 'lostReasonId'), note: text(form, 'note') },
        (dto) => api.post(`${base}/lose`, dto),
      );
    case 'restore': {
      const r = await api.post(`${base}/restore`);
      return r.ok
        ? data<SaveResult>({ ok: true })
        : data<SaveResult>({ error: r.message }, { status: r.status });
    }
    case 'activity': {
      const due = text(form, 'dueAt');
      return save(
        AddActivityDto,
        {
          kind: text(form, 'kind'),
          summary: text(form, 'summary'),
          dueAt: due ? new Date(due).toISOString() : undefined,
        },
        (dto) => api.post(`${base}/activities`, dto),
      );
    }
    case 'done': {
      const r = await api.post(
        `${base}/activities/${encodeURIComponent(text(form, 'activityId') ?? '')}/done`,
      );
      return r.ok
        ? data<SaveResult>({ ok: true })
        : data<SaveResult>({ error: r.message }, { status: r.status });
    }
    default:
      return save(AddNoteDto, { body: text(form, 'body') }, (dto) =>
        api.post(`${base}/notes`, dto),
      );
  }
}

const KIND_LABELS = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  TODO: 'To-do',
} as const;

export default function LeadPage({ loaderData }: Route.ComponentProps) {
  const { lead: l, stages, reasons } = loaderData;
  const move = useFetcher<SaveResult>();
  const restore = useFetcher<SaveResult>();
  const can = useCan();
  const mayWork = can('leads.manage');
  return (
    <>
      <AdminHeader
        title={l.name}
        intro={`${l.email}${l.phone ? ` · ${l.phone}` : ''} · ${l.state === 'open' ? `${l.stage.name}, ${l.probability}%` : l.state === 'won' ? 'Won' : `Lost: ${l.lostReason}`}`}
        action={
          <Link
            to="/admin/leads"
            className="text-sm underline underline-offset-4"
          >
            All leads
          </Link>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="grid content-start gap-6">
          <Panel title="Stage">
            {!mayWork ? (
              <p className="text-sm">
                {l.state === 'open'
                  ? `${l.stage.name}, ${l.probability}%`
                  : l.state === 'won'
                    ? 'This lead was won.'
                    : `Lost: ${l.lostReason}.`}
              </p>
            ) : l.state === 'open' ? (
              <move.Form method="post" className="flex flex-wrap gap-2">
                <input type="hidden" name="intent" value="stage" />
                {stages.map((s) => (
                  <Button
                    key={s.id}
                    type="submit"
                    name="stageId"
                    value={s.id}
                    variant={s.id === l.stage.id ? 'primary' : 'secondary'}
                    disabled={s.id === l.stage.id || move.state !== 'idle'}
                    aria-pressed={s.id === l.stage.id}
                  >
                    {s.isWon ? `${s.name} (won)` : s.name}
                  </Button>
                ))}
              </move.Form>
            ) : (
              <restore.Form method="post" className="flex items-center gap-3">
                <input type="hidden" name="intent" value="restore" />
                <p className="text-sm">
                  {l.state === 'won'
                    ? 'This lead was won.'
                    : `Lost: ${l.lostReason}.`}
                </p>
                <Button type="submit" variant="secondary">
                  Reopen it
                </Button>
              </restore.Form>
            )}
            <SaveStatus state={move.state} result={move.data ?? restore.data} />
          </Panel>

          <Panel title="What they asked">
            <p className="whitespace-pre-line">{l.message}</p>
            <p className="text-sm text-text-muted">
              {l.expectedRevenue && (
                <>
                  Expected <Money amount={l.expectedRevenue} />, weighted{' '}
                  <Money amount={l.proratedRevenue ?? '0'} />.{' '}
                </>
              )}
              {l.deadline && `Expected to close by ${l.deadline}. `}
              {l.budgetRange && `Budget: ${l.budgetRange}. `}
              {l.customRequestNumber &&
                `From custom request ${l.customRequestNumber}.`}
            </p>
          </Panel>

          <Panel title="Quotations">
            {l.quotations.length === 0 ? (
              <p className="text-sm text-text-muted">None yet.</p>
            ) : (
              <ul className="grid gap-1 text-sm">
                {l.quotations.map((q) => (
                  <li key={q.id}>
                    <Link
                      to={`/admin/quotations/${q.id}`}
                      className="font-mono underline"
                    >
                      {q.number}
                    </Link>{' '}
                    · {q.status.toLowerCase()} · <Money amount={q.total} />
                  </li>
                ))}
              </ul>
            )}
            {can('quotations.manage') && (
              <Link
                to={`/admin/quotations/new?lead=${l.id}&email=${encodeURIComponent(l.customer?.email ?? l.email)}&name=${encodeURIComponent(l.name)}`}
                className={buttonClass('secondary', 'justify-self-start')}
              >
                Write a quotation
              </Link>
            )}
          </Panel>

          <Panel title="Log">
            <ol className="grid gap-3 border-l border-border pl-4 text-sm">
              {l.notes.map((n) => (
                <li key={n.id}>
                  <p className="whitespace-pre-line">{n.body}</p>
                  <p className="text-xs text-text-muted">
                    {new Date(n.createdAt).toLocaleString('en-GB')}
                    {n.author ? ` · ${n.author}` : ''}
                  </p>
                </li>
              ))}
            </ol>
            {mayWork && <NoteForm />}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel title="Follow-ups">
            <ul className="grid gap-2 text-sm">
              {l.activities.map((a) => (
                <ActivityRow key={a.id} activity={a} mayWork={mayWork} />
              ))}
            </ul>
            {mayWork && <ActivityForm />}
          </Panel>
          {mayWork && l.state === 'open' && reasons.length > 0 && (
            <LoseForm reasons={reasons} />
          )}
        </div>
      </div>
    </>
  );
}

function ActivityRow({
  activity: a,
  mayWork,
}: {
  activity: LeadDetail['activities'][number];
  mayWork: boolean;
}) {
  const fetcher = useFetcher<SaveResult>();
  const late = !a.doneAt && new Date(a.dueAt) < new Date();
  return (
    <li className="flex items-start justify-between gap-2">
      <span
        className={
          a.doneAt ? 'text-text-muted line-through' : late ? 'text-danger' : ''
        }
      >
        {KIND_LABELS[a.kind]}: {a.summary}
        <span className="block text-xs text-text-muted">
          {new Date(a.dueAt).toLocaleString('en-GB')}
          {a.assignedTo ? ` · ${a.assignedTo}` : ''}
        </span>
      </span>
      {!a.doneAt && mayWork && (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="done" />
          <input type="hidden" name="activityId" value={a.id} />
          <Button
            type="submit"
            variant="secondary"
            className="px-2 py-1 text-xs"
          >
            Done
          </Button>
        </fetcher.Form>
      )}
    </li>
  );
}

function ActivityForm() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form
      method="post"
      key={fetcher.data?.ok ? 'reset' : 'form'}
      className="grid gap-3 border-t border-border pt-4"
    >
      <input type="hidden" name="intent" value="activity" />
      <SelectField label="Plan a" name="kind" defaultValue="CALL">
        {Object.entries(KIND_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      <Field label="About" name="summary" required error={errors['summary']} />
      <Field
        label="When"
        name="dueAt"
        type="datetime-local"
        required
        error={errors['dueAt']}
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={fetcher.state !== 'idle'}
      >
        Add the follow-up
      </Button>
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </fetcher.Form>
  );
}

function NoteForm() {
  const fetcher = useFetcher<SaveResult>();
  return (
    <fetcher.Form
      method="post"
      key={fetcher.data?.ok ? 'reset' : 'form'}
      className="grid gap-2"
    >
      <input type="hidden" name="intent" value="note" />
      <TextAreaField
        label="Add a note"
        name="body"
        rows={2}
        required
        error={fetcher.data?.errors?.['body']}
      />
      <Button
        type="submit"
        variant="secondary"
        className="justify-self-start"
        disabled={fetcher.state !== 'idle'}
      >
        Save the note
      </Button>
    </fetcher.Form>
  );
}

function LoseForm({ reasons }: { reasons: LostReasonView[] }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title="Lost it?">
      <fetcher.Form method="post" className="grid gap-3">
        <input type="hidden" name="intent" value="lose" />
        <SelectField label="Why" name="lostReasonId">
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Note (optional)" name="note" rows={2} />
        <Button
          type="submit"
          variant="secondary"
          disabled={fetcher.state !== 'idle'}
        >
          Mark as lost
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </fetcher.Form>
    </Panel>
  );
}
