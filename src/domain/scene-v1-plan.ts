/**
 * Frozen Scene-v1 SHAPES plan / semantic validation. Owner-approved 2026-08-25.
 *
 * Geometry, coverage, work and limit checks live here so canonical decode and
 * the compiler share one validator. This module imports canonical types
 * type-only and has no runtime import of the canonicaliser, so decode can call
 * it without a cycle.
 */

import type { CanonicalOp, CanonicalProgram } from "./scene-v1-canonical.js";
import { sceneV1ProgramByteLength } from "./scene-v1-format.js";
import { SCENE_V1_LIMITS, sceneV1Reject } from "./scene-v1-program.js";
import { sceneRgbByteLength, sceneSize, sceneTexelCount } from "./scene.js";

function floorDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError("floorDiv by zero");
  let q = Math.floor(a / b);
  if (b > 0) {
    while (q * b > a) q -= 1;
    while ((q + 1) * b <= a) q += 1;
  } else {
    while (q * b < a) q -= 1;
    while ((q + 1) * b >= a) q += 1;
  }
  return q;
}

function ceilDiv(a: number, b: number): number {
  return -floorDiv(-a, b);
}

function dividesExactly(a: number, b: number): boolean {
  return floorDiv(a, b) * b === a;
}

function isqrt(n: number): number {
  if (n < 0) throw new RangeError("isqrt of a negative value");
  let r = Math.floor(Math.sqrt(n));
  while (r > 0 && r * r > n) r -= 1;
  while ((r + 1) * (r + 1) <= n) r += 1;
  return r;
}

interface SpanTriEdge {
  readonly aX: number;
  readonly aY: number;
  readonly dX: number;
  readonly dY: number;
  readonly topLeft: boolean;
}

function spanTriangleEdges(op: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): readonly SpanTriEdge[] | null {
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
  const edges: SpanTriEdge[] = [];
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

export function opRowRange(
  op: CanonicalOp,
  sceneHeight: number,
): readonly [number, number] {
  switch (op.op) {
    case "BG":
      return [0, sceneHeight];
    case "RECT":
    case "CHECKER":
      return [op.y, op.y + op.h];
    case "CIRCLE":
      return [op.cy - op.r, op.cy + op.r];
    case "TRI":
      return [Math.min(op.y0, op.y1, op.y2), Math.max(op.y0, op.y1, op.y2)];
  }
}

export function rowSpan(
  op: CanonicalOp,
  ty: number,
  sceneWidth: number,
): readonly [number, number] | null {
  switch (op.op) {
    case "BG":
      return [0, sceneWidth];
    case "RECT":
    case "CHECKER":
      if (ty < op.y || ty >= op.y + op.h) return null;
      return [op.x, op.x + op.w];
    case "CIRCLE": {
      const dy = 2 * ty + 1 - 2 * op.cy;
      const rhs = 4 * op.r * op.r - dy * dy;
      if (rhs < 0) return null;
      const m = isqrt(rhs);
      const lo = ceilDiv(2 * op.cx - m - 1, 2);
      const hi = floorDiv(2 * op.cx + m - 1, 2);
      const x0 = Math.max(0, lo);
      const x1 = Math.min(sceneWidth, hi + 1);
      return x1 > x0 ? [x0, x1] : null;
    }
    case "TRI": {
      const edges = spanTriangleEdges(op);
      if (!edges) return null;
      const py = 2 * ty + 1;
      let pxMin = -Infinity;
      let pxMax = Infinity;
      for (const e of edges) {
        const a = e.dX * (py - e.aY) + e.dY * e.aX;
        const b = e.dY;
        if (b === 0) {
          const ok = e.topLeft ? a >= 0 : a > 0;
          if (!ok) return null;
          continue;
        }
        if (b > 0) {
          const q = floorDiv(a, b);
          const bound = !e.topLeft && dividesExactly(a, b) ? q - 1 : q;
          if (bound < pxMax) pxMax = bound;
        } else {
          const q = ceilDiv(a, b);
          const bound = !e.topLeft && dividesExactly(a, b) ? q + 1 : q;
          if (bound > pxMin) pxMin = bound;
        }
      }
      if (pxMin > pxMax) return null;
      const loTx = pxMin === -Infinity ? 0 : ceilDiv(pxMin - 1, 2);
      const hiTx = pxMax === Infinity ? sceneWidth - 1 : floorDiv(pxMax - 1, 2);
      const x0 = Math.max(0, loTx);
      const x1 = Math.min(sceneWidth, hiTx + 1);
      return x1 > x0 ? [x0, x1] : null;
    }
  }
}

export function coverageTexels(
  op: CanonicalOp,
  sceneWidth: number,
  sceneHeight: number,
): number {
  switch (op.op) {
    case "BG":
      return sceneWidth * sceneHeight;
    case "RECT":
    case "CHECKER":
      return op.w * op.h;
    case "CIRCLE":
    case "TRI": {
      const [y0, y1] = opRowRange(op, sceneHeight);
      let total = 0;
      for (let ty = Math.max(0, y0); ty < Math.min(sceneHeight, y1); ty += 1) {
        const span = rowSpan(op, ty, sceneWidth);
        if (span) total += span[1] - span[0];
      }
      return total;
    }
  }
}

export function boundingBoxArea(
  op: CanonicalOp,
  sceneWidth: number,
  sceneHeight: number,
): number {
  switch (op.op) {
    case "BG":
      return sceneWidth * sceneHeight;
    case "RECT":
    case "CHECKER":
      return op.w * op.h;
    case "CIRCLE":
      return 2 * op.r * (2 * op.r);
    case "TRI": {
      const width = Math.max(op.x0, op.x1, op.x2) - Math.min(op.x0, op.x1, op.x2);
      const height = Math.max(op.y0, op.y1, op.y2) - Math.min(op.y0, op.y1, op.y2);
      return width * height;
    }
  }
}

export { floorDiv };

export interface SceneV1Plan {
  readonly sceneWidth: number;
  readonly sceneHeight: number;
  readonly sceneTexels: number;
  readonly rgbByteLength: number;
  readonly opCount: number;
  readonly paletteLength: number;
  readonly programBytes: number;
  readonly work: number;
  readonly workBudget: number;
  readonly bandRows: number;
  readonly bandCount: number;
}

export function planSceneV1(canonical: CanonicalProgram): SceneV1Plan {
  let scene;
  try {
    scene = sceneSize({
      width: canonical.parcelWidth,
      height: canonical.parcelHeight,
    });
  } catch {
    sceneV1Reject(
      "scene_v1_parcel_out_of_range",
      `${canonical.parcelWidth}x${canonical.parcelHeight}`,
    );
  }
  const sceneWidth = scene.width;
  const sceneHeight = scene.height;
  const sceneTexels = sceneTexelCount(scene);
  const rgbByteLength = sceneRgbByteLength(scene);

  const ops = canonical.ops;
  const paletteLength = canonical.palette.length;
  if (paletteLength < 1 || paletteLength > SCENE_V1_LIMITS.paletteMax) {
    sceneV1Reject("scene_v1_palette_length_out_of_range", String(paletteLength));
  }
  if (ops.length < 1 || ops.length > SCENE_V1_LIMITS.opCountMax) {
    sceneV1Reject("scene_v1_op_count_out_of_range", String(ops.length));
  }

  const programBytes = sceneV1ProgramByteLength(canonical);
  if (programBytes > SCENE_V1_LIMITS.programBytesMax) {
    sceneV1Reject(
      "scene_v1_program_too_large",
      `${programBytes} > ${SCENE_V1_LIMITS.programBytesMax}`,
    );
  }

  if (ops[0]!.op !== "BG") {
    sceneV1Reject("scene_v1_background_not_first", `record 0 is ${ops[0]!.op}`);
  }

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!;
    if (op.op === "BG" && i !== 0) {
      sceneV1Reject("scene_v1_background_repeated", `record ${i}`);
    }
    validateOp(op, i, sceneWidth, sceneHeight, paletteLength);
  }

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!;
    if (coverageTexels(op, sceneWidth, sceneHeight) < 1) {
      sceneV1Reject("scene_v1_op_covers_nothing", `record ${i} ${op.op}`);
    }
  }

  let work = sceneTexels;
  for (const op of ops) {
    work += boundingBoxArea(op, sceneWidth, sceneHeight);
    if (!Number.isSafeInteger(work)) {
      sceneV1Reject("scene_v1_work_budget_exceeded", "work is not a safe integer");
    }
  }
  const workBudget =
    SCENE_V1_LIMITS.workSceneMultiplier * sceneTexels + ops.length;
  if (work > workBudget) {
    sceneV1Reject("scene_v1_work_budget_exceeded", `${work} > ${workBudget}`);
  }

  const bandRows = SCENE_V1_LIMITS.bandRows;
  if (sceneHeight % bandRows !== 0) {
    throw new Error(
      `Scene height ${sceneHeight} is not a multiple of the ${bandRows}-row band`,
    );
  }

  return Object.freeze({
    sceneWidth,
    sceneHeight,
    sceneTexels,
    rgbByteLength,
    opCount: ops.length,
    paletteLength,
    programBytes,
    work,
    workBudget,
    bandRows,
    bandCount: sceneHeight / bandRows,
  });
}

function validateOp(
  op: CanonicalOp,
  index: number,
  sceneWidth: number,
  sceneHeight: number,
  paletteLength: number,
): void {
  const inPalette = (c: number, fieldName: string): void => {
    if (!Number.isSafeInteger(c) || c < 0 || c >= paletteLength) {
      sceneV1Reject(
        "scene_v1_palette_index_out_of_range",
        `record ${index} ${fieldName}=${c} >= ${paletteLength}`,
      );
    }
  };

  switch (op.op) {
    case "BG":
      inPalette(op.c, "c");
      return;

    case "RECT": {
      const { x, y, w, h, c } = op;
      inPalette(c, "c");
      if (w < 1 || h < 1) {
        sceneV1Reject("scene_v1_rect_degenerate", `record ${index} ${w}x${h}`);
      }
      if (w > sceneWidth || x > sceneWidth - w || h > sceneHeight || y > sceneHeight - h) {
        sceneV1Reject(
          "scene_v1_op_out_of_bounds",
          `record ${index} RECT ${x},${y} ${w}x${h} in ${sceneWidth}x${sceneHeight}`,
        );
      }
      return;
    }

    case "CHECKER": {
      const { x, y, w, h, a, b, cell } = op;
      inPalette(a, "a");
      inPalette(b, "b");
      if (w < 1 || h < 1) {
        sceneV1Reject("scene_v1_rect_degenerate", `record ${index} ${w}x${h}`);
      }
      if (cell < 1) {
        sceneV1Reject("scene_v1_checker_cell_zero", `record ${index}`);
      }
      if (w > sceneWidth || x > sceneWidth - w || h > sceneHeight || y > sceneHeight - h) {
        sceneV1Reject(
          "scene_v1_op_out_of_bounds",
          `record ${index} CHECKER ${x},${y} ${w}x${h} in ${sceneWidth}x${sceneHeight}`,
        );
      }
      return;
    }

    case "CIRCLE": {
      const { cx, cy, r, c } = op;
      inPalette(c, "c");
      if (r < 1) {
        sceneV1Reject("scene_v1_circle_radius_zero", `record ${index}`);
      }
      if (r > cx || r > cy || r > sceneWidth - cx || r > sceneHeight - cy) {
        sceneV1Reject(
          "scene_v1_op_out_of_bounds",
          `record ${index} CIRCLE c=${cx},${cy} r=${r} in ${sceneWidth}x${sceneHeight}`,
        );
      }
      return;
    }

    case "TRI": {
      const { x0, y0, x1, y1, x2, y2, c } = op;
      inPalette(c, "c");
      if (!spanTriangleEdges({ x0, y0, x1, y1, x2, y2 })) {
        sceneV1Reject("scene_v1_degenerate_triangle", `record ${index}`);
      }
      for (const [vx, vy] of [
        [x0, y0],
        [x1, y1],
        [x2, y2],
      ] as const) {
        if (vx > sceneWidth || vy > sceneHeight) {
          sceneV1Reject(
            "scene_v1_op_out_of_bounds",
            `record ${index} TRI vertex ${vx},${vy} in ${sceneWidth}x${sceneHeight}`,
          );
        }
      }
      return;
    }
  }
}
