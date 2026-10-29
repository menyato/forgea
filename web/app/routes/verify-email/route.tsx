import type { Profile } from '@forgea/types';
import { data, Form, Link, useNavigation } from 'react-router';
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

/**
 * The link from the "confirm your email address" message. Opening it confirms nothing: the
 * person presses the button. Mail scanners and link previews open every link in a message,
 * and would otherwise confirm an address on behalf of whoever registered it.
 */
export function loader({ url }: Route.LoaderArgs) {
  const token = url.searchParams.get('token');
  return { token, email: token ? addressIn(token) : null };
}

/**
 * The address the link was made for, read from the token only to show it (the API checks the
 * token itself when the button is pressed).
 */
function addressIn(token: string): string | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    );
    const email =
      typeof payload === 'object' && payload !== null && 'email' in payload
        ? payload.email
        : null;
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}

type ActionResult =
  | { confirmed: true }
  | { confirmed: false; sent: boolean; error: string | null };

/** confirm (the button, with the link's token) | resend (signed in) */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const token = form.get('token');
  if (form.get('intent') === 'confirm' && typeof token === 'string') {
    const r = await api.post<Profile>('/auth/verify-email', { token });
    return r.ok
      ? data<ActionResult>({ confirmed: true })
      : data<ActionResult>(
          { confirmed: false, sent: false, error: r.message },
          { status: r.status },
        );
  }
  const r = await api.post('/auth/verify-email/resend');
  return r.ok
    ? data<ActionResult>({ confirmed: false, sent: true, error: null })
    : data<ActionResult>(
        {
          confirmed: false,
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
  const busy = useNavigation().state === 'submitting';
  if (actionData?.confirmed) {
    return (
      <main className={`${PAGE_WIDTH} grid max-w-2xl gap-5 py-16`}>
        <PrintingLogo className="w-20" />
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
      </main>
    );
  }
  const failed = actionData && !actionData.confirmed ? actionData : null;
  return (
    <main className={`${PAGE_WIDTH} grid max-w-2xl gap-5 py-16`}>
      <PrintingLogo className="w-20" />
      {loaderData.token && !failed?.error ? (
        <>
          <h1 className="font-display text-4xl font-extrabold">
            Confirm your email address
          </h1>
          <p className="text-text-muted">
            {loaderData.email ? (
              <>
                Confirm{' '}
                <strong className="text-text">{loaderData.email}</strong> for
                your Forgea account: order updates and quotes then come here.
              </>
            ) : (
              'One click and your order updates and quotes come to this address.'
            )}
          </p>
          <p className="text-sm text-text-muted">
            Didn't create a Forgea account? Don't press the button: just close
            this page, and nobody can use your address.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="token" value={loaderData.token} />
            <Button type="submit" disabled={busy}>
              Confirm my email address
            </Button>
          </Form>
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-extrabold">
            This link didn't work
          </h1>
          <p className="text-text-muted">
            {failed?.error ?? 'This link is incomplete.'}
          </p>
          {failed?.sent ? (
            <p className="font-medium">A new link is on its way.</p>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="resend" />
              <Button type="submit" disabled={busy}>
                Send me a new link
              </Button>
            </Form>
          )}
        </>
      )}
    </main>
  );
}
