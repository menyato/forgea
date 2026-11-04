import type { ProductListItem } from '@forgea/types';
import type { MetaDescriptor } from 'react-router';

/** The link-preview picture (1200 × 630, from the brand kit) for pages without their own. */
const SOCIAL_CARD = '/social-card.png';

/** Pages search engines must not crawl: accounts, carts, orders, private links, the dashboard. */
export const PRIVATE_PATHS = [
  '/admin',
  '/account',
  '/cart',
  '/checkout',
  '/orders',
  '/requests',
  '/quotations',
  '/q/',
  '/sign-in',
  '/sign-out',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/theme',
  '/auth/',
] as const;

/** Public pages that are always in the sitemap, besides one entry per product. */
const SITEMAP_PAGES = ['/', '/shop', '/custom', '/contact'] as const;

/**
 * The site's own address (PUBLIC_WEB_URL), which the root loader passes down: links in search
 * results and previews must name the real site, never the address a request came in on.
 */
export function siteOrigin(
  matches: ReadonlyArray<{ id: string; loaderData?: unknown } | undefined>,
): string | null {
  const data = matches.find((m) => m?.id === 'root')?.loaderData;
  return data &&
    typeof data === 'object' &&
    'siteUrl' in data &&
    typeof data.siteUrl === 'string'
    ? data.siteUrl
    : null;
}

export interface PageSeo {
  /** From siteOrigin(); without it only the title and description are given. */
  origin: string | null;
  /** The page's canonical path (with only the query that changes its content). */
  path: string;
  title: string;
  description: string;
  /** A picture on this site for link previews (default: the brand card). */
  image?: string | undefined;
}

/** Title, description, canonical address and link-preview tags (WhatsApp, Instagram, Facebook…). */
export function seoMeta(page: PageSeo): MetaDescriptor[] {
  const basics: MetaDescriptor[] = [
    { title: page.title },
    { name: 'description', content: page.description },
  ];
  if (!page.origin) return basics;
  const url = new URL(page.path, page.origin).href;
  return [
    ...basics,
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:site_name', content: 'Forgea' },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: url },
    { property: 'og:title', content: page.title },
    { property: 'og:description', content: page.description },
    {
      property: 'og:image',
      content: new URL(page.image ?? SOCIAL_CARD, page.origin).href,
    },
    { name: 'twitter:card', content: 'summary_large_image' },
  ];
}

/**
 * Product structured data (schema.org), so search results can show the price. Every piece is
 * printed to order; the price is the API's, with the default options, in the base currency.
 */
export function productJsonLd(
  product: Pick<
    ProductListItem,
    'slug' | 'name' | 'description' | 'category' | 'price'
  > & {
    imageKeys: readonly string[];
  },
  origin: string,
): { 'script:ld+json': Record<string, unknown> } {
  const url = new URL(`/products/${product.slug}`, origin).href;
  const images = product.imageKeys.length
    ? product.imageKeys.map((key) => new URL(`/media/${key}`, origin).href)
    : [new URL(SOCIAL_CARD, origin).href];
  return {
    'script:ld+json': {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description,
      sku: product.slug,
      url,
      image: images,
      brand: { '@type': 'Brand', name: 'Forgea' },
      ...(product.category ? { category: product.category.name } : {}),
      offers: {
        '@type': 'Offer',
        url,
        price: product.price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/MadeToOrder',
      },
    },
  };
}

/** robots.txt: everything public may be crawled; private pages may not; where the sitemap is. */
export function robotsTxt(origin: string): string {
  return [
    'User-agent: *',
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${new URL('/sitemap.xml', origin).href}`,
    '',
  ].join('\n');
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** sitemap.xml for the public pages and every product (by slug). */
export function sitemapXml(
  origin: string,
  productSlugs: readonly string[],
): string {
  const paths = [
    ...SITEMAP_PAGES,
    ...productSlugs.map((slug) => `/products/${slug}`),
  ];
  const urls = paths.map(
    (path) =>
      `  <url><loc>${escapeXml(new URL(path, origin).href)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
