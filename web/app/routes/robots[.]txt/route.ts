import { robotsTxt } from '~/features/seo/seo';
import { serverEnv } from '~/lib/env.server';

/** /robots.txt — what search engines may crawl, and where the sitemap is. */
export function loader() {
  return new Response(robotsTxt(serverEnv().PUBLIC_WEB_URL), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
