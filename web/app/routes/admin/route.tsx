export { unlessAsking as shouldRevalidate } from '~/lib/revalidate';
import { Outlet } from 'react-router';
import { DashboardShell } from '~/features/admin/dashboard-shell';
import { staffContext, staffMiddleware } from '~/features/admin/staff.server';
import type { Route } from './+types/route';

export const middleware: Route.MiddlewareFunction[] = [staffMiddleware];

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Dashboard — Forgea' },
    // Private pages: keep them out of search engines.
    { name: 'robots', content: 'noindex' },
  ];
}

export function loader({ context }: Route.LoaderArgs) {
  return { staff: context.get(staffContext) };
}

/** The dashboard frame: the side menu (it folds away) beside the page. */
export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <DashboardShell staff={loaderData.staff}>
      <Outlet />
    </DashboardShell>
  );
}
