import { ResetPasswordDto } from '@forgea/validation';
import { PASSWORD_MIN_LENGTH } from '@forgea/validation/constants';
import { data, Form, Link, useNavigation } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button, buttonClass } from '~/components/ui/button';
import { Field, FormAlert } from '~/components/ui/field';
import { type FieldErrors, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Choose a new password — Forgea' },
    { name: 'robots', content: 'noindex' },
  ];
}

/** The link from the "choose a new password" email; opening it changes nothing. */
export function loader({ url }: Route.LoaderArgs) {
  return { token: url.searchParams.get('token') };
}

type ActionResult =
  { done: true } | { done: false; errors: FieldErrors; message?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = validateForm(ResetPasswordDto, {
    token: form.get('token'),
    password: form.get('password'),
  });
  if (!parsed.ok) {
    return data<ActionResult>(
      { done: false, errors: parsed.errors },
      { status: 400 },
    );
  }
  const r = await context
    .get(apiContext)
    .post('/auth/password/reset', parsed.value);
  return r.ok
    ? data<ActionResult>({ done: true })
    : data<ActionResult>(
        { done: false, errors: {}, message: r.message },
        { status: r.status },
      );
}

export default function ResetPassword({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const busy = useNavigation().state === 'submitting';
  return (
    <main className={`${PAGE_WIDTH} grid max-w-md gap-5 py-16`}>
      <h1 className="font-display text-4xl font-extrabold">
        Choose a new password
      </h1>
      {actionData?.done ? (
        <>
          <p className="text-text-muted">
            Your password is changed, and every other device was signed out.
          </p>
          <Link
            to="/sign-in"
            className={buttonClass('primary', 'justify-self-start')}
          >
            Sign in
          </Link>
        </>
      ) : loaderData.token ? (
        <Form method="post" className="grid gap-4">
          <FormAlert
            message={
              actionData && !actionData.done ? actionData.message : undefined
            }
          />
          <input type="hidden" name="token" value={loaderData.token} />
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            error={
              actionData && !actionData.done
                ? actionData.errors['password']
                : undefined
            }
          />
          <Button type="submit" disabled={busy}>
            Save my new password
          </Button>
        </Form>
      ) : (
        <p className="text-text-muted">
          This link is incomplete.{' '}
          <Link to="/forgot-password" className="underline underline-offset-4">
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </main>
  );
}
