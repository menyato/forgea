import { Role, type UserListItem } from '@forgea/types';
import { AddTeamMemberDto } from '@forgea/validation';
import { redirect, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { ROLE_LABELS, TEAM_ROLES } from '~/features/team/roles';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A new team member; opens their page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    AddTeamMemberDto,
    {
      email: text(form, 'email'),
      name: text(form, 'name'),
      role: text(form, 'role'),
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<UserListItem>('/users/team', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/team/${createdId}`);
  return result;
}

export default function NewTeamMember() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="Add a team member"
        intro="They sign in with this Google Workspace address; nothing is sent to them. Their role decides what they may do."
        trail={[{ label: 'Team', to: '/admin/team' }]}
      />
      <fetcher.Form method="post" className="grid gap-6">
        <Panel title="Member">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Workspace email"
              name="email"
              type="email"
              // Someone else's address: not the admin's own to autofill.
              autoComplete="off"
              required
              error={errors['email']}
            />
            <Field
              label="Name (optional)"
              name="name"
              autoComplete="off"
              error={errors['name']}
            />
            <div className="sm:col-span-2">
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
            </div>
          </div>
        </Panel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Add
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </>
  );
}
