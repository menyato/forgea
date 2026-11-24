import { unlessAsking } from '~/lib/revalidate';
import { isPalette, paletteCss, type SiteTheme } from '@forgea/brand';
import type {
  CartView,
  CurrentFreeOffer,
  Profile,
  StoreSettings,
} from '@forgea/types';
import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
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
import { ErrorScreen } from './components/error-screen';
import { OfferBanner } from './components/layout/offer-banner';
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
// favicon.ico (16/32/48) is for search results and old browsers; the touch icon for phones'
// home screens. Both are PNG renders of favicon.svg's light colours.
export const links: Route.LinksFunction = () => [
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
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
  const [me, cart, store, siteTheme, theme, offer] = await Promise.all([
    api.hasSession ? api.me() : Promise.resolve(null),
    // A first visit has no cart yet: nothing to ask.
    api.hasSession || api.hasCart
      ? api.get<CartView>('/cart')
      : Promise.resolve(null),
    api.shared<StoreSettings>('/store-settings'),
    api.shared<{ theme: SiteTheme | null }>('/site-theme'),
    readTheme(request),
    // The free offer running now (none: nothing comes back), for the shop's banner.
    api.shared<CurrentFreeOffer | undefined>('/offers/current'),
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
    offer: offer.ok && offer.data?.id ? offer.data : null,
    // The real public address, for canonical links and link previews (features/seo).
    siteUrl: serverEnv().PUBLIC_WEB_URL,
  };
}

/**
 * The shell's data (who is signed in, the cart count, store numbers, the palette) changes only
 * when something is sent: adding to the cart, signing in or out, saving a setting. Moving from
 * page to page keeps it, so a click costs one page's calls, not the shell's four as well.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  const { formMethod } = args;
  // A post that only asks something (a price preview, a file read) changes nothing here.
  if (formMethod && formMethod.toUpperCase() !== 'GET')
    return unlessAsking(args);
  return false;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>('root');
  const theme = useOptimisticTheme(data?.theme ?? 'auto');
  const inDashboard = useLocation().pathname.startsWith('/admin');
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
        {!inDashboard && data?.offer && <OfferBanner offer={data.offer} />}
        <PageLoading />
        <div id="main">{children}</div>
        {/* The dashboard is a workplace: the shop's footer stays with the shop. */}
        {!inDashboard && <SiteFooter store={data?.store ?? null} />}
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
  return <ErrorScreen error={error} />;
}
