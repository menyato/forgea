/**
 * Model files downloaded before three.js has loaded (the home page's bed), so the download
 * and three.js arrive together. `loadModel` takes the bytes when it gets there; each early
 * download is used once, and a later load fetches normally (or from its own cache). No
 * three.js here: this runs in the page's first bundle.
 *
 * In place of `<link rel="preload">`: the browser warns about a preload not used within a
 * few seconds, which a 3D scene that starts after hydration often misses, and every visit
 * back to the page added the links again for models already in memory.
 */
const early = new Map<string, Promise<ArrayBuffer>>();
/** Taken by loadModel, which keeps the model from then on: never downloaded early again. */
const taken = new Set<string>();

export function prefetchModel(src: string): void {
  if (early.has(src) || taken.has(src)) return;
  const bytes = fetch(src).then((r) => {
    if (!r.ok) throw new Error(`${src}: ${r.status}`);
    return r.arrayBuffer();
  });
  // A failed early download is forgotten: loading it later simply fetches it.
  bytes.catch(() => early.delete(src));
  early.set(src, bytes);
}

/** The early download of this file, if one was started (taken: used once). */
export function takePrefetched(src: string): Promise<ArrayBuffer> | undefined {
  const bytes = early.get(src);
  early.delete(src);
  taken.add(src);
  return bytes;
}
