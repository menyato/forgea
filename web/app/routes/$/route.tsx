/**
 * Any address no other route has (old links, typos, bots probing /wp-login.php): the site's own
 * "Page not found", as a 404 the server doesn't log as an error.
 */
export function loader() {
  throw new Response('Not found', { status: 404 });
}

export default function NotFound() {
  return null;
}
