import type { CustomerLogoView } from '@forgea/types';
import { data } from 'react-router';
import { apiContext } from '~/lib/request.server';
import { readUploadForm } from '~/lib/upload-guard.server';
import type { Route } from './+types/route';

export type OwnLogoResult =
  | { logo: CustomerLogoView; error?: undefined }
  | { logo?: undefined; error: string };

/**
 * A customer's own logo, from any page they design on: the SVG (theirs, or their picture as
 * their browser traced it) goes to the API, which keeps only its print outline. No page.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await readUploadForm(request, null);
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0)
    return data<OwnLogoResult>({ error: 'Choose your logo' }, { status: 400 });
  const upload = new FormData();
  upload.set('file', file, 'logo.svg');
  const r = await api.postForm<CustomerLogoView>('/logos/yours', upload);
  return r.ok
    ? data<OwnLogoResult>({ logo: r.data })
    : data<OwnLogoResult>({ error: r.message }, { status: r.status });
}
