import { HTTP, type Profile } from '@forgea/types';
import { serverEnv, type ServerEnv } from './env.server';

const {
  REFRESH_COOKIE,
  CSRF_HEADER,
  PROXY_SECRET_HEADER,
  FORWARDED_CLIENT_IP_HEADER,
} = HTTP;

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

type Body = { json: unknown } | { form: FormData } | undefined;

/** Their 401 means "wrong credentials" or "session over", never "token expired, renew it". */
const NO_RENEWAL = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
]);

/**
 * The storefront's server-side gateway to the API (backend-for-frontend). Browsers only ever
 * talk to the storefront; loaders and actions call the API through one of these per request:
 *
 * - forwards the shopper's cookies, and collects the cookies the API sets so the loader or
 *   action can pass them back to the browser (`headers`);
 * - renews an expired 15-minute access token once, transparently, with the refresh cookie;
 * - adds the CSRF header the API requires, and the shopper's IP for per-shopper rate limits.
 */
export class ApiClient {
  private readonly jar: Map<string, string>;
  private readonly setCookies: string[] = [];
  /** One renewal per request, shared by every loader that hits an expired token at once. */
  private refreshing: Promise<boolean> | undefined;
  /** "Who am I", asked once per request however many loaders want it (see `me`). */
  private profile: Promise<ApiResult<Profile>> | undefined;

  constructor(
    private readonly request: Request,
    private readonly env: ServerEnv = serverEnv(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.jar = parseCookieHeader(request.headers.get('cookie'));
  }

  /** Whether the browser sent any session cookie (skip "who am I" calls for anonymous visitors). */
  get hasSession(): boolean {
    return this.jar.has(HTTP.ACCESS_COOKIE) || this.jar.has(REFRESH_COOKIE);
  }

  /**
   * GET /auth/me, shared by the dashboard's middleware, the page shell and the page itself
   * within one request. Any change sent through this client forgets it, so a page never
   * shows a profile from before its own save.
   */
  me(): Promise<ApiResult<Profile>> {
    this.profile ??= this.get<Profile>('/auth/me');
    return this.profile;
  }

  get<T>(path: string): Promise<ApiResult<T>> {
    return this.call<T>('GET', path, undefined);
  }

  post<T>(path: string, json?: unknown): Promise<ApiResult<T>> {
    return this.call<T>(
      'POST',
      path,
      json === undefined ? undefined : { json },
    );
  }

  put<T>(path: string, json: unknown): Promise<ApiResult<T>> {
    return this.call<T>('PUT', path, { json });
  }

  patch<T>(path: string, json: unknown): Promise<ApiResult<T>> {
    return this.call<T>('PATCH', path, { json });
  }

  delete<T>(path: string): Promise<ApiResult<T>> {
    return this.call<T>('DELETE', path, undefined);
  }

  /** Multipart upload (e.g. the custom-design form with a reference image). */
  postForm<T>(path: string, form: FormData): Promise<ApiResult<T>> {
    return this.call<T>('POST', path, { form });
  }

  /**
   * A file from the API, unparsed (3D models, photos), to stream on to the browser. Renews an
   * expired session first: the dashboard previews files that only staff may see.
   */
  async file(path: string): Promise<Response> {
    if (!this.jar.has(HTTP.ACCESS_COOKIE) && this.jar.has(REFRESH_COOKIE)) {
      await this.refresh();
    }
    const response = await this.fetchImpl(new URL(path, this.env.API_URL), {
      headers: this.requestHeaders(undefined),
      redirect: 'manual',
    });
    this.absorbCookies(response);
    return response;
  }

  /** Set-Cookie headers from the API, to attach to the loader/action response. */
  get headers(): Headers {
    const headers = new Headers();
    for (const cookie of this.setCookies) headers.append('Set-Cookie', cookie);
    return headers;
  }

  private async call<T>(
    method: string,
    path: string,
    body: Body,
    isRetry = false,
  ): Promise<ApiResult<T>> {
    if (method !== 'GET') this.profile = undefined;
    const response = await this.fetchImpl(new URL(path, this.env.API_URL), {
      method,
      headers: this.requestHeaders(body),
      body:
        body === undefined
          ? undefined
          : 'json' in body
            ? JSON.stringify(body.json)
            : body.form,
      redirect: 'manual',
    });
    this.absorbCookies(response);

    if (
      response.status === 401 &&
      !isRetry &&
      !NO_RENEWAL.has(path) &&
      this.jar.has(REFRESH_COOKIE)
    ) {
      if (await this.refresh()) return this.call<T>(method, path, body, true);
    }
    return parse<T>(response);
  }

  /**
   * Parallel loaders must not each send the same refresh token: the API treats a reused
   * refresh token as stolen and ends the session. So the first caller refreshes and the
   * rest wait for it.
   */
  private refresh(): Promise<boolean> {
    this.refreshing ??= this.call(
      'POST',
      '/auth/refresh',
      undefined,
      true,
    ).then((r) => r.ok);
    return this.refreshing;
  }

  private requestHeaders(body: Body): Headers {
    const headers = new Headers({
      accept: 'application/json',
      [CSRF_HEADER]: '1',
    });
    if (body && 'json' in body) headers.set('content-type', 'application/json');
    if (this.jar.size > 0) {
      headers.set(
        'cookie',
        [...this.jar]
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('; '),
      );
    }
    const ip = this.shopperIp();
    if (ip && this.env.INTERNAL_PROXY_SECRET) {
      headers.set(PROXY_SECRET_HEADER, this.env.INTERNAL_PROXY_SECRET);
      headers.set(FORWARDED_CLIENT_IP_HEADER, ip);
    }
    const ua = this.request.headers.get('user-agent');
    if (ua) headers.set('user-agent', ua);
    return headers;
  }

  /** Only Cloudflare's header is trustworthy; anything else a browser could forge. */
  private shopperIp(): string | undefined {
    if (!this.env.TRUST_CLOUDFLARE) return undefined;
    return this.request.headers.get('cf-connecting-ip') ?? undefined;
  }

  /** Remember new cookies for later calls in this request, and relay them to the browser. */
  private absorbCookies(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      this.setCookies.push(raw);
      const [pair = '', ...attributes] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const expired = attributes.some(
        (a) => /^max-age=0$/i.test(a) || /^expires=thu, 01 jan 1970/i.test(a),
      );
      if (expired || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    try {
      jar.set(name, decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      // Skip malformed cookies rather than failing the page.
    }
  }
  return jar;
}

async function parse<T>(response: Response): Promise<ApiResult<T>> {
  const text = await response.text();
  const body: unknown = text ? safeJson(text) : undefined;
  if (response.ok)
    return { ok: true, status: response.status, data: body as T };
  return {
    ok: false,
    status: response.status,
    message: errorMessage(body, response.status),
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Nest errors look like { message: string | string[] }; never show a raw stack or HTML. */
function errorMessage(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message))
      return message.filter((m) => typeof m === 'string').join(' ');
  }
  if (status === 429)
    return 'Too many requests. Please wait a moment and try again.';
  return 'Something went wrong. Please try again.';
}
