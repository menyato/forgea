import type { Profile } from '@forgea/types';
import { data, Form, Link } from 'react-router';
import { PrintingLogo } from '~/components/brand/printing-logo';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button, buttonClass } from '~/components/ui/button';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Confirm your email — Forgea' },
    { name: 'robots', content: 'noindex' },
  ];
}

/** The link from the "confirm your email address" message. */
export async function loader({ url, context }: Route.LoaderArgs) {
  const token = url.searchParams.get('token');
  if (!token) return { confirmed: false, message: 'This link is incomplete.' };
  const r = await context
    .get(apiContext)
    .post<Profile>('/auth/verify-email', { token });
  return r.ok
    ? { confirmed: true, message: null }
    : { confirmed: false, message: r.message };
}

/** "Send me a new link" (signed in). */
export async function action({ context }: Route.ActionArgs) {
  const r = await context.get(apiContext).post('/auth/verify-email/resend');
  return r.ok
    ? { sent: true, error: null }
    : data(
        {
          sent: false,
          error:
            r.status === 401
              ? 'Sign in first, then ask for a new link.'
              : r.message,
        },
        { status: r.status },
      );
}

export default function VerifyEmail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className={`${PAGE_WIDTH} grid max-w-2xl gap-5 py-16`}>
      <PrintingLogo className="w-20" />
      {loaderData.confirmed ? (
        <>
          <h1 className="font-display text-4xl font-extrabold">
            Address confirmed
          </h1>
          <p className="text-text-muted">
            We will send your order updates and quotes here.
          </p>
          <Link
            to="/shop"
            className={buttonClass('primary', 'justify-self-start')}
          >
            Go to the shop
          </Link>
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-extrabold">
            This link didn't work
          </h1>
          <p className="text-text-muted">{loaderData.message}</p>
          {actionData?.sent ? (
            <p className="font-medium">A new link is on its way.</p>
          ) : (
            <Form method="post">
              <Button type="submit">Send me a new link</Button>
            </Form>
          )}
          {actionData?.error && (
            <p className="text-danger">{actionData.error}</p>
          )}
        </>
      )}
    </main>
  );
}
