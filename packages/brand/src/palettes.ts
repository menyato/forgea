import type { Palette } from './types.js';

/**
 * Candidate brand palettes. `white` is "cards and panels" in light mode: a shade below the page
 * (`paper`), as dark mode's panels sit a shade above theirs, so boxes stand out in both.
 * tokens.ts picks one by name; see docs/brand/BRIEF.md for the idea
 * behind each.
 */
export const palettes = {
  /** The owner's Canva board: ink, ash plate, graphite bar, coral square. */
  canva: {
    ink: '#1c1c1c',
    graphite: '#4b4b4b',
    stone: '#8a8a85',
    ash: '#d7d7d3',
    paper: '#fafaf8',
    white: '#eeeeea',
    accent: '#e98a7e',
    accentDeep: '#c9655a',
    onAccent: '#1c1c1c',
    accentDark: '#e98a7e',
    onAccentDark: '#1c1c1c',
    night: '#161616',
    nightRaised: '#222220',
    nightBorder: '#3a3a38',
    mist: '#f2f2ef',
    green: '#2f8f5b',
    amber: '#c98a1b',
    red: '#c0392b',
  },
  /** Forge heat on Doha sand: charcoal, sand, molten orange. */
  kiln: {
    ink: '#1e1b18',
    graphite: '#4a443d',
    stone: '#8c8378',
    ash: '#e6dccd',
    paper: '#faf6ef',
    white: '#f0e8db',
    accent: '#ff6a1a',
    accentDeep: '#c24a05',
    onAccent: '#1e1b18',
    accentDark: '#ff6a1a',
    onAccentDark: '#1e1b18',
    night: '#151311',
    nightRaised: '#211e1a',
    nightBorder: '#3b352e',
    mist: '#f3ede4',
    green: '#2f8f5b',
    amber: '#b7791f',
    red: '#c0392b',
  },
  /** Qatar's national maroon with pearl and warm stone. */
  maroon: {
    ink: '#1d1416',
    graphite: '#4d3a3e',
    stone: '#9a888b',
    ash: '#e9dfd7',
    paper: '#fbf8f4',
    white: '#f1e9e3',
    accent: '#8a1538',
    accentDeep: '#5e0e26',
    onAccent: '#fbf8f4',
    // Maroon is too dark to read on the dark background, so dark mode uses a rose tint.
    accentDark: '#e8798f',
    onAccentDark: '#1d1416',
    night: '#140d0f',
    nightRaised: '#22171a',
    nightBorder: '#3d2b30',
    mist: '#f4ece8',
    green: '#2f8f5b',
    amber: '#b7791f',
    red: '#c0392b',
  },
  /** Deep teal resin with a saffron accent. */
  resin: {
    ink: '#142321',
    graphite: '#3c4f4c',
    stone: '#86978f',
    ash: '#d3e3df',
    paper: '#f6faf9',
    white: '#e6efed',
    accent: '#f2b134',
    accentDeep: '#a86f05',
    onAccent: '#142321',
    accentDark: '#f2b134',
    onAccentDark: '#142321',
    night: '#0f1a19',
    nightRaised: '#172625',
    nightBorder: '#2c403d',
    mist: '#eaf3f1',
    green: '#2f8f5b',
    amber: '#b7791f',
    red: '#c0392b',
  },
  /** Circuit-board copper on charcoal, for the printing + electronics story. */
  copper: {
    ink: '#17191b',
    graphite: '#43474b',
    stone: '#8b9095',
    ash: '#dfe1e2',
    paper: '#f8f8f7',
    white: '#eceef0',
    accent: '#c87533',
    accentDeep: '#8f4a17',
    onAccent: '#17191b',
    accentDark: '#d98a4b',
    onAccentDark: '#17191b',
    night: '#121416',
    nightRaised: '#1c1f22',
    nightBorder: '#33383d',
    mist: '#eef0f1',
    green: '#2f8f5b',
    amber: '#b7791f',
    red: '#c0392b',
  },
} as const satisfies Record<string, Palette>;

export type PaletteName = keyof typeof palettes;
