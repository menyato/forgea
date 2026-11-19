import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Path,
  Shape,
  Vector2,
} from 'three';
import type { Part } from './layout.js';

/** A part as one solid: each of its regions extruded from z0 to z1 (mm), triangles only. */
export function partGeometry(part: Part): BufferGeometry {
  const positions: number[] = [];
  for (const region of part.regions) {
    const shape = new Shape(region.outer.map(([x, y]) => new Vector2(x, y)));
    shape.holes = region.holes.map(
      (h) => new Path(h.map(([x, y]) => new Vector2(x, y))),
    );
    const extruded = new ExtrudeGeometry(shape, {
      depth: part.z1 - part.z0,
      bevelEnabled: false,
      // The outlines are already polygons.
      curveSegments: 1,
    });
    // ExtrudeGeometry is already plain triangles; only an indexed one would need unrolling.
    const flat = extruded.index ? extruded.toNonIndexed() : extruded;
    const p = flat.getAttribute('position');
    for (let i = 0; i < p.count; i++)
      positions.push(p.getX(i), p.getY(i), p.getZ(i) + part.z0);
    if (flat !== extruded) flat.dispose();
    extruded.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** The solid's volume in mm³ (the sum of signed tetrahedra from the origin). */
export function volumeMm3(geometry: BufferGeometry): number {
  const p = geometry.getAttribute('position');
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i);
    const ay = p.getY(i);
    const az = p.getZ(i);
    const bx = p.getX(i + 1);
    const by = p.getY(i + 1);
    const bz = p.getZ(i + 1);
    const cx = p.getX(i + 2);
    const cy = p.getY(i + 2);
    const cz = p.getZ(i + 2);
    v +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }
  return Math.abs(v / 6);
}

/** A binary STL (mm), as slicers read it: one file per colour, placed together. */
export function stlBytes(geometry: BufferGeometry, name: string): Uint8Array {
  const p = geometry.getAttribute('position');
  return stlFromPositions(p.array, name);
}

/** A binary STL from triangle corners (x, y, z each, mm), as slicers read it. */
export function stlFromPositions(
  positions: ArrayLike<number>,
  name: string,
): Uint8Array {
  const p = {
    getX: (i: number) => positions[i * 3]!,
    getY: (i: number) => positions[i * 3 + 1]!,
    getZ: (i: number) => positions[i * 3 + 2]!,
  };
  const triangles = Math.floor(positions.length / 9);
  const out = new DataView(new ArrayBuffer(84 + triangles * 50));
  const header = new TextEncoder().encode(`Forgea ${name}`.slice(0, 80));
  new Uint8Array(out.buffer).set(header, 0);
  out.setUint32(80, triangles, true);
  let o = 84;
  for (let t = 0; t < triangles; t++) {
    const i = t * 3;
    const a = [p.getX(i), p.getY(i), p.getZ(i)];
    const b = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    const c = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [
      u[1]! * w[2]! - u[2]! * w[1]!,
      u[2]! * w[0]! - u[0]! * w[2]!,
      u[0]! * w[1]! - u[1]! * w[0]!,
    ];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    for (const value of [...n.map((x) => x / len), ...a, ...b, ...c]) {
      out.setFloat32(o, value, true);
      o += 4;
    }
    out.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(out.buffer);
}
