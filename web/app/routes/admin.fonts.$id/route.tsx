import type { FontView } from '@forgea/types';
import { UpdateFontDto } from '@forgea/validation';
import { useMemo } from 'react';
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
import { FontSample, scriptsOf } from '~/features/admin-fonts/font-sample';
import { useFontFaces } from '~/features/text-studio/use-font-faces';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ params, context }: Route.LoaderArgs) {
  // The API sends fonts as one list.
  const r = await context.get(apiContext).get<FontView[]>('/fonts');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  const font = r.data.find((f) => f.id === params.id);
  if (!font) throw new Response('No such font', { status: 404 });
  return { font };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  return save(
    UpdateFontDto,
    {
      name: text(form, 'name'),
      active: checked(form, 'active'),
      sortOrder: text(form, 'sortOrder') ?? 0,
    },
    (dto) =>
      context
        .get(apiContext)
        .put(`/fonts/${encodeURIComponent(params.id)}`, dto),
  );
}

export default function EditFont({ loaderData }: Route.ComponentProps) {
  const { font } = loaderData;
  const editable = useCan()('catalog.manage');
  useFontFaces(useMemo(() => [font], [font]));
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Fonts', to: '/admin/fonts' }]}
        title={font.name}
        intro="How it shows to customers designing a personalised piece."
      />
      <div className="grid grid-cols-1 gap-4">
        <Panel title="Sample">
          <FontSample font={font} className="text-4xl" />
          <p className="text-sm text-text-muted">Writes {scriptsOf(font)}</p>
        </Panel>
        <ViewOnly editable={editable}>
          <FontForm key={font.id} font={font} />
        </ViewOnly>
      </div>
    </>
  );
}

function FontForm({ font }: { font: FontView }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-4">
      <Panel title="In the shop">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name customers see"
            name="name"
            defaultValue={font.name}
            error={errors['name']}
          />
          <Field
            label="Order"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={font.sortOrder}
            error={errors['sortOrder']}
            hint="Lower numbers come first"
          />
        </div>
        <CheckboxField
          label="Offered"
          name="active"
          defaultChecked={font.active}
          hint="Turn off to stop offering it to customers"
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
