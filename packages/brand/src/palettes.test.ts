import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.js';
import { paletteCss } from './css-variables.js';
import {
  fixContrast,
  isPalette,
  PALETTE_KEYS,
  paletteChecks,
} from './palette-checks.js';
import { palettes } from './palettes.js';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#123456', '#123456')).toBe(1);
  });

  it('rejects colours that are not #rrggbb', () => {
    expect(() => contrastRatio('red', '#ffffff')).toThrow(/#rrggbb/);
  });
});

describe.each(Object.entries(palettes))('palette "%s"', (_name, palette) => {
  it('passes every readability check in light and dark mode', () => {
    const checks = paletteChecks(palette);
    expect(checks).toHaveLength(12);
    expect(checks.filter((c) => !c.passes)).toEqual([]);
  });

  it('is a complete palette', () => {
    expect(isPalette(palette)).toBe(true);
  });
});

describe('paletteChecks', () => {
  it('names what fails, with the ratio and what is required', () => {
    const pale = { ...palettes.copper, accent: '#f0f0f0', onAccent: '#ffffff' };
    const failed = paletteChecks(pale).filter((c) => !c.passes);
    expect(failed).toEqual([
      expect.objectContaining({
        mode: 'light',
        label: 'Text on buttons',
        required: 4.5,
      }),
    ]);
    expect(failed[0]!.ratio).toBeLessThan(1.2);
  });
});

describe('isPalette', () => {
  it.each([
    ['a missing colour', { ...palettes.copper, red: undefined }],
    ['a colour that is not #rrggbb', { ...palettes.copper, red: 'red' }],
    ['an extra key', { ...palettes.copper, extra: '#000000' }],
    ['not an object', ['#000000']],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(isPalette(value)).toBe(false);
  });

  it('lists every colour once', () => {
    expect(new Set(PALETTE_KEYS).size).toBe(
      Object.keys(palettes.copper).length,
    );
  });
});

describe('paletteCss', () => {
  it('overrides only colours, for light, dark preference and pinned dark', () => {
    const css = paletteCss(palettes.maroon);
    expect(css).toContain('--forgea-color-accent: #8a1538;');
    expect(css).toMatch(
      /:root\[data-theme="dark"\] \{[^}]*--forgea-color-accent: #e8798f;/,
    );
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).not.toContain('--forgea-font');
  });
});

describe('fixContrast', () => {
  it('changes only the colours that fail, just enough to pass', () => {
    const chosen = {
      ...palettes.copper,
      accent: '#f4b183',
      onAccent: '#ffffff',
      stone: '#3a3a3a',
    };
    const fixed = fixContrast(chosen);
    expect(paletteChecks(fixed).filter((c) => !c.passes)).toEqual([]);
    // The owner's accent stays; the text on it and the dark secondary text move.
    expect(fixed.accent).toBe('#f4b183');
    expect(fixed.onAccent).not.toBe('#ffffff');
    expect(fixed.stone).not.toBe('#3a3a3a');
    const changed = PALETTE_KEYS.filter((k) => fixed[k] !== chosen[k]);
    expect(changed.sort()).toEqual(['onAccent', 'stone']);
  });

  it('leaves a readable palette as it is', () => {
    expect(fixContrast(palettes.copper)).toEqual(palettes.copper);
  });
});
