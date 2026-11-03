import {
  effectivePermissions,
  type Permission,
  PERMISSION_GROUPS,
  PERMISSIONS,
  Role,
  type TeamAccess,
} from '@forgea/types';
import { SaveTeamAccessDto, UpdateTeamMemberDto } from '@forgea/validation';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, SelectField } from '~/components/ui/field';
import { includesText } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  staffContext,
  text,
} from '~/features/admin/staff.server';
import { ROLE_LABELS, TEAM_ROLES } from '~/features/team/roles';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const access = await context
    .get(apiContext)
    .get<TeamAccess>(`/users/${encodeURIComponent(params.id)}/access`);
  if (!access.ok) throw new Response(access.message, { status: access.status });
  return {
    access: access.data,
    isMe: access.data.id === context.get(staffContext).id,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  if (form.get('intent') === 'team') {
    return save(
      UpdateTeamMemberDto,
      { role: text(form, 'role'), active: checked(form, 'active') },
      (dto) => api.put(`/users/${encodeURIComponent(params.id)}/team`, dto),
    );
  }
  const pick = (choice: Choice) =>
    PERMISSIONS.filter((p) => form.get(p) === choice);
  return save(
    SaveTeamAccessDto,
    { granted: pick('grant'), denied: pick('deny') },
    (dto) => api.put(`/users/${encodeURIComponent(params.id)}/access`, dto),
  );
}

type Choice = 'role' | 'grant' | 'deny';

export default function MemberAccess({ loaderData }: Route.ComponentProps) {
  const { access, isMe } = loaderData;
  const title = access.name ?? access.email;
  const editable =
    !isMe && (access.role === Role.STAFF || access.role === Role.DESIGNER);
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Team', to: '/admin/team' }]}
        title={`Access: ${title}`}
        intro="What this person may see and do: their role's permissions, plus anything you allow here, minus anything you deny. A denial always wins. Changes apply on their next click."
      />
      <div className="grid gap-6">
        {!isMe && access.role !== Role.CUSTOMER && (
          <MemberForm key={access.id} access={access} />
        )}
        {editable ? (
          // After a save the choices already show what was stored; a new person, a new form.
          <AccessForm key={access.id} access={access} />
        ) : (
          <Panel>
            <p>
              {isMe
                ? 'You cannot change your own access; ask another admin.'
                : access.role === Role.ADMIN
                  ? 'Admins can do everything. To limit what they see, make them staff or a designer above.'
                  : 'Customers have no dashboard access.'}
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}

/** Their role and whether they may sign in at all. */
function MemberForm({ access }: { access: TeamAccess }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="team" />
      <Panel title="Role and sign-in">
        <p className="text-sm text-text-muted">
          {access.email}
          {access.disabled && ' · access switched off'}
        </p>
        <SelectField
          label="Role"
          name="role"
          defaultValue={access.role}
          error={errors['role']}
        >
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </SelectField>
        <CheckboxField
          label="Can sign in"
          name="active"
          hint="Switched off, they can no longer open the dashboard; nothing they did is lost."
          defaultChecked={!access.disabled}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </Panel>
    </fetcher.Form>
  );
}

function AccessForm({ access }: { access: TeamAccess }) {
  const fetcher = useFetcher<SaveResult>();
  const [choices, setChoices] = useState<Record<Permission, Choice>>(
    () =>
      Object.fromEntries(
        PERMISSIONS.map((p) => [
          p,
          access.granted.includes(p)
            ? 'grant'
            : access.denied.includes(p)
              ? 'deny'
              : 'role',
        ]),
      ) as Record<Permission, Choice>,
  );
  // The same rule the API applies, so the preview is what they will get.
  const result = new Set(
    effectivePermissions(
      access.role,
      access.rolePermissions,
      PERMISSIONS.filter((p) => choices[p] === 'grant'),
      PERMISSIONS.filter((p) => choices[p] === 'deny'),
    ),
  );
  const roleName = access.role === Role.STAFF ? 'Staff' : 'Designer';
  return (
    <fetcher.Form method="post" className="grid gap-6">
      {PERMISSION_GROUPS.map((group) => (
        <Panel key={group.label} title={group.label}>
          {/* Its own scroll box on a phone: the long role names don't widen the page. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-muted">
                <tr>
                  <th className="py-1 font-normal">Permission</th>
                  <th className="py-1 font-normal">Setting</th>
                  <th className="py-1 font-normal">Result</th>
                </tr>
              </thead>
              <tbody>
                {group.permissions.map((p) => {
                  const fromRole = access.rolePermissions.includes(p.key);
                  return (
                    <tr key={p.key} className="border-t border-border">
                      <td className="py-2 pr-3">
                        <label htmlFor={`access-${p.key}`}>{p.label}</label>
                        {includesText(p.key) && (
                          <span className="block text-xs text-text-muted">
                            {includesText(p.key)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          id={`access-${p.key}`}
                          name={p.key}
                          autoComplete="off"
                          value={choices[p.key]}
                          onChange={(e) =>
                            setChoices({
                              ...choices,
                              [p.key]: e.target.value as Choice,
                            })
                          }
                          className="rounded-md border border-border bg-surface px-2 py-1 text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
                        >
                          <option value="role">
                            As {roleName} (
                            {fromRole ? 'allowed' : 'not allowed'})
                          </option>
                          <option value="grant">Allow</option>
                          <option value="deny">Deny</option>
                        </select>
                      </td>
                      <td
                        className={`py-2 ${result.has(p.key) ? 'text-success' : 'text-text-muted'}`}
                      >
                        {result.has(p.key) ? 'Can' : 'Cannot'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          Save access
        </Button>
        <p className="text-sm text-text-muted">
          {result.size} of {PERMISSIONS.length} permissions
        </p>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}
