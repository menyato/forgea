import { type Profile, Role } from '@forgea/types';
import {
  createContext,
  data,
  type MiddlewareFunction,
  redirect,
} from 'react-router';
import { signInFor } from '~/features/auth/sign-in-links.server';
import type { ApiResult } from '~/lib/api-client.server';
import { type FieldErrors, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import { mayOpen, pageAccess } from './access';

/** The signed-in staff member or admin, set by `staffMiddleware` for every dashboard route. */
export const staffContext = createContext<Profile>();

/**
 * Runs before any dashboard loader or action: visitors go to sign-in, customers are refused,
 * and so is a team member opening a page their permissions don't cover (`PAGES`), even by
 * typing its address. The API checks every call again; this keeps the page from rendering.
 */
export const staffMiddleware: MiddlewareFunction<Response> = async (
  { url, context },
  next,
) => {
  const api = context.get(apiContext);
  if (!api.hasSession) throw redirect(signInFor(url));
  const me = await api.me();
  if (me.status === 401) throw redirect(signInFor(url));
  // Too many pages at once (or the API briefly down): "one moment", never "not allowed".
  if (!me.ok && (me.status === 429 || me.status >= 500)) {
    throw new Response(me.message, {
      status: me.status === 429 ? 429 : 503,
    });
  }
  if (!me.ok || me.data.role === Role.CUSTOMER) {
    throw new Response('The dashboard is for the Forgea team', { status: 403 });
  }
  if (!mayOpen(me.data, pageAccess(url.pathname))) {
    throw new Response('You do not have access to this page', { status: 403 });
  }
  context.set(staffContext, me.data);
  return next();
};

export type SaveResult =
  | { ok: true; error?: undefined; errors?: undefined }
  | { ok?: undefined; error: string; errors?: FieldErrors | undefined };

/**
 * A dashboard save, start to finish: check the form with the shared DTO (field errors show
 * at once), send it to the API, and turn either outcome into what `SaveStatus` displays.
 */
export async function save<T extends object>(
  dto: new () => T,
  values: Record<string, unknown>,
  send: (value: T) => Promise<ApiResult<unknown>>,
) {
  const parsed = validateForm(dto, values);
  if (!parsed.ok) {
    const first = Object.values(parsed.errors)[0];
    return data<SaveResult>(
      { error: first ?? 'Check the highlighted fields', errors: parsed.errors },
      { status: 400 },
    );
  }
  const r = await send(parsed.value);
  return r.ok
    ? data<SaveResult>({ ok: true })
    : data<SaveResult>({ error: r.message }, { status: r.status });
}

/** Reads a checkbox: browsers send "on" when ticked and nothing otherwise. */
export const checked = (form: FormData, name: string): boolean =>
  form.get(name) === 'on';

/** A text field, trimmed; empty means "not given". */
export function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}
