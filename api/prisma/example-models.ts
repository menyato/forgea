// Small procedural 3D models (binary STL, millimetres, Z up as slicers expect) for the
// development seed and the tests, so the 3D viewer and the dashboard's grams/hours suggestion
// have real files to work with.

type Point = readonly [number, number];
type Vec = readonly [number, number, number];
type Triangle = readonly [Vec, Vec, Vec];

/** Twice the signed area: positive when the outline runs counter-clockwise. */
const signedArea = (o: readonly Point[]) =>
  o.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = o[(i + 1) % o.length]!;
    return sum + x1 * y2 - x2 * y1;
  }, 0);

/**
 * A convex outline extruded into a closed solid with outward-facing triangles.
 * "xy": the outline is the footprint, extruded upwards (z) — plates, boxes.
 * "xz": the outline is a side profile, extruded sideways (y) — stands, brackets.
 */
function prism(
  outline: readonly Point[],
  depth: number,
  { plane = 'xy', from = 0 }: { plane?: 'xy' | 'xz'; from?: number } = {},
): Triangle[] {
  const ccw = signedArea(outline) > 0 ? outline : [...outline].reverse();
  const lo = ccw.map(([u, v]): Vec => [u, v, from]);
  const hi = ccw.map(([u, v]): Vec => [u, v, from + depth]);
  const tris: Triangle[] = [];
  for (let i = 1; i < ccw.length - 1; i++) {
    tris.push([lo[0]!, lo[i + 1]!, lo[i]!], [hi[0]!, hi[i]!, hi[i + 1]!]);
  }
  for (let i = 0; i < ccw.length; i++) {
    const j = (i + 1) % ccw.length;
    tris.push([lo[i]!, lo[j]!, hi[j]!], [lo[i]!, hi[j]!, hi[i]!]);
  }
  if (plane === 'xy') return tris;
  // Swapping y and z mirrors the solid, so each triangle's winding is reversed too.
  const swap = ([x, y, z]: Vec): Vec => [x, z, y];
  return tris.map(([a, b, c]) => [swap(a), swap(c), swap(b)]);
}

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** A rounded rectangle outline with `segments` per corner. */
function roundedRect(w: number, h: number, r: number, segments = 6): Point[] {
  const corners: [number, number, number][] = [
    [w - r, r, -Math.PI / 2],
    [w - r, h - r, 0],
    [r, h - r, Math.PI / 2],
    [r, r, Math.PI],
  ];
  const points = corners.flatMap(([cx, cy, start]) =>
    Array.from({ length: segments + 1 }, (_, k): Point => {
      const a = start + (k / segments) * (Math.PI / 2);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
  );
  // When r is half the size (a circle), neighbouring corners meet in the same point.
  const same = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9;
  return points.filter((p, i) => !same(p, points[(i + 1) % points.length]!));
}

/** Triangles (counter-clockwise seen from outside) → binary STL, with each face's normal. */
function toStl(triangles: readonly Triangle[]): Buffer {
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.writeUInt32LE(triangles.length, 80);
  triangles.forEach(([a, b, c], i) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    const n = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const len = Math.hypot(...n) || 1;
    [...n.map((x) => x / len), ...a, ...b, ...c].forEach((x, k) =>
      buf.writeFloatLE(x, 84 + i * 50 + k * 4),
    );
  });
  return buf;
}

/**
 * A ring with `sides` flat faces: each face is its own convex slab (a trapezoid between the
 * outer and inner outline), so the shell stays hollow.
 */
function facetedRing(
  sides: number,
  outer: number,
  wall: number,
  height: number,
  { from = 0, turn = 0 }: { from?: number; turn?: number } = {},
): Triangle[] {
  const corner = (r: number, i: number): Point => {
    const a = (i / sides) * 2 * Math.PI + turn;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  return Array.from({ length: sides }, (_, i) =>
    prism(
      [
        corner(outer, i),
        corner(outer, i + 1),
        corner(outer - wall, i + 1),
        corner(outer - wall, i),
      ],
      height,
      { from },
    ),
  ).flat();
}

/** A regular polygon outline, centred, optionally turned (radians). */
const polygon = (sides: number, r: number, turn = 0): Point[] =>
  Array.from({ length: sides }, (_, i): Point => {
    const a = (i / sides) * 2 * Math.PI + turn;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

/**
 * A vessel built from stacked rings, each turned a little further and sized by `radius(t)`
 * (t from 0 at the base to 1 at the rim), on a solid base: the designer pieces.
 */
function vessel(o: {
  sides: number;
  height: number;
  layers: number;
  wall: number;
  twist: number;
  radius: (t: number) => number;
}): Triangle[] {
  const layer = o.height / o.layers;
  return [
    ...prism(polygon(o.sides, o.radius(0)), 2.4),
    ...Array.from({ length: o.layers }, (_, i) =>
      facetedRing(o.sides, o.radius(i / o.layers), o.wall, layer, {
        from: 2.4 + i * layer,
        turn: (i / o.layers) * o.twist,
      }),
    ).flat(),
  ];
}

/** Cell centres of a seven-cell honeycomb, in cell widths. */
const HONEYCOMB: readonly Point[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0.5, 0.866],
  [-0.5, 0.866],
  [0.5, -0.866],
  [-0.5, -0.866],
];

export const cube = (size: number) => toStl(prism(rect(0, 0, size, size), size));

export const EXAMPLE_MODELS = {
  /** Side profile: a base plate, a leaning back rest and a front lip, 80 mm wide. */
  'phone-stand': () =>
    toStl([
      ...prism(rect(0, 0, 70, 6), 80, { plane: 'xz' }),
      ...prism([[8, 6], [14, 6], [40, 70], [34, 72]], 80, { plane: 'xz' }),
      ...prism(rect(52, 6, 6, 14), 80, { plane: 'xz' }),
    ]),
  /** A flat 50 × 22 mm tag with rounded corners and a ring tab. */
  'name-keychain': () =>
    toStl([
      ...prism(roundedRect(50, 22, 5), 3),
      ...prism(roundedRect(12, 12, 6).map(([x, y]): Point => [x - 9, y + 5]), 3),
    ]),
  /** A case for a Raspberry Pi 5: body and lid. */
  'pi-5-case': () =>
    toStl([
      ...prism(roundedRect(94, 63, 4), 24),
      ...prism(roundedRect(94, 63, 4), 4, { from: 26 }),
    ]),
  /** A hollow six-sided shade, 120 mm across, with a narrower collar for the fitting. */
  'lamp-shade': () =>
    toStl([...facetedRing(6, 60, 2.4, 110), ...facetedRing(6, 24, 3, 8)]),
  /** Six U-shaped desk-edge clips laid out in two rows, as they come off the printer. */
  'cable-clip-set': () =>
    toStl(
      Array.from({ length: 6 }, (_, i) => {
        const x = (i % 3) * 24;
        const y = Math.floor(i / 3) * 16;
        const clip = (o: Point[]) =>
          prism(
            o.map(([u, v]): Point => [u + x, v]),
            10,
            { plane: 'xz', from: y },
          );
        return [
          ...clip(rect(0, 0, 16, 3)),
          ...clip(rect(0, 3, 3, 11)),
          ...clip(rect(13, 3, 3, 11)),
        ];
      }).flat(),
    ),
  /**
   * The Forgea mark (packages/brand/assets/logo-mark.svg) as a desk plaque, about 100 mm
   * across: the plate, the accent square, the bar and the F, each a layer taller than the one
   * under it. The F is three rectangles (stem and two arms), so every part stays convex.
   */
  'forgea-logo': () => {
    const scale = 0.36;
    const part = (x: number, y: number, w: number, h: number, height: number) =>
      // SVG y points down; flip it so the mark reads correctly from above.
      prism(rect(x * scale, -(y + h) * scale, w * scale, h * scale), height);
    return toStl([
      ...part(132, 75.2, 151.8, 151.8, 3),
      ...part(201.6, 167.6, 92.4, 92.4, 6),
      ...part(58.16, 216.44, 251.68, 21.12, 7.5),
      ...part(74, 40, 58, 220, 11),
      ...part(132, 40, 74, 50.5, 11),
      ...part(132, 124.5, 68.17, 50.5, 11),
    ]);
  },
  // The designer collection.
  /** A six-sided vase that turns a third of a circle from base to rim, swelling at the middle. */
  'twist-vase': () =>
    toStl(
      vessel({
        sides: 6,
        height: 180,
        layers: 36,
        wall: 2.2,
        twist: (2 * Math.PI) / 3,
        radius: (t) => 34 + 16 * Math.sin(Math.PI * t * 0.85),
      }),
    ),
  /** A faceted planter that opens out towards the rim. */
  'faceted-planter': () =>
    toStl(
      vessel({
        sides: 8,
        height: 110,
        layers: 10,
        wall: 3,
        twist: Math.PI / 8,
        radius: (t) => 46 + 18 * t,
      }),
    ),
  /** A round pen cup with twenty vertical ribs. */
  'ribbed-pen-cup': () =>
    toStl([
      ...facetedRing(40, 38, 2.4, 100, { from: 2.4 }),
      ...prism(polygon(40, 38), 2.4),
      ...Array.from({ length: 20 }, (_, i) => {
        const a = (i / 20) * 2 * Math.PI;
        const corners: Point[] = [
          [37, -1.6],
          [41, -1.6],
          [41, 1.6],
          [37, 1.6],
        ];
        const rib = corners.map(([x, y]): Point => [
          x * Math.cos(a) - y * Math.sin(a),
          x * Math.sin(a) + y * Math.cos(a),
        ]);
        return prism(rib, 102.4);
      }).flat(),
    ]),
  /** A desk sculpture: twelve squares stacked, each turned and a little smaller. */
  'spiral-tower': () =>
    toStl(
      Array.from({ length: 12 }, (_, i) =>
        prism(polygon(4, 40 - i * 2.2, (i * Math.PI) / 24), 12, {
          from: i * 12,
        }),
      ).flat(),
    ),
  /** Seven hexagonal cells joined into a wall shelf, 40 mm deep. */
  'honeycomb-shelf': () =>
    toStl(
      HONEYCOMB.flatMap(([x, y]) => {
        const move = ([px, py, pz]: Vec): Vec => [px + x * 69.3, py + y * 69.3, pz];
        return facetedRing(6, 40, 3, 40, { turn: Math.PI / 6 }).map(
          ([a, b, c]): Triangle => [move(a), move(b), move(c)],
        );
      }),
    ),
  /** An outdoor box on a mounting flange. */
  'sensor-enclosure': () =>
    toStl([
      ...prism(roundedRect(100, 70, 6), 45, { from: 4 }),
      ...prism(rect(-12, 20, 124, 30), 4),
    ]),
} as const;
