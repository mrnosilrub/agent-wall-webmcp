/**
 * Frozen Scene-v1 SHAPES canonical form. Owner-approved 2026-08-25 ("approve shapes").
 *
 * This byte layout is frozen Scene-v1 law. Canonical bytes, magic AWS1 and
 * protocolVersion 1 are unchanged from the approved candidate.
 *
 * ── Container, big-endian, no flags, no reserved bytes, no blob section ─────
 *
 *   magic        4                    "AWS1"
 *   version      u16                  = 1
 *   parcelW      u16                  1..1000, bound into the commitment
 *   parcelH      u16                  1..1000
 *   paletteLen   u16                  1..256
 *   palette      paletteLen * 3       RGB8, unique, first-use ordered
 *   opCount      u16                  1..4096, BG included
 *   records                           in exact op order, width per opcode:
 *                BG      2   op + c
 *                RECT   10   op + x,y,w,h u16 + c
 *                CIRCLE  8   op + cx,cy,r u16 + c
 *                TRI    14   op + x0,y0,x1,y1,x2,y2 u16 + c
 *                CHECKER 13  op + x,y,w,h u16 + a + b + cell u16
 *
 * Canonicity is structural: fixed widths, no optional fields, no maps, no
 * varints. Trailing bytes are rejected. Scene dimensions are NOT stored — they
 * are derived from the Parcel through the integrated `sceneSize()`; the Parcel
 * is stored so the commitment cannot be replayed against other geometry.
 *
 * The palette is derived here, never supplied. `decodeSceneV1` proves a
 * received palette is the one this canonicaliser would have produced by
 * decoding to semantic colours, re-canonicalising and demanding byte equality —
 * so duplicate, unused and misordered entries are all one rejection.
 */

import { sceneSize } from "./scene.js";
import {
  SCENE_V1_COLOR_OPERANDS,
  SCENE_V1_HEADER_BYTES,
  SCENE_V1_MAGIC_BYTES,
  SCENE_V1_NAME_BY_OPCODE,
  SCENE_V1_OPCODE_BY_NAME,
  SCENE_V1_OPCOUNT_BYTES,
  SCENE_V1_RECORD_FIELDS,
  sceneV1ProgramByteLength,
  sceneV1RecordBytes,
  type SceneV1RecordOpName,
} from "./scene-v1-format.js";
import { planSceneV1 } from "./scene-v1-plan.js";
import {
  SCENE_V1_LIMITS,
  SCENE_V1_VERSION,
  type Rgb,
  type SceneV1Op,
  type SceneV1Program,
  sceneV1Reject,
} from "./scene-v1-program.js";

export {
  SCENE_V1_HEADER_BYTES,
  SCENE_V1_MAGIC,
  SCENE_V1_NUMERIC_OPERANDS,
  SCENE_V1_OPCOUNT_BYTES,
  sceneV1ProgramByteLength,
  sceneV1RecordBytes,
} from "./scene-v1-format.js";

export type CanonicalOpName = SceneV1RecordOpName;

export type CanonicalOp =
  | { readonly op: "BG"; readonly c: number }
  | {
      readonly op: "RECT";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly c: number;
    }
  | {
      readonly op: "CIRCLE";
      readonly cx: number;
      readonly cy: number;
      readonly r: number;
      readonly c: number;
    }
  | {
      readonly op: "TRI";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly c: number;
    }
  | {
      readonly op: "CHECKER";
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly a: number;
      readonly b: number;
      readonly cell: number;
    };

export interface CanonicalProgram {
  readonly version: typeof SCENE_V1_VERSION;
  readonly parcelWidth: number;
  readonly parcelHeight: number;
  readonly palette: readonly Rgb[];
  /** Record 0 is always BG. */
  readonly ops: readonly CanonicalOp[];
}

export interface ParcelDimensionsInput {
  readonly width: number;
  readonly height: number;
}

// ── canonicalisation ────────────────────────────────────────────────────────

const paletteKey = (rgb: Rgb): number =>
  (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

/**
 * Derives the unique first-use-ordered palette and rewrites every colour as an
 * index. Parcel geometry is validated through the integrated `sceneSize()`, so
 * this module never becomes a second authority on Scene dimensions.
 */
export function canonicaliseSceneV1(
  program: SceneV1Program,
  parcel: ParcelDimensionsInput,
): CanonicalProgram {
  const parcelWidth = parcel.width;
  const parcelHeight = parcel.height;
  try {
    sceneSize({ width: parcelWidth, height: parcelHeight });
  } catch {
    sceneV1Reject(
      "scene_v1_parcel_out_of_range",
      `${String(parcelWidth)}x${String(parcelHeight)}`,
    );
  }

  const palette: Rgb[] = [];
  const seen = new Map<number, number>();

  const indexOf = (rgb: Rgb): number => {
    const key = paletteKey(rgb);
    const existing = seen.get(key);
    if (existing !== undefined) return existing;
    if (palette.length >= SCENE_V1_LIMITS.paletteMax) {
      sceneV1Reject(
        "scene_v1_palette_length_out_of_range",
        `more than ${SCENE_V1_LIMITS.paletteMax} distinct colours`,
      );
    }
    const index = palette.length;
    palette.push(rgb);
    seen.set(key, index);
    return index;
  };

  const ops: CanonicalOp[] = [{ op: "BG", c: indexOf(program.background) }];

  for (const op of program.ops) {
    switch (op.op) {
      case "RECT":
        ops.push({
          op: "RECT",
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          c: indexOf(op.color as Rgb),
        });
        break;
      case "CIRCLE":
        ops.push({
          op: "CIRCLE",
          cx: op.cx,
          cy: op.cy,
          r: op.r,
          c: indexOf(op.color as Rgb),
        });
        break;
      case "TRI":
        ops.push({
          op: "TRI",
          x0: op.x0,
          y0: op.y0,
          x1: op.x1,
          y1: op.y1,
          x2: op.x2,
          y2: op.y2,
          c: indexOf(op.color as Rgb),
        });
        break;
      case "CHECKER": {
        // `a` before `b`: the palette order is part of the commitment.
        const a = indexOf(op.a as Rgb);
        const b = indexOf(op.b as Rgb);
        ops.push({
          op: "CHECKER",
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          a,
          b,
          cell: op.cell,
        });
        break;
      }
    }
  }

  if (ops.length > SCENE_V1_LIMITS.opCountMax) {
    sceneV1Reject(
      "scene_v1_op_count_out_of_range",
      `${ops.length} > ${SCENE_V1_LIMITS.opCountMax}`,
    );
  }

  return Object.freeze({
    version: SCENE_V1_VERSION,
    parcelWidth,
    parcelHeight,
    palette: Object.freeze(palette.map((c) => Object.freeze([...c]) as Rgb)),
    ops: Object.freeze(ops.map((op) => Object.freeze(op))),
  });
}

/** The inverse mapping: canonical indices back to the inline-RGB program. */
export function canonicalToSceneV1Program(
  canonical: CanonicalProgram,
): SceneV1Program {
  const palette = canonical.palette;
  const colorAt = (index: number): Rgb => {
    const rgb = palette[index];
    if (!rgb) {
      sceneV1Reject(
        "scene_v1_palette_index_out_of_range",
        `${index} >= ${palette.length}`,
      );
    }
    return rgb;
  };

  const first = canonical.ops[0];
  if (!first || first.op !== "BG") {
    sceneV1Reject("scene_v1_background_not_first");
  }

  const ops: SceneV1Op[] = [];
  for (let i = 1; i < canonical.ops.length; i += 1) {
    const op = canonical.ops[i]!;
    switch (op.op) {
      case "BG":
        sceneV1Reject("scene_v1_background_repeated", `record ${i}`);
        break;
      case "RECT":
        ops.push({
          op: "RECT",
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          color: [...colorAt(op.c)] as [number, number, number],
        });
        break;
      case "CIRCLE":
        ops.push({
          op: "CIRCLE",
          cx: op.cx,
          cy: op.cy,
          r: op.r,
          color: [...colorAt(op.c)] as [number, number, number],
        });
        break;
      case "TRI":
        ops.push({
          op: "TRI",
          x0: op.x0,
          y0: op.y0,
          x1: op.x1,
          y1: op.y1,
          x2: op.x2,
          y2: op.y2,
          color: [...colorAt(op.c)] as [number, number, number],
        });
        break;
      case "CHECKER":
        ops.push({
          op: "CHECKER",
          x: op.x,
          y: op.y,
          w: op.w,
          h: op.h,
          a: [...colorAt(op.a)] as [number, number, number],
          b: [...colorAt(op.b)] as [number, number, number],
          cell: op.cell,
        });
        break;
    }
  }

  return Object.freeze({
    v: SCENE_V1_VERSION,
    background: Object.freeze([...colorAt(first.c)]) as Rgb,
    ops: Object.freeze(ops),
  });
}

// ── encoding ────────────────────────────────────────────────────────────────

function writeUint(
  view: DataView,
  offset: number,
  size: 1 | 2,
  value: number,
): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** (size * 8)) {
    throw new RangeError(`value ${value} does not fit in u${size * 8}`);
  }
  if (size === 1) view.setUint8(offset, value);
  else view.setUint16(offset, value, false);
  return offset + size;
}

export function encodeSceneV1(canonical: CanonicalProgram): Uint8Array {
  const total = sceneV1ProgramByteLength(canonical);
  if (total > SCENE_V1_LIMITS.programBytesMax) {
    sceneV1Reject(
      "scene_v1_program_too_large",
      `${total} > ${SCENE_V1_LIMITS.programBytesMax}`,
    );
  }

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let o = 0;
  for (let i = 0; i < 4; i += 1) bytes[o + i] = SCENE_V1_MAGIC_BYTES[i]!;
  o += 4;
  o = writeUint(view, o, 2, canonical.version);
  o = writeUint(view, o, 2, canonical.parcelWidth);
  o = writeUint(view, o, 2, canonical.parcelHeight);
  o = writeUint(view, o, 2, canonical.palette.length);
  for (const [r, g, b] of canonical.palette) {
    o = writeUint(view, o, 1, r);
    o = writeUint(view, o, 1, g);
    o = writeUint(view, o, 1, b);
  }
  o = writeUint(view, o, 2, canonical.ops.length);
  for (const op of canonical.ops) {
    const start = o;
    o = writeUint(view, o, 1, SCENE_V1_OPCODE_BY_NAME[op.op]);
    for (const [field, size] of SCENE_V1_RECORD_FIELDS[op.op]) {
      o = writeUint(view, o, size, (op as unknown as Record<string, number>)[field]!);
    }
    const written = o - start;
    const declared = sceneV1RecordBytes(op.op);
    if (written !== declared) {
      throw new Error(
        `record width drift: ${op.op} wrote ${written}, derived width is ${declared}`,
      );
    }
  }
  if (o !== total) {
    throw new Error(`encode length drift: wrote ${o}, sized ${total}`);
  }
  return bytes;
}

// ── decoding ────────────────────────────────────────────────────────────────

export function decodeSceneV1(bytes: Uint8Array): CanonicalProgram {
  if (bytes.length > SCENE_V1_LIMITS.programBytesMax) {
    sceneV1Reject(
      "scene_v1_program_too_large",
      `${bytes.length} > ${SCENE_V1_LIMITS.programBytesMax}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (offset: number, n: number): void => {
    if (offset + n > bytes.length) {
      sceneV1Reject("scene_v1_truncated", `need ${n} more bytes at ${offset}`);
    }
  };

  need(0, SCENE_V1_HEADER_BYTES);
  for (let i = 0; i < 4; i += 1) {
    if (bytes[i] !== SCENE_V1_MAGIC_BYTES[i]) {
      sceneV1Reject("scene_v1_bad_magic");
    }
  }

  let o = 4;
  const version = view.getUint16(o, false);
  o += 2;
  if (version !== SCENE_V1_VERSION) {
    sceneV1Reject("scene_v1_bad_version", String(version));
  }
  const parcelWidth = view.getUint16(o, false);
  o += 2;
  const parcelHeight = view.getUint16(o, false);
  o += 2;
  try {
    sceneSize({ width: parcelWidth, height: parcelHeight });
  } catch {
    sceneV1Reject(
      "scene_v1_parcel_out_of_range",
      `${parcelWidth}x${parcelHeight}`,
    );
  }

  const paletteLen = view.getUint16(o, false);
  o += 2;
  if (paletteLen < 1 || paletteLen > SCENE_V1_LIMITS.paletteMax) {
    sceneV1Reject("scene_v1_palette_length_out_of_range", String(paletteLen));
  }
  need(o, paletteLen * 3);
  const palette: Rgb[] = [];
  for (let i = 0; i < paletteLen; i += 1) {
    palette.push(Object.freeze([bytes[o]!, bytes[o + 1]!, bytes[o + 2]!]) as Rgb);
    o += 3;
  }

  need(o, SCENE_V1_OPCOUNT_BYTES);
  const opCount = view.getUint16(o, false);
  o += 2;
  if (opCount < 1 || opCount > SCENE_V1_LIMITS.opCountMax) {
    sceneV1Reject("scene_v1_op_count_out_of_range", String(opCount));
  }

  const ops: CanonicalOp[] = [];
  for (let i = 0; i < opCount; i += 1) {
    need(o, 1);
    const code = bytes[o]!;
    const name = SCENE_V1_NAME_BY_OPCODE.get(code);
    if (name === undefined) {
      sceneV1Reject(
        "scene_v1_unknown_opcode",
        `0x${code.toString(16).padStart(2, "0")} at record ${i}`,
      );
    }
    const width = sceneV1RecordBytes(name);
    need(o, width);
    let p = o + 1;
    const fields: Record<string, number> = {};
    for (const [field, size] of SCENE_V1_RECORD_FIELDS[name]) {
      fields[field] = size === 1 ? view.getUint8(p) : view.getUint16(p, false);
      p += size;
    }
    if (p - o !== width) throw new Error("decode width drift");
    o = p;

    for (const field of SCENE_V1_COLOR_OPERANDS[name]) {
      const index = fields[field]!;
      if (index >= paletteLen) {
        sceneV1Reject(
          "scene_v1_palette_index_out_of_range",
          `record ${i} ${field}=${index} >= ${paletteLen}`,
        );
      }
    }

    if (name === "BG") {
      if (i !== 0) sceneV1Reject("scene_v1_background_repeated", `record ${i}`);
    } else if (i === 0) {
      sceneV1Reject("scene_v1_background_not_first", `record 0 is ${name}`);
    }

    ops.push(Object.freeze({ op: name, ...fields }) as unknown as CanonicalOp);
  }

  if (o !== bytes.length) {
    sceneV1Reject(
      "scene_v1_trailing_bytes",
      `${bytes.length - o} bytes after the last record`,
    );
  }

  const decoded: CanonicalProgram = Object.freeze({
    version: SCENE_V1_VERSION,
    parcelWidth,
    parcelHeight,
    palette: Object.freeze(palette),
    ops: Object.freeze(ops),
  });

  assertPaletteIsCanonical(decoded, bytes);
  planSceneV1(decoded);
  return decoded;
}

/**
 * A received palette is canonical only if it is the palette this module would
 * have derived. Decoding to semantic colours, re-canonicalising and demanding
 * byte equality collapses "duplicate entry", "unused entry" and "wrong order"
 * into one check that cannot drift from the encoder.
 */
function assertPaletteIsCanonical(
  decoded: CanonicalProgram,
  original: Uint8Array,
): void {
  const semantic = canonicalToSceneV1Program(decoded);
  const recanonicalised = canonicaliseSceneV1(semantic, {
    width: decoded.parcelWidth,
    height: decoded.parcelHeight,
  });
  const reencoded = encodeSceneV1(recanonicalised);
  if (reencoded.length !== original.length) {
    sceneV1Reject(
      "scene_v1_palette_not_canonical",
      `re-encoding is ${reencoded.length} bytes, received ${original.length}`,
    );
  }
  for (let i = 0; i < reencoded.length; i += 1) {
    if (reencoded[i] !== original[i]) {
      sceneV1Reject(
        "scene_v1_palette_not_canonical",
        `re-encoding differs at byte ${i}`,
      );
    }
  }
}

/** Convenience: validated JSON model + Parcel to canonical bytes. */
export function sceneV1CanonicalBytes(
  program: SceneV1Program,
  parcel: ParcelDimensionsInput,
): { canonical: CanonicalProgram; bytes: Uint8Array } {
  const canonical = canonicaliseSceneV1(program, parcel);
  return { canonical, bytes: encodeSceneV1(canonical) };
}

/** Exposed so the compiler can reuse the derived numeric operand table. */
