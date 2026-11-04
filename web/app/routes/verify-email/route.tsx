import type { Profile } from '@forgea/types';
import { ConfirmEmailDto } from '@forgea/validation';
import { data, Form, Link, redirect, useNavigation } from 'react-router';
import { PrintingLogo } from '~/components/brand/printing-logo';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button, buttonClass } from '~/components/ui/button';
import { Field, FormAlert } from '~/components/ui/field';
import {
  clearPending,
  readPending,
} from '~/features/auth/pending-confirmation.server';
import { textFields, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Enter your code — Forgea' },
    { name: 'robots', content: 'noindex' },
  ];
}

/** The address the code went to, from the ticket this browser holds (or none: start again). */
export async function loader({ request }: Route.LoaderArgs) {
  const pending = await readPending(request);
  return { email: pending?.email ?? null };
}

type ActionResult = { error?: string; sent?: boolean };

/** confirm (the 6-digit code) | resend (a new code, at most once a minute) */
export async function action({ request, context }: Route.ActionArgs) {
  const pending = await readPending(request);
  if (!pending)
    return data<ActionResult>(
      { error: 'This page has expired. Sign in again to get a new code.' },
      { status: 400 },
    );
  const api = context.get(apiContext);
  const form = await request.formData();

  if (form.get('intent') === 'resend') {
    const r = await api.post<{ sent: boolean }>('/auth/email-code/resend', {
      ticket: pending.ticket,
    });
    if (!r.ok)
      return data<ActionResult>({ error: r.message }, { status: r.status });
    return data<ActionResult>(
      r.data.sent
        ? { sent: true }
        : {
            error:
              'A code went out less than a minute ago. Check your inbox, or try again shortly.',
          },
    );
  }

  const parsed = validateForm(ConfirmEmailDto, {
    ticket: pending.ticket,
    ...textFields(form, ['code'] as const),
  });
  if (!parsed.ok)
    return data<ActionResult>(
      {
        error: parsed.errors['code'] ?? 'Enter the 6-digit code from the email',
      },
      { status: 400 },
    );
  const r = await api.post<Profile>('/auth/email-code', parsed.value);
  if (!r.ok)
    return data<ActionResult>({ error: r.message }, { status: r.status });
  // Signed in (the API's cookies ride along on this response): forget the ticket.
  return redirect(pending.next, {
    headers: { 'Set-Cookie': await clearPending() },
  });
}

export default function VerifyEmail({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  if (!loaderData.email) {
    return (
      <main className={`${PAGE_WIDTH} grid max-w-2xl gap-5 py-16`}>
        <PrintingLogo className="w-20" />
        <h1 className="font-display text-4xl font-extrabold">
          This page has expired
        </h1>
        <p className="text-text-muted">
          Codes work for 10 minutes. Sign in with your email and password and we
          will send you a new one.
        </p>
        <Link
          to="/sign-in"
          className={buttonClass('primary', 'justify-self-start')}
        >
          Sign in
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <PrintingLogo className="w-20" />
      <h1 className="font-display text-4xl font-bold">Check your email</h1>
      <p className="text-sm text-text-muted">
        We sent a 6-digit code to{' '}
        <strong className="text-text">{loaderData.email}</strong>. Enter it here
        to finish creating your account.
      </p>
      <FormAlert message={actionData?.error} />
      {actionData?.sent && (
        <p role="status" className="text-sm font-medium">
          A new code is on its way.
        </p>
      )}
      <Form method="post" className="grid gap-4" noValidate>
        <Field
          label="Code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
        />
        <Button type="submit" name="intent" value="confirm" disabled={busy}>
          {busy ? 'Checking…' : 'Confirm and continue'}
        </Button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="resend" />
        <p className="text-sm text-text-muted">
          Nothing arrived? Check your spam folder, or{' '}
          <button
            type="submit"
            disabled={busy}
            className="underline underline-offset-4"
          >
            send a new code
          </button>
          .
        </p>
      </Form>
    </main>
  );
}
