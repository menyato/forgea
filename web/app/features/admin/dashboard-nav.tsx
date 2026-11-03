import type { Profile } from '@forgea/types';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { MENU_GROUPS, type MenuGroup, mayOpen, PAGES } from './access';

const STORAGE_KEY = 'forgea_dashboard_menu';

/** The current page stands out: the accent, bold, and a bar on its left edge. */
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md border-l-4 px-3 py-1.5 text-sm ${
    isActive
      ? 'border-focus-ring bg-accent font-semibold text-on-accent shadow-sm'
      : 'border-transparent text-text-muted hover:bg-surface-raised hover:text-text'
  }`;

/** Groups someone opened or closed, remembered in this browser only (a convenience). */
function remembered(): Partial<Record<MenuGroup, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<
      Record<MenuGroup, boolean>
    >;
  } catch {
    return {};
  }
}

/**
 * The dashboard menu, grouped like apps (Sales, Orders, Accounting, Catalog, Settings), each
 * folding open to its pages. Only pages this person may open are listed; a group with none
 * is left out. The group of the current page is always open.
 */
export function DashboardNav({ staff }: { staff: Profile }) {
  const { pathname } = useLocation();
  const pages = PAGES.filter((p) => p.label && mayOpen(staff, p.access));
  const current = pages
    .filter(
      (p) =>
        p.group && (pathname === p.path || pathname.startsWith(`${p.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0]?.group;
  // The server renders every group open; this browser's choices apply once it has loaded.
  const [open, setOpen] = useState<Partial<Record<MenuGroup, boolean>>>({});
  useEffect(() => setOpen(remembered()), []);
  // A long menu scrolls to the page you are on.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [pathname]);
  const toggle = (group: MenuGroup, isOpen: boolean) => {
    const next = { ...open, [group]: isOpen };
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage refused (private window): the menu still works, it just won't remember.
    }
  };

  return (
    <nav ref={nav} aria-label="Dashboard" className="grid gap-1">
      {pages
        .filter((p) => !p.group)
        .map((p) => (
          <NavLink key={p.path} to={p.path} end className={linkClass}>
            {p.label}
          </NavLink>
        ))}
      {MENU_GROUPS.map((group) => {
        const inGroup = pages.filter((p) => p.group === group);
        if (inGroup.length === 0) return null;
        const isOpen = group === current || (open[group] ?? true);
        return (
          <details
            key={group}
            open={isOpen}
            onToggle={(e) => {
              const now = e.currentTarget.open;
              if (now !== isOpen) toggle(group, now);
            }}
            className="group"
          >
            <summary
              className={`flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wide hover:text-text [&::-webkit-details-marker]:hidden ${
                group === current ? 'text-text' : 'text-text-muted'
              }`}
            >
              <span className="flex items-center gap-2">
                {group === current && (
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-accent"
                  />
                )}
                {group}
              </span>
              <span
                aria-hidden
                className="transition-transform group-open:rotate-90"
              >
                ›
              </span>
            </summary>
            <ul className="grid gap-0.5 pb-2 pl-2">
              {inGroup
                .filter((p) => !p.config)
                .map((p) => (
                  <li key={p.path}>
                    <NavLink
                      to={p.path}
                      end={p.path === '/admin/accounting'}
                      className={linkClass}
                    >
                      {p.label}
                    </NavLink>
                  </li>
                ))}
              {inGroup.some((p) => p.config) && (
                <li className="mt-1 px-3 pt-1 text-[0.7rem] font-semibold uppercase tracking-wide text-text-muted">
                  Configuration
                </li>
              )}
              {inGroup
                .filter((p) => p.config)
                .map((p) => (
                  <li key={p.path}>
                    <NavLink to={p.path} className={linkClass}>
                      {p.label}
                    </NavLink>
                  </li>
                ))}
            </ul>
          </details>
        );
      })}
    </nav>
  );
}
