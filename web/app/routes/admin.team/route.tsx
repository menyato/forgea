import { type Page, Role, type UserListItem } from '@forgea/types';
import { AddTeamMemberDto, UpdateTeamMemberDto } from '@forgea/validation';
import { Form, useFetcher, useSearchParams } from 'react-router';
import { Button, buttonClass } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  staffContext,
  text,
} from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const list = (role: Role, q?: string | null) =>
    api.get<Page<UserListItem>>(
      `/users?${new URLSearchParams({ role, limit: '100', ...(q ? { q } : {}) })}`,
    );
  const results = await Promise.all([
    ...TEAM_ROLES.map((r) => list(r)),
    list(Role.CUSTOMER, url.searchParams.get('q')),
  ]);
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok)
    throw new Response(failed.message, { status: failed.status });
  const items = results.map((r) => (r.ok ? r.data.items : []));
  return {
    team: items.slice(0, TEAM_ROLES.length).flat(),
    customers: items.at(-1) ?? [],
    me: context.get(staffContext).id,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const id = text(form, 'id');
  if (id) {
    return save(
      UpdateTeamMemberDto,
      { role: text(form, 'role'), active: checked(form, 'active') },
      (dto) => api.put(`/users/${encodeURIComponent(id)}/team`, dto),
    );
  }
  return save(
    AddTeamMemberDto,
    {
      email: text(form, 'email'),
      name: text(form, 'name'),
      role: text(form, 'role'),
    },
    (dto) => api.post('/users/team', dto),
  );
}

const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin: everything, including money and the team',
  [Role.STAFF]: 'Staff: orders, production and quotes',
  [Role.DESIGNER]: 'Designer: the catalog and request designs',
  [Role.CUSTOMER]: 'Customer',
};
const TEAM_ROLES = [Role.STAFF, Role.DESIGNER, Role.ADMIN] as const;

export default function Team({ loaderData }: Route.ComponentProps) {
  const { team, customers, me } = loaderData;
  const [params] = useSearchParams();
  return (
    <>
      <AdminHeader
        title="Team"
        intro="Who can open the dashboard and what they can do. Team members sign in with their Google Workspace account only; add their address here first."
      />
      <div className="grid gap-6">
        <AddMember />
        <Panel title="The team">
          <ul className="grid gap-4">
            {team.map((u) => (
              <MemberRow key={u.id} user={u} isMe={u.id === me} />
            ))}
          </ul>
        </Panel>
        <Panel title="Customer accounts">
          <Form method="get" role="search" className="flex items-end gap-2">
            <Field
              label="Email or name"
              name="q"
              type="search"
              defaultValue={params.get('q') ?? ''}
            />
            <button type="submit" className={buttonClass('secondary')}>
              Search
            </button>
          </Form>
          <ul className="grid gap-1 text-sm">
            {customers.map((u) => (
              <li key={u.id}>
                {u.email}
                {u.name && ` · ${u.name}`}
                {u.phone && ` · ${u.phone}`}
                <span className="text-text-muted">
                  {' '}
                  · signs in with {u.signIn.join(' and ') || 'nothing yet'}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function AddMember() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <Panel title="Add a team member">
      <fetcher.Form
        method="post"
        key={fetcher.data?.ok ? 'reset' : 'form'}
        className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end"
      >
        <Field
          label="Workspace email"
          name="email"
          type="email"
          required
          error={errors['email']}
        />
        <Field label="Name (optional)" name="name" error={errors['name']} />
        <SelectField
          label="Role"
          name="role"
          defaultValue={Role.STAFF}
          error={errors['role']}
        >
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          Add
        </Button>
      </fetcher.Form>
      <SaveStatus state={fetcher.state} result={fetcher.data} />
    </Panel>
  );
}

function MemberRow({ user, isMe }: { user: UserListItem; isMe: boolean }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <li className="grid gap-2 border-b border-border pb-4 last:border-0">
      <p>
        <span className="font-semibold">{user.name ?? user.email}</span>
        <span className="block text-sm text-text-muted">
          {user.email}
          {user.signIn.length === 0 && ' · has not signed in yet'}
          {user.disabled && ' · access switched off'}
        </span>
      </p>
      {isMe ? (
        <p className="text-sm text-text-muted">
          {ROLE_LABELS[user.role]} (you)
        </p>
      ) : (
        <fetcher.Form method="post" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={user.id} />
          <SelectField label="Role" name="role" defaultValue={user.role}>
            {TEAM_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={!user.disabled}
            />{' '}
            Can sign in
          </label>
          <Button
            type="submit"
            variant="secondary"
            disabled={fetcher.state !== 'idle'}
          >
            Save
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </fetcher.Form>
      )}
    </li>
  );
}
