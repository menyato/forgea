import type { PendingConfirmation } from '@forgea/types';
import { PASSWORD_MIN_LENGTH, RegisterDto } from '@forgea/validation';
import { data, Form, Link, useNavigation } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, FormAlert } from '~/components/ui/field';
import { GoogleButton } from '~/features/auth/google-button';
import {
  googleSignInUrl,
  nextPath,
} from '~/features/auth/sign-in-links.server';
import { type FieldErrors, textFields, validateForm } from '~/lib/forms.server';
import { toCodePage } from '~/features/auth/pending-confirmation.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Create an account — Forgea' }];
}

export function loader({ url }: Route.LoaderArgs) {
  return {
    googleUrl: googleSignInUrl(url),
    minLength: PASSWORD_MIN_LENGTH,
  };
}

export async function action({ request, url, context }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = validateForm(
    RegisterDto,
    textFields(form, ['name', 'email', 'password'] as const),
  );
  if (!parsed.ok)
    return data({ errors: parsed.errors, message: undefined }, { status: 400 });

  const r = await context
    .get(apiContext)
    .post<PendingConfirmation>('/auth/register', parsed.value);
  if (!r.ok)
    return data({ errors: {}, message: r.message }, { status: r.status });
  // Not signed in yet: the code we just emailed finishes it.
  return toCodePage(r.data, nextPath(url));
}

export default function Register({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const submitting = useNavigation().state === 'submitting';
  const errors: FieldErrors = actionData?.errors ?? {};

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-display text-4xl font-bold">Create an account</h1>
      <p className="text-sm text-text-muted">
        Browsing is open to everyone. An account lets you order, keeps your
        orders in one place and remembers your phone number for next time.
      </p>
      <FormAlert message={actionData?.message} />
      <GoogleButton href={loaderData.googleUrl} />
      <p className="text-center text-xs text-text-muted">or with your email</p>
      <Form method="post" className="grid gap-4" noValidate>
        <Field
          label="Name (optional)"
          name="name"
          autoComplete="name"
          error={errors['name']}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={errors['email']}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={loaderData.minLength}
          hint={`At least ${loaderData.minLength} characters. A short sentence works well.`}
          error={errors['password']}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </Form>
      <p className="text-sm text-text-muted">
        Already have one?{' '}
        <Link to="/sign-in" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}
