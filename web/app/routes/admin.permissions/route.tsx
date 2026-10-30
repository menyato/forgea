import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  type PermissionRole,
  Role,
  type RolePermissionsView,
} from '@forgea/types';
import { SaveRolePermissionsDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { includesText } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const roles = await context
    .get(apiContext)
    .get<RolePermissionsView[]>('/permissions/roles');
  if (!roles.ok) throw new Response(roles.message, { status: roles.status });
  return { roles: roles.data };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const role = text(form, 'role') as PermissionRole | undefined;
  const permissions =
    form.get('intent') === 'defaults' &&
    role &&
    role in DEFAULT_ROLE_PERMISSIONS
      ? [...DEFAULT_ROLE_PERMISSIONS[role]]
      : form.getAll('permissions');
  return save(SaveRolePermissionsDto, { permissions }, (dto) =>
    context
      .get(apiContext)
      .put(`/permissions/roles/${encodeURIComponent(role ?? '')}`, dto),
  );
}

const ROLE_NAMES: Record<PermissionRole, string> = {
  [Role.STAFF]: 'Staff',
  [Role.DESIGNER]: 'Designer',
};

export default function RolesAndPermissions({
  loaderData,
}: Route.ComponentProps) {
  return (
    <>
      <AdminHeader
        title="Roles & permissions"
        intro="What each team role may see and do. A change reaches everyone with that role on their next click, no new sign-in needed. To change one person, open them on the Team page. Admins can always do everything."
      />
      <div className="grid gap-6">
        {loaderData.roles.map((r) => (
          <RoleForm key={r.role} view={r} />
        ))}
      </div>
    </>
  );
}

function RoleForm({ view }: { view: RolePermissionsView }) {
  const fetcher = useFetcher<SaveResult>();
  const name = ROLE_NAMES[view.role];
  return (
    <Panel title={`${name} (${view.members} active)`}>
      <fetcher.Form
        method="post"
        className="grid gap-5"
        aria-label={`${name} permissions`}
      >
        <input type="hidden" name="role" value={view.role} />
        {/* Rebuilt when the stored list changes (e.g. back to the defaults), so the boxes
            show it; the form and its "Saved" stay. */}
        {PERMISSION_GROUPS.map((group) => (
          <fieldset
            key={`${group.label}:${view.permissions.join()}`}
            className="grid gap-2"
          >
            <legend className="mb-1 font-semibold">{group.label}</legend>
            {group.permissions.map((p) => (
              <label key={p.key} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="permissions"
                  value={p.key}
                  defaultChecked={view.permissions.includes(p.key)}
                  className="mt-1"
                />
                <span>
                  {p.label}
                  {'sensitive' in p && (
                    <span className="ml-2 text-xs font-semibold text-warning">
                      money or settings
                    </span>
                  )}
                  {includesText(p.key) && (
                    <span className="block text-xs text-text-muted">
                      {includesText(p.key)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save {name.toLowerCase()} permissions
          </Button>
          <Button
            type="submit"
            name="intent"
            value="defaults"
            variant="secondary"
            disabled={fetcher.state !== 'idle'}
          >
            Back to the defaults
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}
