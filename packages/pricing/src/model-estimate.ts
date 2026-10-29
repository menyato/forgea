import Big from 'big.js';
import { PricingError } from './errors.js';
import {
  type DecimalInput,
  requireNonNegative,
  requirePercent,
  toBig,
} from './money.js';

/**
 * Volume of a closed triangle mesh in the model's units cubed, from its vertex positions
 * (x, y, z per vertex, three vertices per triangle — the layout three.js and STL use).
 * Sum of signed tetrahedra against the origin; exact for a watertight mesh.
 */
export function meshVolume(positions: ArrayLike<number>): number {
  if (positions.length % 9 !== 0) {
    throw new PricingError(
      'Positions must hold whole triangles (9 numbers each)',
    );
  }
  const p = (k: number): number => Number(positions[k]);
  let sum = 0;
  // Plain indexing: a detailed model has millions of numbers.
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az] = [p(i), p(i + 1), p(i + 2)];
    const [bx, by, bz] = [p(i + 3), p(i + 4), p(i + 5)];
    const [cx, cy, cz] = [p(i + 6), p(i + 7), p(i + 8)];
    sum +=
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
  }
  return Math.abs(sum / 6);
}

export interface PrintEstimateInput {
  /** STL files are in millimetres. */
  volumeMm3: DecimalInput;
  /** Material density, g/cm³ (PLA ≈ 1.24). */
  densityGPerCm3: DecimalInput;
  /** How solid the print is: walls + infill as a share of the volume (typically 30–50%). */
  solidityPercent: DecimalInput;
  /** The printer's average throughput for this material, grams per hour. */
  gramsPerHour: DecimalInput;
}

/** Suggested grams and print hours for a model: a starting point the admin can adjust. */
export function estimatePrint(input: PrintEstimateInput): {
  grams: string;
  printHours: string;
} {
  const volumeCm3 = requireNonNegative(
    toBig(input.volumeMm3, 'volume'),
    'volume',
  ).div(1000);
  const density = requireNonNegative(
    toBig(input.densityGPerCm3, 'density'),
    'density',
  );
  const solidity = requirePercent(
    toBig(input.solidityPercent, 'solidity'),
    'solidity',
  );
  const rate = toBig(input.gramsPerHour, 'grams per hour');
  if (rate.lte(0))
    throw new PricingError('grams per hour must be greater than 0');
  const grams = volumeCm3.times(density).times(solidity).div(100);
  return {
    grams: grams.round(1, Big.roundUp).toFixed(1),
    printHours: grams.div(rate).round(2, Big.roundUp).toFixed(2),
  };
}

/**
 * The triangle positions of an STL file (binary or ASCII), in the layout `meshVolume` takes.
 * Used by the API to measure a customer's upload itself, never trusting browser numbers.
 */
export function stlPositions(data: Uint8Array): Float32Array {
  const count = binaryStlCount(data);
  if (count !== null) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out = new Float32Array(count * 9);
    for (let t = 0; t < count; t++) {
      // Each record: normal (3 floats), three vertices (9 floats), attribute (2 bytes).
      for (let k = 0; k < 9; k++) {
        out[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
      }
    }
    return out;
  }
  // ASCII: straight into one array sized from a first count, no intermediate lists (a 50 MB
  // file would otherwise take over a gigabyte of memory).
  const text = new TextDecoder().decode(data);
  const out = new Float32Array(asciiVertexCount(text) * 3);
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let n = 0;
  for (let m = vertex.exec(text); m; m = vertex.exec(text)) {
    for (let k = 1; k <= 3; k++) {
      const v = Number(m[k]);
      if (!Number.isFinite(v))
        throw new PricingError('This is not a readable STL file');
      out[n++] = v;
    }
  }
  if (n === 0 || n !== out.length || n % 9 !== 0) {
    throw new PricingError('This is not a readable STL file');
  }
  return out;
}

/** How many triangles an STL file holds, without reading them (to refuse huge files first). */
export function stlTriangleCount(data: Uint8Array): number {
  return (
    binaryStlCount(data) ??
    Math.floor(asciiVertexCount(new TextDecoder().decode(data)) / 3)
  );
}

/** The triangle count of a binary STL whose length matches its header; null otherwise. */
function binaryStlCount(data: Uint8Array): number | null {
  if (data.byteLength < 84) return null;
  const count = new DataView(data.buffer, data.byteOffset).getUint32(80, true);
  return count > 0 && data.byteLength === 84 + count * 50 ? count : null;
}

function asciiVertexCount(text: string): number {
  let count = 0;
  for (
    let at = text.indexOf('vertex');
    at !== -1;
    at = text.indexOf('vertex', at + 6)
  ) {
    count++;
  }
  return count;
}

/**
 * A price shown as a range, because supports, orientation and walls change the real numbers:
 * ±`spreadPercent` around the computed price, widened to whole dollars.
 */
export function priceRange(
  price: DecimalInput,
  spreadPercent: DecimalInput,
): { low: string; high: string } {
  const p = requireNonNegative(toBig(price, 'price'), 'price');
  const spread = requirePercent(toBig(spreadPercent, 'spread'), 'spread');
  const low = p.times(new Big(100).minus(spread)).div(100);
  const high = p.times(new Big(100).plus(spread)).div(100);
  return {
    low: low.round(0, Big.roundDown).toFixed(2),
    high: high.round(0, Big.roundUp).toFixed(2),
  };
}
