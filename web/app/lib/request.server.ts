import { createContext } from 'react-router';
import { ApiClient } from './api-client.server';
import { serverEnv } from './env.server';

/** One ApiClient per page request, shared by every loader and action that runs for it. */
export const apiContext = createContext<ApiClient>();

type Next = () => Promise<Response>;
interface MiddlewareArgs {
  request: Request;
  context: { set: (ctx: typeof apiContext, value: ApiClient) => void };
}

/**
 * Creates the request's ApiClient, runs the loaders/actions, then hands the browser every
 * cookie the API set along the way (session renewal, cart, sign-in) — in one place, so no
 * route can forget to.
 */
export async function apiMiddleware(
  { request, context }: MiddlewareArgs,
  next: Next,
): Promise<Response> {
  const api = new ApiClient(request);
  context.set(apiContext, api);
  const response = await next();
  for (const cookie of api.headers.getSetCookie())
    response.headers.append('Set-Cookie', cookie);
  return response;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for the storefront's own actions: a form post must come from this site.
 * Browsers send Origin on every POST; cross-site posts also never carry our SameSite cookies.
 */
export async function sameOriginMiddleware(
  { request }: { request: Request },
  next: Next,
): Promise<Response> {
  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get('origin');
    const site = request.headers.get('sec-fetch-site');
    if (
      site === 'cross-site' ||
      (origin !== null && origin !== serverEnv().PUBLIC_WEB_URL)
    ) {
      throw new Response('Forbidden', { status: 403 });
    }
  }
  return next();
}
