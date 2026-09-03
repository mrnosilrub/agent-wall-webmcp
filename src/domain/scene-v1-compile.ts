/**
 * Frozen Scene-v1 SHAPES compiler. Owner-approved 2026-08-25 ("approve shapes").
 *
 * Hash adapter, byte layout and commitments in this module are frozen Scene-v1
 * law. Worker CPU/time proof remains downstream.
 *
 * ── Hash adapter ────────────────────────────────────────────────────────────
 * A permanent onchain commitment must have exactly one possible byte result, so
 * Scene v1 has exactly ONE hasher and this is it.
 *
 * `@noble/hashes` (pinned exactly at 2.3.0) is used rather than a platform
 * primitive because the three platform routes each fail one requirement:
 *   - `crypto.DigestStream` is workerd-only, so Node and Worker would differ;
 *   - `crypto.subtle.digest` cannot stream, and a full Wall Scene is
 *     768,000,000 RGB bytes that must never be materialised at once;
 *   - `node:crypto` `createHash` is Node-only.
 * The chosen release is audited, MIT, has zero transitive dependencies, is ESM
 * ES2022, and exposes an incremental `create().update().digest()`. Writing a
 * custom SHA-256 is prohibited: two implementations means two possible results.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import { encodeSceneV1, type CanonicalOp, type CanonicalProgram } from "./scene-v1-canonical.js";
import {
  boundingBoxArea,
  coverageTexels,
  floorDiv,
  opRowRange,
  planSceneV1,
  rowSpan,
  type SceneV1Plan,
} from "./scene-v1-plan.js";

export { boundingBoxArea, coverageTexels, opRowRange, planSceneV1, rowSpan };
export type { SceneV1Plan };

const HEX = "0123456789abcdef";

function toLowerHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    out += HEX[(b >>> 4) & 0x0f]! + HEX[b & 0x0f]!;
  }
  return out;
}

/** Incremental SHA-256 over an arbitrarily long byte stream. */
export interface Sha256Stream {
  /** Consumes `chunk` by value at call time; the caller may reuse the buffer. */
  update(chunk: Uint8Array): void;
  /** Finalises. Any further `update` or `digestHex` throws. */
  digestHex(): string;
}

export function createSha256Stream(): Sha256Stream {
  const hash = sha256.create();
  return {
    update(chunk: Uint8Array): void {
      hash.update(chunk);
    },
    digestHex(): string {
      return toLowerHex(hash.digest());
    },
  };
}

/** Lowercase hex SHA-256 of exactly `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return toLowerHex(sha256(bytes));
}

// ── the optimised banded streaming compiler ─────────────────────────────────

export interface CompileSceneV1Options {
  /**
   * Receives each finished band in y order. The buffer is REUSED between
   * bands — copy it if you need to keep it.
   */
  readonly onBand?: (band: Uint8Array, bandIndex: number, rowCount: number) => void;
  /** Injectable allocator, so tests can prove nothing large is allocated. */
  readonly allocate?: (byteLength: number) => Uint8Array;
}

export interface SceneV1Commitments {
  readonly plan: SceneV1Plan;
  /** Lowercase SHA-256 of the exact canonical program bytes. */
  readonly programSha256: string;
  /** Lowercase SHA-256 of the exact full row-major RGB stream. No Merkle root. */
  readonly rgbSha256: string;
  readonly rgbBytesStreamed: number;
  readonly peakBytes: number;
  readonly bandBufferBytes: number;
  readonly opIndexBytes: number;
}

/** Fills `count` texels from `texelOffset` by doubling memmoves. */
function fillRun(
  band: Uint8Array,
  texelOffset: number,
  count: number,
  r: number,
  g: number,
  b: number,
): void {
  if (count <= 0) return;
  const start = texelOffset * 3;
  band[start] = r;
  band[start + 1] = g;
  band[start + 2] = b;
  let filled = 1;
  while (filled < count) {
    const n = Math.min(filled, count - filled);
    band.copyWithin(start + filled * 3, start, start + n * 3);
    filled += n;
  }
}

function paintSpan(
  band: Uint8Array,
  rowBase: number,
  span: readonly [number, number],
  op: CanonicalOp,
  ty: number,
  palette: readonly (readonly [number, number, number])[],
): void {
  const [x0, x1] = span;
  if (op.op === "CHECKER") {
    const cellRow = floorDiv(ty - op.y, op.cell);
    let x = x0;
    while (x < x1) {
      const cellCol = floorDiv(x - op.x, op.cell);
      const runEnd = Math.min(x1, op.x + (cellCol + 1) * op.cell);
      const c = palette[(cellCol + cellRow) % 2 === 0 ? op.a : op.b]!;
      fillRun(band, rowBase + x, runEnd - x, c[0], c[1], c[2]);
      x = runEnd;
    }
    return;
  }
  const c = palette[(op as { c: number }).c]!;
  fillRun(band, rowBase + x0, x1 - x0, c[0], c[1], c[2]);
}

/**
 * Compiles a canonical program to its two commitments.
 *
 * Bands are `SCENE_V1_LIMITS.bandRows` texel rows — one Pixel row. Peak working
 * allocation is `sceneWidth * bandRows * 3` plus an op index whose size depends
 * on `opCount` and `bandCount` only, never on Scene area. The full frame is
 * never allocated: each band is painted, fed to the hash, handed to `onBand`,
 * and reused.
 *
 * Every rejection happens in `planSceneV1` before the first allocation.
 */
export function compileSceneV1(
  canonical: CanonicalProgram,
  options: CompileSceneV1Options = {},
): SceneV1Commitments {
  // Fails closed before anything is allocated.
  const plan = planSceneV1(canonical);

  const allocate = options.allocate ?? ((n: number) => new Uint8Array(n));
  const { sceneWidth, sceneHeight, bandRows, bandCount } = plan;
  const palette = canonical.palette as readonly (readonly [
    number,
    number,
    number,
  ])[];
  const ops = canonical.ops;
  const background = palette[(ops[0] as { c: number }).c]!;

  // ── bounded op index ──────────────────────────────────────────────────────
  // Painted ops (everything after BG) are bucketed by their FIRST band only,
  // then swept into an active set as y advances. Memory is O(opCount) plus one
  // counter per band; it never grows with the number of (op, band) memberships,
  // so a program of full-height ops on a tall Parcel cannot inflate it.
  const painted = ops.length - 1;
  const startBand = new Int32Array(painted);
  const endBand = new Int32Array(painted);
  const bucketCount = new Int32Array(bandCount + 1);
  for (let i = 0; i < painted; i += 1) {
    const op = ops[i + 1]!;
    const [y0, y1] = opRowRange(op, sceneHeight);
    const b0 = Math.max(0, Math.min(bandCount - 1, Math.floor(y0 / bandRows)));
    const b1 = Math.max(0, Math.min(bandCount - 1, Math.floor((y1 - 1) / bandRows)));
    startBand[i] = b0;
    endBand[i] = b1;
    bucketCount[b0] += 1;
  }
  const bucketStart = new Int32Array(bandCount + 1);
  for (let b = 0; b < bandCount; b += 1) {
    bucketStart[b + 1] = bucketStart[b]! + bucketCount[b]!;
  }
  // Stable counting sort: within a band, arrivals keep painter order.
  const arrivals = new Int32Array(painted);
  const cursor = bucketStart.slice(0, bandCount);
  for (let i = 0; i < painted; i += 1) {
    const b = startBand[i]!;
    arrivals[cursor[b]!] = i;
    cursor[b] += 1;
  }
  let active = new Int32Array(painted);
  let merged = new Int32Array(painted);
  let activeCount = 0;

  const opIndexBytes =
    startBand.byteLength +
    endBand.byteLength +
    bucketCount.byteLength +
    bucketStart.byteLength +
    arrivals.byteLength +
    cursor.byteLength +
    active.byteLength +
    merged.byteLength;

  const bandBufferBytes = sceneWidth * bandRows * 3;
  const band = allocate(bandBufferBytes);
  if (band.length !== bandBufferBytes) {
    throw new Error("allocator returned the wrong band length");
  }
  const peakBytes = bandBufferBytes + opIndexBytes;

  const hash = createSha256Stream();
  let streamed = 0;
  const rowBytes = sceneWidth * 3;

  for (let b = 0; b < bandCount; b += 1) {
    const bandY0 = b * bandRows;

    // Background: paint one row, then replicate it across the band.
    fillRun(band, 0, sceneWidth, background[0], background[1], background[2]);
    for (let row = 1; row < bandRows; row += 1) {
      band.copyWithin(row * rowBytes, 0, rowBytes);
    }

    // Retire ops that ended before this band, keeping op order.
    if (activeCount > 0) {
      let kept = 0;
      for (let k = 0; k < activeCount; k += 1) {
        const i = active[k]!;
        if (endBand[i]! >= b) {
          active[kept] = i;
          kept += 1;
        }
      }
      activeCount = kept;
    }

    // Merge this band's arrivals in, preserving ascending op order.
    const from = bucketStart[b]!;
    const to = bucketStart[b + 1]!;
    if (to > from) {
      let a = 0;
      let n = from;
      let m = 0;
      while (a < activeCount && n < to) {
        const left = active[a]!;
        const right = arrivals[n]!;
        if (left <= right) {
          merged[m] = left;
          a += 1;
        } else {
          merged[m] = right;
          n += 1;
        }
        m += 1;
      }
      while (a < activeCount) {
        merged[m] = active[a]!;
        a += 1;
        m += 1;
      }
      while (n < to) {
        merged[m] = arrivals[n]!;
        n += 1;
        m += 1;
      }
      const swap = active;
      active = merged;
      merged = swap;
      activeCount = m;
    }

    for (let k = 0; k < activeCount; k += 1) {
      const op = ops[active[k]! + 1]!;
      const [oy0, oy1] = opRowRange(op, sceneHeight);
      const y0 = Math.max(bandY0, oy0);
      const y1 = Math.min(bandY0 + bandRows, oy1);
      for (let ty = y0; ty < y1; ty += 1) {
        const span = rowSpan(op, ty, sceneWidth);
        if (!span) continue;
        paintSpan(band, (ty - bandY0) * sceneWidth, span, op, ty, palette);
      }
    }

    hash.update(band);
    streamed += bandBufferBytes;
    options.onBand?.(band, b, bandRows);
  }

  if (streamed !== plan.rgbByteLength) {
    throw new Error(
      `RGB stream drift: emitted ${streamed}, Scene is ${plan.rgbByteLength} bytes`,
    );
  }

  return Object.freeze({
    plan,
    programSha256: sha256Hex(encodeSceneV1(canonical)),
    rgbSha256: hash.digestHex(),
    rgbBytesStreamed: streamed,
    peakBytes,
    bandBufferBytes,
    opIndexBytes,
  });
}
