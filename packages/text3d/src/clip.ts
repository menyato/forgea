import {
  differenceD,
  EndType,
  intersectD,
  FillRule,
  inflatePathsD,
  JoinType,
  type PathsD,
  unionD,
} from 'clipper2-ts';
import { type Contour, type Region, regionsOf, signedArea } from './outline.js';

/** Regions as Clipper paths: outlines counter-clockwise, holes clockwise (non-zero filling). */
function toPaths(regions: readonly Region[]): PathsD {
  const paths: PathsD = [];
  for (const r of regions) {
    paths.push(oriented(r.outer, true));
    for (const hole of r.holes) paths.push(oriented(hole, false));
  }
  return paths;
}

function oriented(c: Contour, counterClockwise: boolean) {
  const ccw = signedArea(c) > 0;
  const points = c.map(([x, y]) => ({ x, y }));
  return ccw === counterClockwise ? points : points.reverse();
}

function fromPaths(paths: PathsD): Region[] {
  return regionsOf(
    paths
      .map((p) => p.map(({ x, y }) => [x, y] as const))
      .filter((c) => c.length >= 3),
  );
}

export const union = (regions: readonly Region[]): Region[] =>
  fromPaths(unionD(toPaths(regions), FillRule.NonZero));

export const difference = (
  from: readonly Region[],
  cut: readonly Region[],
): Region[] =>
  fromPaths(differenceD(toPaths(from), toPaths(cut), FillRule.NonZero));

export const intersection = (
  a: readonly Region[],
  b: readonly Region[],
): Region[] => fromPaths(intersectD(toPaths(a), toPaths(b), FillRule.NonZero));

/** The regions grown by `by` mm all round (rounded corners). */
export const grown = (regions: readonly Region[], by: number): Region[] =>
  fromPaths(
    inflatePathsD(toPaths(regions), by, JoinType.Round, EndType.Polygon),
  );

/** Regions ready for Clipper, oriented once: to test many moves of the same outline. */
export const clipperPaths = (regions: readonly Region[]): PathsD =>
  toPaths(regions);

/**
 * The area of `from` left outside `cut`, both already Clipper paths (`clipperPaths`): the same
 * figure `difference` and an area sum give, without turning the result back into regions.
 */
export function areaOutside(from: PathsD, cut: PathsD): number {
  let area = 0;
  for (const p of differenceD(from, cut, FillRule.NonZero)) {
    if (p.length < 3) continue;
    // As `signedArea` works it out.
    let a = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length]!;
      a += p[i]!.x * q.y - q.x * p[i]!.y;
    }
    area += a / 2;
  }
  return Math.abs(area);
}
