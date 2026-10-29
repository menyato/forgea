import { ForgotPasswordDto } from '@forgea/validation';
import { data, Form, Link, useNavigation } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button } from '~/components/ui/button';
import { Field, FormAlert } from '~/components/ui/field';
import { type FieldErrors, textFields, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Forgot your password? — Forgea' },
    { name: 'robots', content: 'noindex' },
  ];
}

type ActionResult =
  { sent: true } | { sent: false; errors: FieldErrors; message?: string };

/** Emails a link to choose a new password (the answer never says if the address has an account). */
export async function action({ request, context }: Route.ActionArgs) {
  const parsed = validateForm(
    ForgotPasswordDto,
    textFields(await request.formData(), ['email']),
  );
  if (!parsed.ok) {
    return data<ActionResult>(
      { sent: false, errors: parsed.errors },
      { status: 400 },
    );
  }
  const r = await context
    .get(apiContext)
    .post('/auth/password/forgot', parsed.value);
  return r.ok
    ? data<ActionResult>({ sent: true })
    : data<ActionResult>(
        { sent: false, errors: {}, message: r.message },
        { status: r.status },
      );
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <main className={`${PAGE_WIDTH} grid max-w-md gap-5 py-16`}>
      <h1 className="font-display text-4xl font-extrabold">
        Forgot your password?
      </h1>
      {actionData?.sent ? (
        <p className="text-text-muted">
          If that address has a Forgea account, a link to choose a new password
          is on its way. It works for 30 minutes.
        </p>
      ) : (
        <>
          <p className="text-text-muted">
            Enter your account's email: we send you a link to choose a new one.
          </p>
          <Form method="post" className="grid gap-4">
            <FormAlert
              message={
                actionData && !actionData.sent ? actionData.message : undefined
              }
            />
            <Field
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              required
              error={
                actionData && !actionData.sent
                  ? actionData.errors['email']
                  : undefined
              }
            />
            <Button type="submit" disabled={busy}>
              Send me a link
            </Button>
          </Form>
        </>
      )}
      <Link to="/sign-in" className="text-sm underline underline-offset-4">
        Back to sign in
      </Link>
    </main>
  );
}
