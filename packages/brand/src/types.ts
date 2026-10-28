/** Colors for one theme. Every UI surface and the logo read from these roles, never from raw hex. */
export interface ColorScheme {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  onAccent: string;
  focusRing: string;
  success: string;
  warning: string;
  danger: string;
  logo: LogoColors;
}

/** Fills used by packages/brand/assets/*.svg (via --forgea-logo-* custom properties). */
export interface LogoColors {
  ink: string;
  plate: string;
  bar: string;
  accent: string;
  onAccent: string;
}

/** Raw colours of one candidate palette; tokens.ts maps them onto ColorScheme roles. */
export interface Palette {
  ink: string;
  graphite: string;
  stone: string;
  ash: string;
  paper: string;
  white: string;
  accent: string;
  /** Darker accent for focus rings and hover states. */
  accentDeep: string;
  /** Text/icon colour placed on the accent (dark or light, whichever passes contrast). */
  onAccent: string;
  /** Accent used in the dark theme; lighter when the main accent is too dark to read on `night`. */
  accentDark: string;
  onAccentDark: string;
  night: string;
  nightRaised: string;
  nightBorder: string;
  mist: string;
  green: string;
  amber: string;
  red: string;
}

export interface FontStack {
  family: string;
  fallback: string;
}

export interface DesignTokens {
  color: { light: ColorScheme; dark: ColorScheme };
  font: { display: FontStack; body: FontStack };
  fontWeight: Record<'regular' | 'medium' | 'bold' | 'heavy', number>;
  /** Font sizes in rem, smallest to largest. */
  fontSize: Record<
    'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'display',
    number
  >;
  /** Spacing scale in rem. */
  space: Record<
    '0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10' | '12' | '16',
    number
  >;
  /** Corner radii in px. */
  radius: Record<'none' | 'sm' | 'md' | 'lg' | 'pill', number>;
  /** Durations in ms. */
  motion: Record<'fast' | 'base' | 'slow', number>;
}

/** The palette the owner saved in the dashboard (GET /site-theme); null means tokens.ts. */
export interface SiteTheme {
  palette: Palette;
  /** The built-in palette it started from, or "custom". */
  basedOn: string;
  updatedAt: string;
}
