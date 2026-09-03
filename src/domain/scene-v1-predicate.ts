/**
 * Frozen Scene-v1 SHAPES coverage predicates. Owner-approved 2026-08-25.
 *
 * THE NORMATIVE PER-TEXEL LAW. This module is the executable specification: a
 * texel's colour is the palette index of the LAST op in program order whose
 * coverage predicate contains it. Record 0 is always BG and BG covers every
 * texel, so every texel is total. No blending, no antialiasing, no
 * interpolation, no alpha. Last writer wins.
 *
 * Texel centres are represented DOUBLED as `(2t+1)` so every membership test is
 * exact integer arithmetic. Every intermediate stays far inside 2^53:
 * coordinates are at most 16,000, doubled at most 32,001, and the largest
 * product is a doubled radius squared, 4 * 8000^2 = 256,000,000. There is no
 * float comparison and no 32-bit bitwise coercion anywhere in this file.
 *
 * ── Deliberate isolation ────────────────────────────────────────────────────
 * This module imports NO span solver, NO rasteriser and nothing from
 * `scene-v1-compile.ts`. Its triangle normalisation and top-left rule are
 * re-derived from the spec text rather than shared, and the small integer
 * helpers below are duplicated there on purpose. That duplication is the point:
 * when the banded compiler and this reference agree byte-for-byte, the
 * agreement is evidence about the SPEC, not two calls into one implementation.
 */

import type { CanonicalOp } from "./scene-v1-canonical.js";

/**
 * Exact floor division for a non-negative numerator and positive denominator.
 * The correction loop makes the result mathematically exact rather than
 * "exact for the ranges we happen to use".
 */
function floorDivNonNegative(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b > a) q -= 1;
  while ((q + 1) * b <= a) q += 1;
  return q;
}

interface TriEdge {
  readonly aX: number;
  readonly aY: number;
  readonly dX: number;
  readonly dY: number;
  readonly topLeft: boolean;
}

/**
 * Doubled-coordinate triangle edges with winding normalised to positive signed
 * area, or `null` for a zero-area triangle.
 *
 * The top-left rule is pinned here: y grows downward and winding is positive,
 * so an edge is "top-left" when it goes up (`dY < 0`) or is horizontal and goes
 * right (`dY === 0 && dX > 0`). A top-left edge includes points exactly on it;
 * every other edge excludes them. That is what makes two triangles sharing an
 * edge tile with no overlap and no gap.
 */
export function triangleEdges(op: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): readonly TriEdge[] | null {
  let v: Array<readonly [number, number]> = [
    [2 * op.x0, 2 * op.y0],
    [2 * op.x1, 2 * op.y1],
    [2 * op.x2, 2 * op.y2],
  ];
  const doubledArea =
    (v[1]![0] - v[0]![0]) * (v[2]![1] - v[0]![1]) -
    (v[1]![1] - v[0]![1]) * (v[2]![0] - v[0]![0]);
  if (doubledArea === 0) return null;
  if (doubledArea < 0) v = [v[0]!, v[2]!, v[1]!];

  const edges: TriEdge[] = [];
  for (let i = 0; i < 3; i += 1) {
    const a = v[i]!;
    const b = v[(i + 1) % 3]!;
    const dX = b[0] - a[0];
    const dY = b[1] - a[1];
    edges.push({
      aX: a[0],
      aY: a[1],
      dX,
      dY,
      topLeft: dY < 0 || (dY === 0 && dX > 0),
    });
  }
  return edges;
}

/**
 * The palette index `op` paints at texel `(tx, ty)`, or -1 when the op does not
 * cover it. Pure: no caching, no mutation of the op.
 */
export function opPaletteIndexAt(op: CanonicalOp, tx: number, ty: number): number {
  switch (op.op) {
    case "BG":
      return op.c;

    case "RECT":
      return tx >= op.x && tx < op.x + op.w && ty >= op.y && ty < op.y + op.h
        ? op.c
        : -1;

    case "CIRCLE": {
      // Centre is the grid corner (cx, cy), doubled to (2cx, 2cy).
      const dx = 2 * tx + 1 - 2 * op.cx;
      const dy = 2 * ty + 1 - 2 * op.cy;
      const doubledRadius = 2 * op.r;
      return dx * dx + dy * dy <= doubledRadius * doubledRadius ? op.c : -1;
    }

    case "TRI": {
      const edges = triangleEdges(op);
      if (!edges) return -1;
      const px = 2 * tx + 1;
      const py = 2 * ty + 1;
      for (const e of edges) {
        const side = e.dX * (py - e.aY) - e.dY * (px - e.aX);
        if (e.topLeft ? side < 0 : side <= 0) return -1;
      }
      return op.c;
    }

    case "CHECKER": {
      if (tx < op.x || tx >= op.x + op.w || ty < op.y || ty >= op.y + op.h) {
        return -1;
      }
      const cellX = floorDivNonNegative(tx - op.x, op.cell);
      const cellY = floorDivNonNegative(ty - op.y, op.cell);
      return (cellX + cellY) % 2 === 0 ? op.a : op.b;
    }
  }
}

/**
 * The whole painting law in one function: walk ops from LAST to FIRST and take
 * the first that covers the texel.
 */
export function texelPaletteIndex(
  ops: readonly CanonicalOp[],
  tx: number,
  ty: number,
): number {
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    const index = opPaletteIndexAt(ops[i]!, tx, ty);
    if (index >= 0) return index;
  }
  throw new Error(
    `texel (${tx}, ${ty}) is uncovered — record 0 must be BG, which covers every texel`,
  );
}
