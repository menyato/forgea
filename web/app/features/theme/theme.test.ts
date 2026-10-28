import { describe, expect, it } from 'vitest';
import { isTheme, nextTheme } from './theme';

describe('theme', () => {
  it('cycles auto → light → dark → auto', () => {
    expect(nextTheme('auto')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('auto');
  });

  it('accepts only the three known values', () => {
    expect(['auto', 'light', 'dark'].every(isTheme)).toBe(true);
    expect(isTheme('blue')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });
});
