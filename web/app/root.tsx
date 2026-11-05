import { isPalette, paletteCss, type SiteTheme } from '@forgea/brand';
import type { CartView, Profile, StoreSettings } from '@forgea/types';
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigation,
  useRouteLoaderData,
  type ShouldRevalidateFunctionArgs,
} from 'react-router';

import type { Route } from './+types/root';
// Self-hosted brand fonts (tokens.ts names them); loaded before the app's own styles.
import '@fontsource-variable/inter';
import '@fontsource-variable/league-spartan';
import './app.css';
import { PrintingLogo } from './components/brand/printing-logo';
import { SiteFooter } from './components/layout/site-footer';
import { SiteHeader } from './components/layout/site-header';
import { useOptimisticTheme } from './features/theme/theme-toggle';
import { readTheme } from './features/theme/theme.server';
import { serverEnv } from './lib/env.server';
import {
  apiContext,
  apiMiddleware,
  sameOriginMiddleware,
} from './lib/request.server';
import { pageCacheMiddleware } from './lib/page-cache.server';

// The F mark from @forgea/brand; it switches colours with the browser's own light/dark theme.
export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
];

// Public pages for visitors without our cookies are reused for a moment (page-cache); then
// cross-site form posts are refused, then every loader/action gets one shared API client.
export const middleware: Route.MiddlewareFunction[] = [
  pageCacheMiddleware,
  sameOriginMiddleware,
  apiMiddleware,
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [me, cart, store, siteTheme, theme] = await Promise.all([
    api.hasSession ? api.me() : Promise.resolve(null),
    // A first visit has no cart yet: nothing to ask.
    api.hasSession || api.hasCart
      ? api.get<CartView>('/cart')
      : Promise.resolve(null),
    api.shared<StoreSettings>('/store-settings'),
    api.shared<{ theme: SiteTheme | null }>('/site-theme'),
    readTheme(request),
  ]);
  // The owner's palette (Theme page); checked again here because it goes into a <style>.
  const palette = siteTheme.ok ? siteTheme.data.theme?.palette : undefined;
  return {
    user: me?.ok ? me.data : null,
    cartCount: cart?.ok ? cart.data.itemCount : 0,
    // The payment and WhatsApp numbers; pages work without them if the API is down.
    store: store.ok ? store.data : null,
    paletteCss: isPalette(palette) ? paletteCss(palette) : null,
    theme,
    // The real public address, for canonical links and link previews (features/seo).
    siteUrl: serverEnv().PUBLIC_WEB_URL,
  };
}

/**
 * The shell's data (who is signed in, the cart count, store numbers, the palette) changes only
 * when something is sent: adding to the cart, signing in or out, saving a setting. Moving from
 * page to page keeps it, so a click costs one page's calls, not the shell's four as well.
 */
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== 'GET')
    return defaultShouldRevalidate;
  return false;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root');
  const theme = useOptimisticTheme(data?.theme ?? 'auto');
  return (
    // The tokens' CSS switches palettes on data-theme; without it, the device setting wins.
    <html lang="en" data-theme={theme === 'auto' ? undefined : theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* After tokens.css, so the owner's colours win; only #rrggbb values reach it. */}
        {data?.paletteCss && (
          <style dangerouslySetInnerHTML={{ __html: data.paletteCss }} />
        )}
      </head>
      <body className="flex min-h-dvh flex-col [&>#main]:flex-1">
        <a
          href="#main"
          className="sr-only rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30"
        >
          Skip to content
        </a>
        <SiteHeader
          user={data?.user ?? null}
          cartCount={data?.cartCount ?? 0}
          whatsappPhone={data?.store?.whatsappPhone ?? null}
          theme={theme}
        />
        <PageLoading />
        <div id="main">{children}</div>
        <SiteFooter store={data?.store ?? null} />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/** While the next page loads, the logo prints in the corner (only if it takes a moment). */
function PageLoading() {
  const loading = useNavigation().state === 'loading';
  return loading ? (
    <div
      role="status"
      aria-label="Loading"
      className="forgea-page-loading pointer-events-none fixed bottom-4 right-4 z-30 rounded-lg bg-surface p-2 shadow-lg"
    >
      <PrintingLogo mode="loop" className="w-8" />
    </div>
  ) : null;
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = 'Something went wrong';
  let details = 'Please try again in a moment.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Page not found';
      details = "That page doesn't exist, or it has moved.";
    } else if (error.status === 403) {
      title = 'Not allowed';
      // Our own refusals say why (e.g. a dashboard page someone's permissions don't cover).
      details =
        typeof error.data === 'string' && error.data
          ? error.data
          : 'This request was refused.';
    } else if (error.status === 429 || error.status === 503) {
      title = 'One moment';
      details =
        'We are getting a lot of requests right now. Please wait a few seconds and reload.';
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16">
      <PrintingLogo className="w-24" />
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <p className="text-text-muted">{details}</p>
      <p>
        <Link to="/" className="underline underline-offset-4">
          Back to the home page
        </Link>
      </p>
      {stack && (
        <pre className="overflow-x-auto rounded-md bg-surface p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
