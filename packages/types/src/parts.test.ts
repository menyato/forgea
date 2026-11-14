import { describe, expect, it } from 'vitest';
import { startingChoice } from './parts.js';

const choices = [
  { label: 'Black', swatchHex: '#1c1c1c', stockItemId: 'reel-black' },
  { label: 'White', swatchHex: '#f5f5f5', stockItemId: null },
  { label: 'Pink', swatchHex: '#d6338a', stockItemId: 'reel-magenta' },
  { label: 'Plain', swatchHex: null },
];

describe('startingChoice', () => {
  it("is the owner's pick when there is one", () => {
    expect(
      startingChoice(choices, {
        startsAs: 'white',
        colour: 'Black',
        hex: '#000000',
      })?.label,
    ).toBe('White');
  });

  it('else the choice printed from the same filament', () => {
    expect(
      startingChoice(choices, {
        startsAs: null,
        colour: 'eSUN HS PLA+ (Magenta)',
        hex: '#000000',
        stockItemId: 'reel-magenta',
      })?.label,
    ).toBe('Pink');
  });

  it('else the one named like it, else the closest to the file colour', () => {
    expect(
      startingChoice(choices, { colour: 'black', hex: '#ffffff' })?.label,
    ).toBe('Black');
    expect(
      startingChoice(choices, {
        startsAs: 'Gone',
        colour: 'Elegoo PLA Matte (White)',
        hex: '#ffffff',
        stockItemId: 'reel-white',
      })?.label,
    ).toBe('White');
    expect(
      startingChoice(choices, { colour: 'Rose', hex: '#e0457f' })?.label,
    ).toBe('Pink');
  });

  it('else the first; nothing to choose from gives nothing', () => {
    expect(
      startingChoice([{ label: 'A', swatchHex: null }], {
        colour: 'x',
        hex: 'not a colour',
      })?.label,
    ).toBe('A');
    expect(startingChoice([], { colour: 'x', hex: '#000000' })).toBeUndefined();
  });
});
