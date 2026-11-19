import type { LogoView } from '@forgea/types';
import { NewLogoDto } from '@forgea/validation';
import { data, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, saveNew, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** Sends the SVG with its name (the API reads it into print outlines), then opens it. */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0)
    return data<SaveResult>({ error: 'Choose an SVG file' }, { status: 400 });
  return saveNew(
    NewLogoDto,
    { name: text(form, 'name') },
    (dto) => {
      const upload = new FormData();
      upload.set('name', dto.name);
      upload.set('file', file, file.name);
      return api.postForm<LogoView>('/logos', upload);
    },
    (created) => `/admin/logos/${created.id}`,
  );
}

export default function NewLogo() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="New logo"
        intro="An SVG drawing (export it from Illustrator, Inkscape, Canva or Figma as SVG). Everything drawn prints solid; shapes inside shapes become holes. Only use logos you may print."
        trail={[{ label: 'Logos', to: '/admin/logos' }]}
      />
      <fetcher.Form
        method="post"
        encType="multipart/form-data"
        className="grid grid-cols-1 gap-4"
      >
        <Panel title="Logo">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid content-start gap-1.5 text-sm">
              <span className="font-medium">SVG file (up to 1 MB)</span>
              <input
                type="file"
                name="file"
                accept=".svg,image/svg+xml"
                autoComplete="off"
                required
                className="text-sm"
              />
            </label>
            <Field
              label="Name"
              name="name"
              required
              error={errors['name']}
              hint="As the team sees it, e.g. Forgea mark"
            />
          </div>
        </Panel>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Add the logo
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </>
  );
}
