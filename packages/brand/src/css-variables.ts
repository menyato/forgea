import { colorSchemes } from './color-schemes.js';
import type { ColorScheme, DesignTokens, Palette } from './types.js';

const PREFIX = '--forgea';

/** camelCase → kebab-case, e.g. surfaceRaised → surface-raised, 2xl stays 2xl. */
function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** A scheme as CSS custom properties, e.g. { "--forgea-color-accent": "#c87533" }. */
export function schemeVariables(scheme: ColorScheme): Record<string, string> {
  const { logo, ...roles } = scheme;
  return Object.fromEntries([
    ...Object.entries(roles).map(([k, v]) => [
      `${PREFIX}-color-${kebab(k)}`,
      v,
    ]),
    ...Object.entries(logo).map(([k, v]) => [`${PREFIX}-logo-${kebab(k)}`, v]),
  ]);
}

function schemeDeclarations(scheme: ColorScheme): string[] {
  return Object.entries(schemeVariables(scheme)).map(([k, v]) => `${k}: ${v};`);
}

function scaleDeclarations(
  group: string,
  scale: Record<string, number>,
  unit: string,
): string[] {
  return Object.entries(scale).map(
    ([k, v]) => `${PREFIX}-${group}-${kebab(k)}: ${v}${unit};`,
  );
}

function block(selector: string, declarations: string[], indent = ''): string {
  return `${indent}${selector} {\n${declarations.map((d) => `${indent}  ${d}`).join('\n')}\n${indent}}`;
}

/**
 * Light is the default; dark applies via the OS preference unless the page pins
 * data-theme="light", and always when it pins data-theme="dark".
 */
function themed(base: string[], dark: string[]): string {
  return (
    [
      block(':root', base),
      `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', dark, '  ')}\n}`,
      block(':root[data-theme="dark"]', dark),
    ].join('\n\n') + '\n'
  );
}

/**
 * Renders a Tailwind v4 `@theme inline` block that maps utility names onto the
 * --forgea-* variables, so `bg-surface` or `text-accent` follow the active theme.
 */
export function toTailwindTheme(t: DesignTokens): string {
  const { logo: _logo, ...roles } = t.color.light;
  const lines = [
    ...Object.keys(roles).map(
      (k) => `--color-${kebab(k)}: var(${PREFIX}-color-${kebab(k)});`,
    ),
    `--font-display: var(${PREFIX}-font-display);`,
    `--font-sans: var(${PREFIX}-font-body);`,
    ...Object.keys(t.radius).map(
      (k) => `--radius-${kebab(k)}: var(${PREFIX}-radius-${kebab(k)});`,
    ),
  ];
  return block('@theme inline', lines) + '\n';
}

/** Renders tokens as CSS custom properties (colours for light and dark, fonts, scales). */
export function toCssVariables(t: DesignTokens): string {
  const base = [
    ...schemeDeclarations(t.color.light),
    `${PREFIX}-font-display: '${t.font.display.family}', ${t.font.display.fallback};`,
    `${PREFIX}-font-body: '${t.font.body.family}', ${t.font.body.fallback};`,
    ...scaleDeclarations('weight', t.fontWeight, ''),
    ...scaleDeclarations('text', t.fontSize, 'rem'),
    ...scaleDeclarations('space', t.space, 'rem'),
    ...scaleDeclarations('radius', t.radius, 'px'),
    ...scaleDeclarations('duration', t.motion, 'ms'),
  ];
  return themed(base, schemeDeclarations(t.color.dark));
}

/**
 * Only the colours of a palette the owner picked in the dashboard. Placed after tokens.css,
 * it overrides the default colours with the same selectors, so light/dark keep working.
 */
export function paletteCss(palette: Palette): string {
  const { light, dark } = colorSchemes(palette);
  return themed(schemeDeclarations(light), schemeDeclarations(dark));
}
