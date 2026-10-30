import type { ColorScheme, Palette } from './types.js';

/** Maps a palette's raw colours onto the light and dark UI roles. One mapping for every palette. */
export function colorSchemes(p: Palette): {
  light: ColorScheme;
  dark: ColorScheme;
} {
  return {
    light: {
      background: p.paper,
      surface: p.white,
      // Hover and highlighted panels: one step further from the page, like dark mode's.
      surfaceRaised: p.ash,
      text: p.ink,
      textMuted: p.graphite,
      border: p.ash,
      accent: p.accent,
      onAccent: p.onAccent,
      focusRing: p.accentDeep,
      success: p.green,
      warning: p.amber,
      danger: p.red,
      logo: {
        ink: p.ink,
        plate: p.ash,
        bar: p.graphite,
        accent: p.accent,
        onAccent: p.onAccent,
      },
    },
    dark: {
      background: p.night,
      surface: p.nightRaised,
      surfaceRaised: p.nightBorder,
      text: p.mist,
      textMuted: p.stone,
      border: p.nightBorder,
      accent: p.accentDark,
      onAccent: p.onAccentDark,
      focusRing: p.accentDark,
      success: p.green,
      warning: p.amber,
      danger: p.red,
      logo: {
        ink: p.mist,
        plate: p.nightBorder,
        bar: p.stone,
        accent: p.accentDark,
        onAccent: p.onAccentDark,
      },
    },
  };
}
