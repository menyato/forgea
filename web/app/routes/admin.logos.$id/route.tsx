import type { LogoDetail } from '@forgea/types';
import { UpdateLogoDto } from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { LogoOutline } from '~/features/admin-logos/logo-outline';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<LogoDetail>(`/logos/${encodeURIComponent(params.id)}`);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { logo: r.data };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(
    UpdateLogoDto,
    {
      name: text(form, 'name'),
      active: checked(form, 'active'),
      sortOrder: text(form, 'sortOrder') ?? 0,
    },
    (dto) =>
      context
        .get(apiContext)
        .put(`/logos/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function EditLogo({ loaderData }: Route.ComponentProps) {
  const { logo } = loaderData;
  const editable = useCan()('catalog.manage');
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Logos', to: '/admin/logos' }]}
        title={logo.name}
        intro="As it prints: solid where it is drawn, open where it has holes."
      />
      <div className="grid grid-cols-1 gap-4">
        <Panel title="As it prints">
          <LogoOutline
            outline={logo.outline}
            label={`The ${logo.name} logo`}
            className="h-48 w-48 text-text"
          />
          <p className="text-sm text-text-muted">
            {logo.points.toLocaleString('en-US')} points
          </p>
        </Panel>
        <ViewOnly editable={editable}>
          <LogoForm key={logo.id} logo={logo} />
        </ViewOnly>
      </div>
    </>
  );
}

function LogoForm({ logo }: { logo: LogoDetail }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-4">
      <Panel title="On products">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            name="name"
            defaultValue={logo.name}
            error={errors['name']}
          />
          <Field
            label="Order"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={logo.sortOrder}
            error={errors['sortOrder']}
            hint="Lower numbers come first"
          />
        </div>
        <CheckboxField
          label="Offered"
          name="active"
          defaultChecked={logo.active}
          hint="Turn off to stop adding it to products (orders keep it)"
        />
      </Panel>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          Save
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}
