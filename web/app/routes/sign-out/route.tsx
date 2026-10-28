import { redirect } from 'react-router';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** POST only (a link could be triggered by any page); ends the session on the API. */
export async function action({ context }: Route.ActionArgs) {
  await context.get(apiContext).post('/auth/logout');
  return redirect('/');
}

export function loader() {
  return redirect('/');
}
