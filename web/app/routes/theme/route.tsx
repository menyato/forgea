import { safeNext } from '@forgea/types';
import { data, redirect } from 'react-router';
import { isTheme } from '~/features/theme/theme';
import { saveTheme } from '~/features/theme/theme.server';
import type { Route } from './+types/route';

/** Saves the light/dark choice (resource route: no page of its own). */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const theme = form.get('theme');
  if (!isTheme(theme)) throw data('Unknown theme', { status: 400 });
  const headers = { 'Set-Cookie': await saveTheme(theme) };
  // Without JavaScript the browser navigated here: send it back to the page it was on.
  // With JavaScript (a fetcher), the page stays put and just revalidates.
  if (request.headers.get('Sec-Fetch-Mode') === 'navigate') {
    const returnTo = form.get('returnTo');
    return redirect(safeNext(typeof returnTo === 'string' ? returnTo : null), {
      headers,
    });
  }
  return data({ theme }, { headers });
}
