import type { Profile } from '@forgea/types';
import { ChangePasswordDto, UpdateProfileDto } from '@forgea/validation';
import { PASSWORD_MIN_LENGTH } from '@forgea/validation/constants';
import { data, Link, redirect, useFetcher } from 'react-router';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button } from '~/components/ui/button';
import { Field, FormAlert } from '~/components/ui/field';
import { signInFor } from '~/features/auth/sign-in-links.server';
import { type FieldErrors, textFields, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'My account — Forgea' },
    { name: 'robots', content: 'noindex' },
  ];
}

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const me = await api.get<Profile>('/auth/me');
  if (me.status === 401) throw redirect(signInFor(url));
  if (!me.ok) throw new Response(me.message, { status: me.status });
  return { profile: me.data };
}

type Result = { ok?: true; errors?: FieldErrors; message?: string };

/** profile (name, phone) | password (change it) | verify (send the confirmation link again) */
export async function action({ request, url, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');

  if (intent === 'verify') {
    const r = await api.post('/auth/verify-email/resend');
    return r.ok
      ? data<Result>({ ok: true })
      : data<Result>({ message: r.message }, { status: r.status });
  }

  const parsed =
    intent === 'password'
      ? validateForm(ChangePasswordDto, {
          currentPassword: form.get('currentPassword'),
          newPassword: form.get('newPassword'),
        })
      : validateForm(UpdateProfileDto, textFields(form, ['name', 'phone']));
  if (!parsed.ok) {
    return data<Result>({ errors: parsed.errors }, { status: 400 });
  }
  const r =
    intent === 'password'
      ? await api.post<Profile>('/auth/password/change', parsed.value)
      : await api.patch<Profile>('/auth/me', parsed.value);
  if (r.status === 401) throw redirect(signInFor(url));
  return r.ok
    ? data<Result>({ ok: true })
    : data<Result>({ message: r.message }, { status: r.status });
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const { profile } = loaderData;
  return (
    <main className={`${PAGE_WIDTH} grid max-w-2xl gap-8 py-10`}>
      <header className="grid gap-2">
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          My account
        </h1>
        <p className="text-text-muted">
          {profile.email}
          {profile.emailVerified ? ' · confirmed' : ' · not confirmed yet'}
        </p>
        <p className="flex gap-4 text-sm">
          <Link to="/orders" className="underline underline-offset-4">
            My orders
          </Link>
          <Link to="/requests" className="underline underline-offset-4">
            My requests
          </Link>
        </p>
      </header>
      {!profile.emailVerified && <VerifyPanel />}
      <ProfilePanel profile={profile} />
      <PasswordPanel hasPassword={profile.hasPassword} />
    </main>
  );
}

function VerifyPanel() {
  const fetcher = useFetcher<Result>();
  return (
    <section className="grid gap-3 rounded-lg bg-surface p-6">
      <h2 className="font-display text-xl font-bold">Confirm your email</h2>
      <p className="text-sm text-text-muted">
        Order updates and quotes are sent to this address once it is confirmed.
      </p>
      {fetcher.data?.ok ? (
        <p className="font-medium">A new link is on its way.</p>
      ) : (
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="verify" />
          <Button
            type="submit"
            variant="secondary"
            disabled={fetcher.state !== 'idle'}
          >
            Send me the link again
          </Button>
        </fetcher.Form>
      )}
      <FormAlert message={fetcher.data?.message} />
    </section>
  );
}

function ProfilePanel({ profile }: { profile: Profile }) {
  const fetcher = useFetcher<Result>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <section className="grid gap-3 rounded-lg bg-surface p-6">
      <h2 className="font-display text-xl font-bold">Your details</h2>
      <p className="text-sm text-text-muted">
        Used for your orders and for the courier to call you.
      </p>
      <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="intent" value="profile" />
        <Field
          label="Name"
          name="name"
          required
          autoComplete="name"
          defaultValue={profile.name ?? ''}
          error={errors['name']}
        />
        <Field
          label="Phone"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          defaultValue={profile.phone ?? ''}
          error={errors['phone']}
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save
          </Button>
          {fetcher.data?.ok && (
            <span className="text-sm text-success">Saved</span>
          )}
          <FormAlert message={fetcher.data?.message} />
        </div>
      </fetcher.Form>
    </section>
  );
}

function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
  const fetcher = useFetcher<Result>();
  const errors = fetcher.data?.errors ?? {};
  if (!hasPassword) {
    return (
      <section className="grid gap-3 rounded-lg bg-surface p-6">
        <h2 className="font-display text-xl font-bold">Password</h2>
        <p className="text-sm text-text-muted">
          You sign in with Google. To also sign in with a password,{' '}
          <Link to="/forgot-password" className="underline underline-offset-4">
            ask for a link to set one
          </Link>
          .
        </p>
      </section>
    );
  }
  return (
    <section className="grid gap-3 rounded-lg bg-surface p-6">
      <h2 className="font-display text-xl font-bold">Change your password</h2>
      <p className="text-sm text-text-muted">
        Every other device is signed out; this one stays signed in.
      </p>
      <fetcher.Form
        method="post"
        key={fetcher.data?.ok ? 'done' : 'form'}
        className="grid gap-4 sm:grid-cols-2"
      >
        <input type="hidden" name="intent" value="password" />
        <Field
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          error={errors['currentPassword']}
        />
        <Field
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={errors['newPassword']}
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Change password
          </Button>
          {fetcher.data?.ok && (
            <span className="text-sm text-success">Changed</span>
          )}
          <FormAlert message={fetcher.data?.message} />
        </div>
      </fetcher.Form>
    </section>
  );
}
