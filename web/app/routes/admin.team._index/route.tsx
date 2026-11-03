import { type Page, Role, type UserListItem } from '@forgea/types';
import { Link } from 'react-router';
import { buttonClass } from '~/components/ui/button';
import { AdminHeader } from '~/features/admin/admin-ui';
import { listState, localList } from '~/features/admin/list-state';
import { staffContext } from '~/features/admin/staff.server';
import {
  ControlPanel,
  KanbanView,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { ROLE_NAMES, TEAM_ROLES } from '~/features/team/roles';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/**
 * The team, or customer accounts instead (one at a time). Roles add up ("Staff or
 * Designer"); "Access switched off" narrows them.
 */
const FILTERS = [
  { key: 'team', label: 'Team', only: 'who' },
  { key: 'customers', label: 'Customer accounts', only: 'who' },
  ...TEAM_ROLES.map((r) => ({ key: r, label: ROLE_NAMES[r] })),
  { key: 'disabled', label: 'Access switched off', apart: true },
];

const GROUPS = [{ key: 'role', label: 'Role' }];

const DEFAULTS = {
  filters: ['team'],
  sorts: ['name', 'email', 'createdAt'],
  order: 'asc',
} as const;

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const me = context.get(staffContext).id;
  const has = (key: string) => state.filters.includes(key);

  if (has('customers')) {
    // Customers can be many: the API searches and pages them.
    const query = new URLSearchParams({ role: Role.CUSTOMER, limit: '50' });
    if (state.q) query.set('q', state.q);
    if (state.cursor) query.set('cursor', state.cursor);
    const r = await api.get<Page<UserListItem>>(`/users?${query}`);
    if (!r.ok) throw new Response(r.message, { status: r.status });
    return {
      state,
      me,
      customers: true,
      people: {
        items: r.data.items,
        total: undefined,
        nextCursor: r.data.nextCursor,
      },
    };
  }

  const results = await Promise.all(
    TEAM_ROLES.map((role) =>
      api.get<Page<UserListItem>>(
        `/users?${new URLSearchParams({ role, limit: '100' })}`,
      ),
    ),
  );
  const team: UserListItem[] = [];
  for (const r of results) {
    if (!r.ok) throw new Response(r.message, { status: r.status });
    team.push(...r.data.items);
  }
  const roles = TEAM_ROLES.filter((r) => has(r));
  const shown = team.filter(
    (u) =>
      (roles.length === 0 || roles.some((r) => r === u.role)) &&
      (!has('disabled') || u.disabled),
  );
  return {
    state,
    me,
    customers: false,
    people: localList(shown, state, {
      text: (u) => `${u.name ?? ''} ${u.email}`,
      sorts: {
        name: (u) => (u.name ?? u.email).toLowerCase(),
        email: (u) => u.email,
        createdAt: (u) => u.createdAt,
      },
    }),
  };
}

const signIn = (u: UserListItem) =>
  u.signIn.length === 0 ? 'Not signed in yet' : u.signIn.join(' and ');

const href = (u: UserListItem) => `/admin/team/${u.id}`;

export default function Team({ loaderData }: Route.ComponentProps) {
  const { state, me, customers, people } = loaderData;
  const columns: ListColumn<UserListItem>[] = [
    {
      key: 'name',
      label: 'Name',
      ...(customers ? {} : { sort: 'name' }),
      cell: (u) => u.name ?? u.email,
    },
    {
      key: 'email',
      label: 'Email',
      ...(customers ? {} : { sort: 'email' }),
      cell: (u) => u.email,
    },
    customers
      ? { key: 'phone', label: 'Phone', cell: (u) => u.phone ?? '—' }
      : {
          key: 'role',
          label: 'Role',
          cell: (u) => `${ROLE_NAMES[u.role]}${u.id === me ? ' (you)' : ''}`,
        },
    { key: 'signIn', label: 'Signs in with', cell: signIn },
    {
      key: 'access',
      label: 'Access',
      cell: (u) =>
        u.disabled ? (
          <span className="text-danger">Switched off</span>
        ) : customers ? (
          <span className="text-text-muted">Shop only</span>
        ) : (
          'Dashboard'
        ),
    },
  ];
  return (
    <>
      <AdminHeader
        title="Team"
        intro="Who can open the dashboard. Team members sign in with their Google Workspace account only; add their address first. What each role may do is set on Roles & permissions; open a person to change their role or their own exceptions."
        action={
          <Link to="/admin/team/new" className={buttonClass()}>
            Add a member
          </Link>
        }
      />
      <ControlPanel
        state={state}
        search="Name or email"
        filters={FILTERS}
        groups={customers ? [] : GROUPS}
        views={['list', 'kanban']}
        {...(state.view === 'list'
          ? {
              page: {
                shown: people.items.length,
                total: people.total,
                nextCursor: people.nextCursor,
              },
            }
          : {})}
      />
      {state.view === 'kanban' ? (
        <KanbanView
          href={href}
          layout={state.group === 'role' && !customers ? 'columns' : 'grid'}
          columns={
            state.group === 'role' && !customers
              ? TEAM_ROLES.map((r) => ({
                  key: r,
                  title: ROLE_NAMES[r],
                  items: people.items.filter((u) => u.role === r),
                }))
              : [{ key: 'all', title: 'People', items: people.items }]
          }
          title={(u) => u.name ?? u.email}
          card={(u) => (
            <>
              <span className="truncate text-text-muted">{u.email}</span>
              <span className="flex flex-wrap gap-x-3 text-xs text-text-muted">
                <span>
                  {ROLE_NAMES[u.role]}
                  {u.id === me && ' (you)'}
                </span>
                <span>{signIn(u)}</span>
                {u.disabled && (
                  <span className="text-danger">Access switched off</span>
                )}
              </span>
            </>
          )}
        />
      ) : (
        <ListView
          label={customers ? 'Customer accounts' : 'Team'}
          rows={people.items}
          columns={columns}
          href={href}
          state={state}
          empty={customers ? 'No customer accounts found.' : 'Nobody here.'}
          group={
            state.group === 'role' && !customers
              ? {
                  of: (u) => ROLE_NAMES[u.role],
                  order: TEAM_ROLES.map((r) => ROLE_NAMES[r]),
                }
              : undefined
          }
        />
      )}
    </>
  );
}
