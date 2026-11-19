/**
 * A logo picture (PNG, JPEG) as an SVG drawing: which pixels are the logo, their outlines
 * followed along the pixel edges, simplified. Runs in the customer's browser (no image is
 * ever parsed on the server); the SVG then goes the same way as an SVG logo (read in the API's
 * worker into print outlines). No 3D code here (`@forgea/text3d/trace`).
 */

type Pt = [number, number];

/**
 * Which pixels are the logo (1) and which the background (0), from RGBA pixels: on a picture
 * with transparency, the opaque pixels; otherwise light against dark (Otsu's threshold), the
 * logo being whichever side the picture's border is not.
 */
export function inkMask(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): Uint8Array {
  const n = width * height;
  const mask = new Uint8Array(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3]! < 128) transparent++;
  if (transparent > n * 0.02) {
    for (let i = 0; i < n; i++) mask[i] = rgba[i * 4 + 3]! >= 128 ? 1 : 0;
    return mask;
  }
  const lum = new Uint8Array(n);
  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    const l = Math.round(
      0.299 * rgba[i * 4]! +
        0.587 * rgba[i * 4 + 1]! +
        0.114 * rgba[i * 4 + 2]!,
    );
    lum[i] = l;
    histogram[l]!++;
  }
  const t = otsu(histogram, n);
  // The border is background: the logo is the side most of it is not on.
  let darkBorder = 0;
  let border = 0;
  const edge = (x: number, y: number) => {
    border++;
    if (lum[y * width + x]! <= t) darkBorder++;
  };
  for (let x = 0; x < width; x++) {
    edge(x, 0);
    edge(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    edge(0, y);
    edge(width - 1, y);
  }
  const inkIsDark = darkBorder * 2 < border;
  for (let i = 0; i < n; i++) mask[i] = lum[i]! <= t === inkIsDark ? 1 : 0;
  return mask;
}

/** The threshold that best splits the histogram in two (Otsu). */
function otsu(histogram: readonly number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i]!;
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let threshold = 127;
  for (let i = 0; i < 256; i++) {
    weightB += histogram[i]!;
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += i * histogram[i]!;
    const between =
      weightB * weightF * (sumB / weightB - (sum - sumB) / weightF) ** 2;
    if (between > best) {
      best = between;
      threshold = i;
    }
  }
  return threshold;
}

/**
 * The mask's outlines as an SVG drawing (even-odd: holes are cut), or null when there is no
 * logo in it. Specks smaller than `minArea` pixels are dropped; outlines are simplified to
 * within `tolerance` pixels.
 */
export function traceSvg(
  mask: Uint8Array,
  width: number,
  height: number,
  { tolerance = 0.8, minArea = Math.max(6, width * height * 0.0002) } = {},
): string | null {
  const loops = traceLoops(mask, width, height)
    .filter((l) => Math.abs(area(l)) >= minArea)
    .map((l) => simplify(l, tolerance))
    .filter((l) => l.length >= 3);
  if (loops.length === 0) return null;
  const d = loops
    .map((l) => `M${l.map(([x, y]) => `${x} ${y}`).join('L')}Z`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill-rule="evenodd" d="${d}"/></svg>`;
}

/**
 * Closed outlines along the pixel edges between logo and background, the logo always on the
 * walker's right (y down). Where two logo pixels touch only at a corner, the walk turns right,
 * so they stay separate shapes.
 */
export function traceLoops(
  mask: Uint8Array,
  width: number,
  height: number,
): Pt[][] {
  const ink = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const W = width + 1;
  const key = (x: number, y: number) => y * W + x;
  // Outgoing edges from each corner: up to two (at a corner where pixels touch diagonally).
  const out = new Map<number, Pt[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const list = out.get(k);
    if (list) list.push([bx, by]);
    else out.set(k, [[bx, by]]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!ink(x, y)) continue;
      if (!ink(x, y - 1)) add(x, y, x + 1, y);
      if (!ink(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!ink(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!ink(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops: Pt[][] = [];
  for (const [startKey, firstTargets] of out) {
    while (firstTargets.length > 0) {
      const sx = startKey % W;
      const sy = (startKey - sx) / W;
      const loop: Pt[] = [[sx, sy]];
      let [px, py] = [sx, sy];
      let [nx, ny] = firstTargets.pop()!;
      for (let guard = 0; guard < 4 * W * (height + 1); guard++) {
        loop.push([nx, ny]);
        const k = key(nx, ny);
        if (k === startKey && firstTargets !== out.get(k)) break;
        const targets = out.get(k);
        if (!targets || targets.length === 0) break;
        // Turn right first: direction (dx, dy) turned right is (-dy, dx) in y-down.
        const dx = nx - px;
        const dy = ny - py;
        let pick = 0;
        if (targets.length > 1) {
          const right = targets.findIndex(
            ([tx, ty]) => tx - nx === -dy && ty - ny === dx,
          );
          if (right >= 0) pick = right;
        }
        const [tx, ty] = targets.splice(pick, 1)[0]!;
        [px, py] = [nx, ny];
        [nx, ny] = [tx, ty];
        if (nx === sx && ny === sy) break;
      }
      loops.push(withoutStraights(loop));
    }
  }
  return loops.filter((l) => l.length >= 3);
}

/** Drops points in the middle of straight runs (and the closing repeat). */
function withoutStraights(loop: Pt[]): Pt[] {
  const pts =
    loop.length > 1 &&
    loop[0]![0] === loop[loop.length - 1]![0] &&
    loop[0]![1] === loop[loop.length - 1]![1]
      ? loop.slice(0, -1)
      : loop;
  return pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length]!;
    const b = pts[(i + 1) % pts.length]!;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
}

/** Shoelace area (signed). */
export function area(loop: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i]!;
    const [x2, y2] = loop[(i + 1) % loop.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** Douglas–Peucker on a closed outline: split at the point farthest from the first. */
function simplify(loop: Pt[], tolerance: number): Pt[] {
  if (loop.length <= 4) return loop;
  let far = 0;
  let best = -1;
  for (let i = 1; i < loop.length; i++) {
    const d =
      (loop[i]![0] - loop[0]![0]) ** 2 + (loop[i]![1] - loop[0]![1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = dp(loop.slice(0, far + 1), tolerance);
  const b = dp([...loop.slice(far), loop[0]!], tolerance);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0]!;
  const [bx, by] = pts[pts.length - 1]!;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let index = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i]!;
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= tolerance) return [pts[0]!, pts[pts.length - 1]!];
  return [
    ...dp(pts.slice(0, index + 1), tolerance).slice(0, -1),
    ...dp(pts.slice(index), tolerance),
  ];
}
