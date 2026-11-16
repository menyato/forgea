export { unlessAsking as shouldRevalidate } from '~/lib/revalidate';
import { Outlet } from 'react-router';
import { ErrorScreen } from '~/components/error-screen';
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

/**
 * A dashboard page that can't be shown (no such record, not allowed, too many requests) says
 * so inside the dashboard, menu still there; without the frame's own data, on a plain page.
 */
export function ErrorBoundary({ error, loaderData }: Route.ErrorBoundaryProps) {
  const screen = (
    <ErrorScreen
      error={error}
      back={{ to: '/admin', label: 'Back to the dashboard' }}
    />
  );
  return loaderData ? (
    <DashboardShell staff={loaderData.staff}>{screen}</DashboardShell>
  ) : (
    screen
  );
}
