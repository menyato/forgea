import { LoginDto } from '@forgea/validation';
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useSearchParams,
} from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, FormAlert } from '~/components/ui/field';
import { GoogleButton } from '~/features/auth/google-button';
import {
  googleSignInUrl,
  nextPath,
} from '~/features/auth/sign-in-links.server';
import { type FieldErrors, textFields, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [{ title: 'Sign in — Forgea' }];
}

export function loader({ url }: Route.LoaderArgs) {
  // Google sends errors back here as ?error=… (e.g. an unverified email).
  const error = url.searchParams.get('error');
  return {
    googleUrl: googleSignInUrl(url),
    error,
    // Coming from checkout: say why we ask, and that the cart is kept.
    forCheckout: nextPath(url).startsWith('/checkout'),
  };
}

export async function action({ request, url, context }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = validateForm(
    LoginDto,
    textFields(form, ['email', 'password'] as const),
  );
  if (!parsed.ok)
    return data({ errors: parsed.errors, message: undefined }, { status: 400 });

  const r = await context.get(apiContext).post('/auth/login', parsed.value);
  if (!r.ok)
    return data({ errors: {}, message: r.message }, { status: r.status });
  return redirect(nextPath(url));
}

export default function SignIn({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [params] = useSearchParams();
  const submitting = useNavigation().state === 'submitting';
  const errors: FieldErrors = actionData?.errors ?? {};

  return (
    <main className="mx-auto grid max-w-sm gap-6 px-4 py-16">
      <h1 className="font-display text-4xl font-bold">Sign in</h1>
      {loaderData.forCheckout && (
        <p className="text-sm text-text-muted">
          Sign in or create an account to place your order. Your cart is kept.
        </p>
      )}
      <FormAlert
        message={actionData?.message ?? loaderData.error ?? undefined}
      />
      <GoogleButton href={loaderData.googleUrl} />
      <p className="text-center text-xs text-text-muted">or with your email</p>
      <Form method="post" className="grid gap-4" noValidate>
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
          autoComplete="current-password"
          required
          error={errors['password']}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link
          to="/forgot-password"
          className="justify-self-start text-sm underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </Form>
      <p className="text-sm text-text-muted">
        New here?{' '}
        <Link
          to={`/register${params.size ? `?${params}` : ''}`}
          className="underline underline-offset-4"
        >
          Create an account
        </Link>
        . It takes a minute.
      </p>
    </main>
  );
}
