import type { FreeOfferView } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import { studioDateTime } from '~/lib/studio-time';
import type { Route } from './+types/route';

const FILTERS = [
  { key: 'running', label: 'Running now', only: 'when' },
  { key: 'coming', label: 'Not started', only: 'when' },
  { key: 'over', label: 'Ended or off', only: 'when' },
];

const DEFAULTS = { sorts: ['startsAt', 'title'], order: 'desc' } as const;

/** Where an offer stands at `now`. */
const stage = (o: FreeOfferView, now: number) =>
  !o.active || new Date(o.endsAt).getTime() <= now
    ? 'over'
    : new Date(o.startsAt).getTime() > now
      ? 'coming'
      : 'running';

export async function loader({ url, context }: Route.LoaderArgs) {
  const state = listState(url.searchParams, DEFAULTS);
  const r = await context.get(apiContext).get<FreeOfferView[]>('/offers');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const now = Date.now();
  const wanted = FILTERS.map((f) => f.key).filter((k) =>
    state.filters.includes(k),
  );
  const items = r.data.filter(
    (o) => wanted.length === 0 || wanted.includes(stage(o, now)),
  );
  return {
    state,
    now,
    offers: localList(
      items,
      state,
      {
        text: (o) => `${o.title} ${o.productName}`,
        sorts: { startsAt: (o) => o.startsAt, title: (o) => o.title },
      },
      state.view === 'kanban' ? 200 : 50,
    ),
  };
}

const STAGE_LABELS = {
  running: 'Running',
  coming: 'Not started',
  over: 'Ended or off',
} as const;

const href = (o: FreeOfferView) => `/admin/offers/${o.id}`;

export default function Offers({ loaderData }: Route.ComponentProps) {
  const { state, offers, now } = loaderData;
  const columns: ListColumn<FreeOfferView>[] = [
    { key: 'title', label: 'Offer', sort: 'title', cell: (o) => o.title },
    { key: 'product', label: 'Piece', cell: (o) => o.productName },
    {
      key: 'startsAt',
      label: 'Runs',
      sort: 'startsAt',
      cell: (o) =>
        `${studioDateTime(o.startsAt)} to ${studioDateTime(o.endsAt)}`,
    },
    {
      key: 'claimed',
      label: 'Claimed',
      align: 'right',
      cell: (o) => `${o.claimed}${o.maxClaims ? ` / ${o.maxClaims}` : ''}`,
    },
    {
      key: 'stage',
      label: 'Now',
      cell: (o) => STAGE_LABELS[stage(o, now)],
    },
  ];
  return (
    <>
      <AdminHeader
        title="Free offers"
        intro="A piece given free for a limited time, one per customer. While one runs, the shop shows a banner and the piece's page a Claim it free button."
        action={
          <Link to="/admin/offers/new" className={buttonClass()}>
            New offer
          </Link>
        }
      />
      <ControlPanel
        state={state}
        search="Offer or piece"
        filters={FILTERS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: offers.items.length,
                total: offers.total,
                nextCursor: offers.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          columns={(['running', 'coming', 'over'] as const).map((key) => ({
            key,
            title: STAGE_LABELS[key],
            items: offers.items.filter((o) => stage(o, now) === key),
          }))}
          title={(o) => o.title}
          card={(o) => (
            <>
              <span>{o.productName}</span>
              <span className="text-text-muted">
                Until {studioDateTime(o.endsAt)} · {o.claimed} claimed
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label="Free offers"
          rows={offers.items}
          columns={columns}
          href={href}
          state={state}
          empty="No offers here. Add one with New offer."
        />
      )}
    </>
  );
}
