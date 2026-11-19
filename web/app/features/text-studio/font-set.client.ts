import { FontSet } from '@forgea/text3d';
import type { FontView } from '@forgea/types';

/** One HarfBuzz font set for the page; each font file is fetched once. */
let fonts: Promise<FontSet> | undefined;
const fetched = new Map<string, Promise<void>>();

/**
 * The page's font set with these fonts loaded (fetched from /media once each): what the
 * live previews shape text with, the same fonts and code the studio prints from.
 */
export async function fontsFor(
  offered: readonly Pick<FontView, 'id' | 'name' | 'fileKey'>[],
  ids: readonly string[],
): Promise<FontSet> {
  const set = await (fonts ??= FontSet.load([]));
  await Promise.all(
    ids.map((id) => {
      let loading = fetched.get(id);
      if (!loading) {
        const font = offered.find((f) => f.id === id);
        loading = font
          ? fetch(`/media/${font.fileKey}`)
              .then((r) => {
                if (!r.ok) throw new Error(`Font ${font.name} didn't load`);
                return r.arrayBuffer();
              })
              .then((b) => set.add([{ id, bytes: new Uint8Array(b) }]))
          : Promise.reject(new Error('Unknown font'));
        // A failed download may be tried again.
        loading.catch(() => fetched.delete(id));
        fetched.set(id, loading);
      }
      return loading;
    }),
  );
  return set;
}
