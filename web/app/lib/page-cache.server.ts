import { isbot } from 'isbot';

/**
 * Public pages, built once and reused for a short while: for a visitor who isn't signed in
 * and has no cart, the home page, the shop, a product page, the custom-order and contact pages
 * are the same for everyone (only the chosen light/dark theme differs, so it is part of the
 * key). Under a rush the server builds each page once every 30 seconds instead of once per
 * visitor; anyone signed in, with a cart or mid-sign-up always gets a page built for them.
 *
 * Anything the team saves in the dashboard clears them all, so a change shows at once.
 *
 * Never kept: anything but a 200, any response that sets a cookie, anything for a request
 * carrying one of our cookies (other than the theme), every other path (cart, checkout,
 * account, orders, the dashboard, quotation links, media). So nothing personal can be reused.
 */
const TTL_MS = 30_000;
const MAX_ENTRIES = 300;
const MAX_BYTES = 2_000_000;

/** The pages, and the data requests React Router makes for them when navigating in the browser. */
const PUBLIC = [
  /^\/(?:_root\.data)?$/,
  /^\/(?:shop|custom|contact)(?:\.data)?$/,
  /^\/products\/[a-z0-9-]{1,120}(?:\.data)?$/,
];

interface Entry {
  until: number;
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

const entries = new Map<string, Entry>();
/** Pages being built right now: others asking for the same one wait for it. */
const building = new Map<string, Promise<Entry | null>>();

type Next = () => Promise<Response>;

export async function pageCacheMiddleware(
  { request }: { request: Request },
  next: Next,
): Promise<Response> {
  // The team saved something in the dashboard (a product, a price, the theme): visitors see
  // it at once, not after the pages they were shown run out.
  if (
    request.method !== 'GET' &&
    new URL(request.url).pathname.startsWith('/admin')
  ) {
    const response = await next();
    if (response.status < 400) entries.clear();
    return response;
  }
  const key = cacheKey(request);
  if (!key) return next();

  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.until > now) return toResponse(hit, 'hit');
  if (hit) entries.delete(key);

  const pending = building.get(key);
  if (pending) {
    const built = await pending;
    if (built) return toResponse(built, 'hit');
    return next();
  }

  let done: (e: Entry | null) => void = () => undefined;
  building.set(
    key,
    new Promise<Entry | null>((resolve) => {
      done = resolve;
    }),
  );
  try {
    const response = await next();
    if (!keepable(response)) {
      done(null);
      building.delete(key);
      return response;
    }
    // The visitor gets the page as it streams; the copy is kept once it has all arrived.
    void response
      .clone()
      .arrayBuffer()
      .then((body) => {
        if (body.byteLength > MAX_BYTES) return done(null);
        const entry: Entry = {
          until: Date.now() + TTL_MS,
          status: response.status,
          headers: [...response.headers].filter(
            ([name]) => name !== 'content-length',
          ),
          body,
        };
        remember(key, entry);
        done(entry);
      })
      .catch(() => done(null))
      .finally(() => building.delete(key));
    return withCacheHeader(response, 'miss');
  } catch (error) {
    done(null);
    building.delete(key);
    throw error;
  }
}

/** The key for a request whose page may be shared, or null when it must be built for it. */
function cacheKey(request: Request): string | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (!PUBLIC.some((p) => p.test(url.pathname))) return null;
  if (url.search.length > 300) return null;
  if (request.headers.has('authorization')) return null;
  let theme = '';
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const name = part.split('=')[0]!.trim();
    if (name === 'forgea_theme')
      theme = part.slice(part.indexOf('=') + 1).trim();
    // Signed in, a cart, mid-sign-up…: this visitor's page is their own.
    else if (name.startsWith('forgea_')) return null;
  }
  // Search engines get the whole page at once, browsers get it streamed: kept apart.
  const bot = isbot(request.headers.get('user-agent') ?? '') ? 'bot' : 'web';
  return `${bot}|${theme.slice(0, 200)}|${url.pathname}${url.search}`;
}

function keepable(response: Response): boolean {
  return (
    response.status === 200 &&
    !response.headers.has('set-cookie') &&
    response.body !== null
  );
}

function remember(key: string, entry: Entry): void {
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

function toResponse(entry: Entry, state: 'hit'): Response {
  const headers = new Headers(entry.headers);
  headers.set('x-forgea-page-cache', state);
  return new Response(entry.body.slice(0), { status: entry.status, headers });
}

function withCacheHeader(response: Response, state: 'miss'): Response {
  try {
    response.headers.set('x-forgea-page-cache', state);
    return response;
  } catch {
    // Immutable headers (a redirect, a fetched response): passed on as they are.
    return response;
  }
}
