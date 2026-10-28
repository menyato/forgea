import { buttonClass } from '~/components/ui/button';

/** Starts Google sign-in on the API, which sends the shopper back here when done. */
export function GoogleButton({ href }: { href: string }) {
  return (
    <a href={href} className={buttonClass('secondary', 'w-full py-2.5')}>
      Continue with Google
    </a>
  );
}
