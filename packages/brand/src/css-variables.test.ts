import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toCssVariables, toTailwindTheme } from './css-variables.js';
import { tokens } from './tokens.js';

const css = toCssVariables(tokens);

describe('toCssVariables', () => {
  it('emits light colors on :root, kebab-cased', () => {
    expect(css).toMatch(/:root \{[^}]*--forgea-color-surface-raised: #ffffff;/);
  });

  it('applies dark colors from the OS preference unless light is pinned', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(
      `--forgea-color-background: ${tokens.color.dark.background};`,
    );
  });

  it('applies dark colors when the page pins data-theme="dark"', () => {
    expect(css).toMatch(/:root\[data-theme="dark"\] \{[^}]*--forgea-logo-ink:/);
  });

  it('emits scales with their units', () => {
    expect(css).toContain('--forgea-text-2xl: 2rem;');
    expect(css).toContain('--forgea-radius-md: 8px;');
    expect(css).toContain('--forgea-duration-base: 200ms;');
    expect(css).toContain(
      `--forgea-font-display: 'League Spartan Variable', system-ui, sans-serif;`,
    );
  });

  it('maps every color role and radius into the Tailwind theme', () => {
    const theme = toTailwindTheme(tokens);
    expect(theme).toMatch(/^@theme inline \{/);
    expect(theme).toContain(
      '--color-surface-raised: var(--forgea-color-surface-raised);',
    );
    expect(theme).toContain('--radius-pill: var(--forgea-radius-pill);');
    expect(theme).not.toContain('logo');
    // Every variable the theme references is actually defined by tokens.css.
    for (const [, name] of theme.matchAll(/var\((--forgea-[a-z0-9-]+)\)/g)) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('defines every variable the logo SVGs read', () => {
    const svgVars = new Set<string>();
    for (const file of ['logo.svg', 'logo-compact.svg', 'logo-mark.svg']) {
      const svg = readFileSync(
        new URL(`../assets/${file}`, import.meta.url),
        'utf8',
      );
      for (const [, name] of svg.matchAll(/var\((--forgea-logo-[a-z-]+)/g))
        svgVars.add(name!);
    }
    expect(svgVars.size).toBeGreaterThan(0);
    for (const name of svgVars) expect(css).toContain(`${name}:`);
  });
});
