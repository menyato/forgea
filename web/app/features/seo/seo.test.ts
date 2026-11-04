import { describe, expect, it } from 'vitest';
import {
  PRIVATE_PATHS,
  productJsonLd,
  robotsTxt,
  seoMeta,
  siteOrigin,
  sitemapXml,
} from './seo';

const origin = 'https://forgea-lab.com';
const product = {
  slug: 'phone-stand',
  name: 'Phone stand',
  description: 'Holds a phone.',
  category: { slug: 'home-desk', name: 'Home & desk' },
  price: '12.50',
  imageKeys: [] as string[],
};

describe('siteOrigin', () => {
  it("reads the root loader's site address", () => {
    expect(siteOrigin([{ id: 'root', loaderData: { siteUrl: origin } }])).toBe(
      origin,
    );
  });

  it('is null when the root has no data (an error page)', () => {
    expect(siteOrigin([{ id: 'root' }, undefined])).toBeNull();
  });
});

describe('seoMeta', () => {
  it('gives the canonical address and link-preview tags on the real site', () => {
    const meta = seoMeta({
      origin,
      path: '/shop',
      title: 'Shop — Forgea',
      description: 'Shop.',
    });
    expect(meta).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'https://forgea-lab.com/shop',
    });
    expect(meta).toContainEqual({
      property: 'og:url',
      content: 'https://forgea-lab.com/shop',
    });
    expect(meta).toContainEqual({
      property: 'og:image',
      content: 'https://forgea-lab.com/social-card.png',
    });
  });

  it("uses the page's own picture when it has one", () => {
    const meta = seoMeta({
      origin,
      path: '/products/x',
      title: 'X',
      description: 'X.',
      image: '/media/clean/abc.jpg',
    });
    expect(meta).toContainEqual({
      property: 'og:image',
      content: 'https://forgea-lab.com/media/clean/abc.jpg',
    });
  });

  it('keeps only the title and description without a site address', () => {
    expect(
      seoMeta({ origin: null, path: '/', title: 'T', description: 'D' }),
    ).toEqual([{ title: 'T' }, { name: 'description', content: 'D' }]);
  });
});

describe('productJsonLd', () => {
  it('describes a made-to-order product with its USD price', () => {
    const ld = productJsonLd(product, origin)['script:ld+json'] as Record<
      string,
      unknown
    >;
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Phone stand',
      url: 'https://forgea-lab.com/products/phone-stand',
      category: 'Home & desk',
      image: ['https://forgea-lab.com/social-card.png'],
      offers: {
        price: '12.50',
        priceCurrency: 'USD',
        availability: 'https://schema.org/MadeToOrder',
      },
    });
  });

  it("lists the product's photos as absolute addresses", () => {
    const ld = productJsonLd(
      { ...product, imageKeys: ['clean/a.jpg', 'clean/b.png'] },
      origin,
    )['script:ld+json'] as { image: string[] };
    expect(ld.image).toEqual([
      'https://forgea-lab.com/media/clean/a.jpg',
      'https://forgea-lab.com/media/clean/b.png',
    ]);
  });
});

describe('robotsTxt', () => {
  it('keeps crawlers out of every private page and names the sitemap', () => {
    const txt = robotsTxt(origin);
    for (const path of PRIVATE_PATHS)
      expect(txt).toContain(`Disallow: ${path}\n`);
    expect(txt).toContain('Sitemap: https://forgea-lab.com/sitemap.xml');
    expect(txt).not.toMatch(/^Disallow: \/$/m);
  });
});

describe('sitemapXml', () => {
  it('lists the public pages and every product, escaped', () => {
    const xml = sitemapXml(origin, ['phone-stand', 'a&b']);
    expect(xml).toContain('<loc>https://forgea-lab.com/</loc>');
    expect(xml).toContain('<loc>https://forgea-lab.com/shop</loc>');
    expect(xml).toContain(
      '<loc>https://forgea-lab.com/products/phone-stand</loc>',
    );
    expect(xml).toContain('<loc>https://forgea-lab.com/products/a&amp;b</loc>');
    expect(xml).not.toContain('/admin');
  });
});
