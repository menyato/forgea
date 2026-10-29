import { type Profile, Role } from '@forgea/types';
import { useEffect, useRef } from 'react';
import { Form, Link, NavLink, useLocation } from 'react-router';
import { Logo } from '~/components/brand/logo';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import type { Theme } from '~/features/theme/theme';
import { ThemeToggle } from '~/features/theme/theme-toggle';
import { PAGE_WIDTH } from './page-width';

const navLink = ({ isActive }: { isActive: boolean }) =>
  `rounded-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring ${
    isActive ? 'font-semibold text-text' : 'text-text-muted'
  }`;

interface HeaderProps {
  user: Profile | null;
  cartCount: number;
  whatsappPhone: string | null;
  theme: Theme;
}

export function SiteHeader(props: HeaderProps) {
  const { cartCount } = props;
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div
        className={`${PAGE_WIDTH} flex h-[4.5rem] items-center justify-between gap-6`}
      >
        <Link
          to="/"
          aria-label="Forgea — home"
          className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
          <Logo
            variant="compact"
            className="block w-28 [&_svg]:h-auto [&_svg]:w-full"
          />
        </Link>

        {/* Laptop and tablet: everything in one row. */}
        <nav
          aria-label="Main"
          className="hidden flex-1 items-center gap-6 text-sm md:flex"
        >
          <Links {...props} />
          <span className="flex-1" />
          <Account {...props} />
        </nav>

        {/* Phone: the cart stays in reach; the rest folds into a menu. */}
        <div className="flex items-center gap-4 text-sm md:hidden">
          <CartLink count={cartCount} />
          <PhoneMenu {...props} />
        </div>
      </div>
    </header>
  );
}

function Links({ user, whatsappPhone, cartCount }: HeaderProps) {
  return (
    <>
      <NavLink to="/shop" className={navLink}>
        Shop
      </NavLink>
      <NavLink to="/custom" className={navLink}>
        Custom order
      </NavLink>
      {user && (
        <NavLink to="/orders" className={navLink}>
          My orders
        </NavLink>
      )}
      {user && (
        <NavLink to="/requests" className={navLink}>
          My requests
        </NavLink>
      )}
      {user && (
        <NavLink to="/account" className={navLink}>
          My account
        </NavLink>
      )}
      {whatsappPhone && (
        <WhatsAppLink
          phone={whatsappPhone}
          message="Hello Forgea! I have a question."
          className={navLink({ isActive: false })}
        >
          WhatsApp
        </WhatsAppLink>
      )}
      {user && user.role !== Role.CUSTOMER && (
        <NavLink to="/admin" className={navLink}>
          Dashboard
        </NavLink>
      )}
      <span className="hidden md:contents">
        <CartLink count={cartCount} />
      </span>
    </>
  );
}

function Account({ user, theme }: HeaderProps) {
  return (
    <>
      {user ? (
        <Form
          method="post"
          action="/sign-out"
          className="flex items-center gap-3"
        >
          <span className="max-w-[16ch] truncate text-text-muted">
            {user.name ?? user.email}
          </span>
          <button
            type="submit"
            className="text-text-muted underline-offset-4 hover:text-text hover:underline"
          >
            Sign out
          </button>
        </Form>
      ) : (
        <NavLink to="/sign-in" className={navLink}>
          Sign in
        </NavLink>
      )}
      <ThemeToggle
        theme={theme}
        className="rounded-pill border border-border px-3 py-1 text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
      />
    </>
  );
}

function CartLink({ count }: { count: number }) {
  return (
    <NavLink
      to="/cart"
      className={navLink}
      aria-label={
        count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart'
      }
    >
      Cart
      {count > 0 && (
        <span className="ml-1.5 rounded-pill bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">
          {count}
        </span>
      )}
    </NavLink>
  );
}

/**
 * A disclosure, so it opens without JavaScript too. It closes itself after a navigation,
 * since the header stays on screen between pages.
 */
function PhoneMenu(props: HeaderProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  return (
    <details ref={menu} className="group">
      <summary className="cursor-pointer list-none rounded-md border border-border px-3 py-1.5 font-medium [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Menu</span>
        <span className="hidden group-open:inline">Close</span>
      </summary>
      <nav
        aria-label="Main"
        className={`absolute inset-x-0 top-full grid gap-5 border-b border-border bg-background py-6 text-base shadow-lg ${PAGE_WIDTH}`}
      >
        <Links {...props} />
        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5">
          <Account {...props} />
        </div>
      </nav>
    </details>
  );
}
