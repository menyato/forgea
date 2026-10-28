import { useFetcher, useLocation } from 'react-router';
import { isTheme, nextTheme, type Theme, THEME_LABELS } from './theme';

const ICONS: Readonly<Record<Theme, string>> = {
  auto: '◐',
  light: '☀',
  dark: '☾',
};

/** One fetcher for the whole page, so <html> and the button agree while a change is saved. */
const useThemeFetcher = () => useFetcher({ key: 'theme' });

/** The theme to show right now: the one being saved, else the saved one. */
export function useOptimisticTheme(saved: Theme): Theme {
  const pending = useThemeFetcher().formData?.get('theme');
  return isTheme(pending) ? pending : saved;
}

/**
 * One button cycling Auto → Light → Dark. Works without JavaScript (a plain form post);
 * with it, the page switches instantly while the choice is saved.
 */
export function ThemeToggle({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  const fetcher = useThemeFetcher();
  const current = useOptimisticTheme(theme);
  const next = nextTheme(current);
  const { pathname, search } = useLocation();
  return (
    <fetcher.Form method="post" action="/theme">
      <input type="hidden" name="theme" value={next} />
      <input type="hidden" name="returnTo" value={pathname + search} />
      <button
        type="submit"
        className={className}
        aria-label={`Theme: ${THEME_LABELS[current]}. Switch to ${THEME_LABELS[next]}.`}
      >
        <span aria-hidden="true">{ICONS[current]}</span> {THEME_LABELS[current]}
      </button>
    </fetcher.Form>
  );
}
