import { useSyncExternalStore } from 'react';

/** The brand colours a 3D scene needs, read from the page's CSS variables (light or dark). */
export interface SceneColors {
  plate: string;
  grid: string;
  accent: string;
  /** The logo's own fills, for the printed 3D mark. */
  logoInk: string;
  logoPlate: string;
  logoBar: string;
}

const FALLBACK: SceneColors = {
  plate: '#dfe1e2',
  grid: '#43474b',
  accent: '#c87533',
  logoInk: '#17191b',
  logoPlate: '#dfe1e2',
  logoBar: '#43474b',
};

function read(): SceneColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    plate: v('--forgea-logo-plate', FALLBACK.plate),
    grid: v('--forgea-color-text-muted', FALLBACK.grid),
    accent: v('--forgea-color-accent', FALLBACK.accent),
    logoInk: v('--forgea-logo-ink', FALLBACK.logoInk),
    logoPlate: v('--forgea-logo-plate', FALLBACK.logoPlate),
    logoBar: v('--forgea-logo-bar', FALLBACK.logoBar),
  };
}

let current: SceneColors | null = null;
const snapshot = () => (current ??= read());

/** Re-reads when the visitor flips the theme toggle or the device switches light/dark. */
function subscribe(changed: () => void): () => void {
  const update = () => {
    current = read();
    changed();
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style'],
  });
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', update);
  };
}

/** Scene colours that follow the site theme. Only call from client-only components. */
export const useSceneColors = (): SceneColors =>
  useSyncExternalStore(subscribe, snapshot, () => FALLBACK);
