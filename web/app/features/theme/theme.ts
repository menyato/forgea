/** "auto" follows the device's light/dark setting; the others pin one. */
const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Readonly<Record<Theme, string>> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

export const isTheme = (value: unknown): value is Theme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

/** The toggle's next step: auto → light → dark → auto. */
export function nextTheme(theme: Theme): Theme {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
}
