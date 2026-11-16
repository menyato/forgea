import type { FontView, UploadedFile } from '@forgea/types';
import { SaveFontDto } from '@forgea/validation';
import { data, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, saveNew, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** Uploads the file, adds the font (the API checks what it writes), then opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0)
    return data<SaveResult>({ error: 'Choose a font file' }, { status: 400 });
  const upload = new FormData();
  upload.set('file', file, file.name);
  const uploaded = await api.postForm<UploadedFile>('/uploads/font', upload);
  if (!uploaded.ok)
    return data<SaveResult>(
      { error: uploaded.message },
      { status: uploaded.status },
    );
  return saveNew(
    SaveFontDto,
    { fileKey: uploaded.data.key, name: text(form, 'name') },
    (dto) => api.post<FontView>('/fonts', dto),
    (created) => `/admin/fonts/${created.id}`,
  );
}

export default function NewFont() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="New font"
        intro="Use fonts whose licence lets you sell what you print with them (Google Fonts are free to use). It is checked as it goes in: whether it writes English, Arabic or both."
        trail={[{ label: 'Fonts', to: '/admin/fonts' }]}
      />
      <fetcher.Form
        method="post"
        encType="multipart/form-data"
        className="grid grid-cols-1 gap-4"
      >
        <Panel title="Font">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid content-start gap-1.5 text-sm">
              <span className="font-medium">Font file (TTF or OTF)</span>
              <input
                type="file"
                name="file"
                accept=".ttf,.otf,font/ttf,font/otf"
                autoComplete="off"
                required
                className="text-sm"
              />
            </label>
            <Field
              label="Name customers see (optional)"
              name="name"
              error={errors['name']}
              hint="Empty: the font's own name"
            />
          </div>
        </Panel>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Add the font
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </>
  );
}
