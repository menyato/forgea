import type { Profile } from '@forgea/types';
import { type ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { DashboardNav } from './dashboard-nav';

const STORAGE_KEY = 'forgea_dashboard_sidebar';

const BUTTON =
  'flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface ' +
  'text-text hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus-ring';

function MenuIcon({ arrow }: { arrow: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className="size-5 fill-none stroke-current stroke-2"
    >
      {arrow ? (
        <path
          d="M12.5 4.5 7 10l5.5 5.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" strokeLinecap="round" />
      )}
    </svg>
  );
}

/**
 * The dashboard frame: the menu down the left side, beside the page.
 *
 * - Wide screens: it folds away to a thin strip with one button (the page then takes the full
 *   width) and comes back the same way; the choice is remembered in this browser.
 * - Phones: it is closed, opens over the page with the menu button, and closes once a page is
 *   chosen.
 *
 * Which of the two applies is decided by CSS (`md:`), so the first paint is already right.
 */
export function DashboardShell({
  staff,
  children,
}: {
  staff: Profile;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const [folded, setFolded] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try {
      setFolded(localStorage.getItem(STORAGE_KEY) === 'folded');
    } catch {
      // Storage refused (private window): the menu starts open.
    }
  }, []);
  // On a phone, choosing a page closes the menu over it.
  useEffect(() => setDrawer(false), [pathname]);

  const fold = () => {
    const next = !folded;
    setFolded(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'folded' : 'open');
    } catch {
      // Not remembered; the menu still works.
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-4.5rem)]">
      {drawer && (
        <div
          aria-hidden
          onClick={() => setDrawer(false)}
          className="fixed inset-x-0 top-[4.5rem] bottom-0 z-20 bg-text/30 md:hidden"
        />
      )}
      <aside
        className={`fixed top-[4.5rem] bottom-0 left-0 z-30 w-72 shrink-0 border-r border-border bg-surface transition-[transform,width] duration-200 md:sticky md:z-auto md:h-[calc(100dvh-4.5rem)] md:translate-x-0 ${
          drawer ? 'translate-x-0' : '-translate-x-full max-md:invisible'
        } ${folded ? 'md:w-14' : 'md:w-64'}`}
      >
        <div className="flex h-full flex-col">
          <div
            className={`flex items-center justify-between gap-3 p-3 ${folded ? 'md:justify-center' : ''}`}
          >
            <div className={`min-w-0 ${folded ? 'md:hidden' : ''}`}>
              <p className="font-display text-lg leading-tight font-bold">
                Dashboard
              </p>
              <p className="truncate text-xs text-text-muted">
                {staff.name ?? staff.email}
              </p>
            </div>
            {/* Wide screens: fold to a strip, or open again. */}
            <button
              type="button"
              onClick={fold}
              aria-expanded={!folded}
              aria-controls="dashboard-menu"
              className={`${BUTTON} max-md:hidden`}
            >
              <span className="sr-only">
                {folded ? 'Show the menu' : 'Hide the menu'}
              </span>
              <MenuIcon arrow={!folded} />
            </button>
            {/* Phones: close the menu over the page. */}
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-expanded={drawer}
              aria-controls="dashboard-menu"
              className={`${BUTTON} md:hidden`}
            >
              <span className="sr-only">Hide the menu</span>
              <MenuIcon arrow />
            </button>
          </div>
          <div
            id="dashboard-menu"
            className={`min-h-0 flex-1 overflow-y-auto px-2 pb-6 ${folded ? 'md:hidden' : ''}`}
          >
            <DashboardNav staff={staff} />
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10">
        {/* Phones: open the menu over the page. */}
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-expanded={drawer}
          aria-controls="dashboard-menu"
          className={`${BUTTON} mb-4 md:hidden`}
        >
          <span className="sr-only">Show the menu</span>
          <MenuIcon arrow={false} />
        </button>
        {children}
      </div>
    </div>
  );
}
