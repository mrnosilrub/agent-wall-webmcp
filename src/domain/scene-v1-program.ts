/**
 * Frozen Scene-v1 SHAPES semantic model. Owner-approved 2026-08-25 ("approve shapes").
 *
 * Opcode set, field names, limits and rejection codes are Scene-v1 law. Wiring,
 * storage, archive reconstruction and Worker CPU proof remain downstream.
 *
 * ── The agent-facing program ────────────────────────────────────────────────
 * A Scene v1 program is strict, closed JSON with inline RGB:
 *
 *   { "v": 1,
 *     "background": [245, 242, 236],
 *     "ops": [ { "op": "RECT", "x": 0, "y": 0, "w": 4, "h": 4,
 *                "color": [23, 23, 27] } ] }
 *
 * Deliberately absent, and rejected by name where an agent might try:
 *   - dimensions. Scene size is derived from the Parcel via `sceneSize()`.
 *   - a caller-supplied palette. The canonicaliser derives one in first-use
 *     order, so key order and whitespace cannot change the committed bytes and
 *     there is no duplicate/unused-entry ambiguity to arbitrate.
 *   - `SET_PIXEL` (a `1x1 RECT` is exact per-texel work), `BLIT`, masks, blobs,
 *     `VGRAD`, alpha, blending, antialiasing, clipping, transforms, scripts,
 *     randomness, network, fonts and assets.
 *
 * Painting law is last-writer-wins over exact integer coverage predicates.
 * `BG` is not an `ops` entry: it is the required `background` field and the
 * canonicaliser emits it as record 0 exactly once.
 */

import { z } from "zod";

export const SCENE_V1_VERSION = 1 as const;

/**
 * Frozen Scene-v1 limits. Not environment-configurable. Worker CPU/time is
 * still unproven; the numeric caps themselves are frozen law.
 * They may reject a program. They never resize a Scene and never reject valid
 * Parcel geometry by themselves.
 */
export const SCENE_V1_LIMITS = Object.freeze({
  /** Maximum UTF-8 bytes of a submitted JSON body. */
  jsonBytesMax: 524_288,
  /**
   * Maximum BYTES of the canonical binary program: 256 KiB.
   *
   * Spelled `256 * 1024` on purpose. The retired adaptive-art law used a
   * same-valued TEXEL constant, and `tests/scene.test.ts` guards `mcp/src`
   * against that literal reappearing. This is a byte budget for a serialised
   * program, not a texel count, and it must not be mistaken for the ghost of
   * the retired cap — so the literal is not written out.
   */
  programBytesMax: 256 * 1024,
  /** Maximum canonical records, BG included. */
  opCountMax: 4_096,
  /** Maximum distinct colours in the derived palette. */
  paletteMax: 256,
  /** Compiler band height in texel rows; one Pixel row. */
  bandRows: 16,
  /** work <= workSceneMultiplier * sceneTexels + opCount. */
  workSceneMultiplier: 4,
  /** Owner visual gate answered 2026-08-25; limits are frozen Scene-v1 law. */
  frozen: true,
} as const);

/** Every stable machine-readable rejection code in Scene v1. */
export const SCENE_V1_REJECT_CODES = [
  // JSON and schema layer
  "scene_v1_json_too_large",
  "scene_v1_json_malformed",
  "scene_v1_duplicate_json_key",
  "scene_v1_not_an_object",
  "scene_v1_unknown_field",
  "scene_v1_dimensions_supplied",
  "scene_v1_bad_version",
  "scene_v1_bad_color",
  "scene_v1_ops_not_array",
  "scene_v1_op_count_out_of_range",
  "scene_v1_unknown_opcode",
  "scene_v1_bad_operand",
  // Canonical byte layer
  "scene_v1_bad_magic",
  "scene_v1_truncated",
  "scene_v1_trailing_bytes",
  "scene_v1_program_too_large",
  "scene_v1_palette_length_out_of_range",
  "scene_v1_palette_not_canonical",
  "scene_v1_palette_index_out_of_range",
  "scene_v1_parcel_out_of_range",
  "scene_v1_background_not_first",
  "scene_v1_background_repeated",
  // Geometry and limit layer
  "scene_v1_op_out_of_bounds",
  "scene_v1_rect_degenerate",
  "scene_v1_circle_radius_zero",
  "scene_v1_checker_cell_zero",
  "scene_v1_degenerate_triangle",
  "scene_v1_op_covers_nothing",
  "scene_v1_work_budget_exceeded",
] as const;

export type SceneV1RejectCode = (typeof SCENE_V1_REJECT_CODES)[number];

export class SceneV1RejectError extends Error {
  readonly code: SceneV1RejectCode;
  readonly detail: string | null;

  constructor(code: SceneV1RejectCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SceneV1RejectError";
    this.code = code;
    this.detail = detail ?? null;
  }
}

export function sceneV1Reject(code: SceneV1RejectCode, detail?: string): never {
  throw new SceneV1RejectError(code, detail);
}

// ── exact integer guards ────────────────────────────────────────────────────
// Every operand is a finite safe integer. `Number.isSafeInteger` already
// excludes NaN, +/-Infinity, non-integers and anything beyond 2^53-1; the
// explicit `Object.is(n, -0)` test excludes negative zero, which is an integer
// and compares equal to 0 but is a distinct IEEE value and therefore a distinct
// serialisation an agent could use to probe for canonicalisation drift.

export const SCENE_V1_COORD_MAX = 65_535;

export function isSceneV1Coord(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    !Object.is(n, -0) &&
    n >= 0 &&
    n <= SCENE_V1_COORD_MAX
  );
}

export function isSceneV1Channel(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    !Object.is(n, -0) &&
    n >= 0 &&
    n <= 255
  );
}

// ── Zod schema ──────────────────────────────────────────────────────────────

const coord = z.number().refine(isSceneV1Coord, {
  message: "must be a safe integer coordinate in [0, 65535]",
});
const channel = z.number().refine(isSceneV1Channel, {
  message: "must be a safe integer channel in [0, 255]",
});
const rgb = z.tuple([channel, channel, channel]);

const rectSchema = z.strictObject({
  op: z.literal("RECT"),
  x: coord,
  y: coord,
  w: coord,
  h: coord,
  color: rgb,
});

const circleSchema = z.strictObject({
  op: z.literal("CIRCLE"),
  cx: coord,
  cy: coord,
  r: coord,
  color: rgb,
});

const triSchema = z.strictObject({
  op: z.literal("TRI"),
  x0: coord,
  y0: coord,
  x1: coord,
  y1: coord,
  x2: coord,
  y2: coord,
  color: rgb,
});

const checkerSchema = z.strictObject({
  op: z.literal("CHECKER"),
  x: coord,
  y: coord,
  w: coord,
  h: coord,
  a: rgb,
  b: rgb,
  cell: coord,
});

export const sceneV1OpSchema = z.discriminatedUnion("op", [
  rectSchema,
  circleSchema,
  triSchema,
  checkerSchema,
]);

export const sceneV1ProgramSchema = z.strictObject({
  v: z.literal(SCENE_V1_VERSION),
  background: rgb,
  ops: z.array(sceneV1OpSchema).max(SCENE_V1_LIMITS.opCountMax - 1),
});

export type Rgb = readonly [number, number, number];
export type SceneV1Op = z.infer<typeof sceneV1OpSchema>;
export type SceneV1OpName = SceneV1Op["op"];
export type SceneV1Program = Readonly<{
  v: typeof SCENE_V1_VERSION;
  background: Rgb;
  ops: readonly SceneV1Op[];
}>;

export { SCENE_V1_OPCODES } from "./scene-v1-format.js";

// ── parsing ─────────────────────────────────────────────────────────────────

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["v", "background", "ops"]);

/**
 * Keys that name a dimension. Scene size is derived from Parcel geometry, so
 * these get their own code rather than a generic unknown-field rejection: an
 * agent that sends one has misunderstood the protocol, not made a typo.
 */
const DIMENSION_KEYS: ReadonlySet<string> = new Set([
  "width",
  "height",
  "w",
  "h",
  "sceneWidth",
  "sceneHeight",
  "parcelWidth",
  "parcelHeight",
  "size",
  "dimensions",
  "resolution",
]);

/**
 * Depth past which nothing legal exists: program(0) > ops(1) > op(2) >
 * colour(3) > channel(4). Anything deeper is returned by reference and the
 * schema rejects it, so a hostile deeply nested body cannot drive recursion.
 */
const SNAPSHOT_MAX_DEPTH = 5;

/**
 * UTF-8 byte length of a JS string, matching `TextEncoder`, without allocating
 * a full encoded buffer. Stops at `cap + 1` so a hostile body cannot force
 * a complete walk past the frozen Scene-v1 JSON limit.
 */
export function sceneV1Utf8ByteLengthBounded(text: string, cap: number): number {
  let bytes = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c <= 0x7f) {
      bytes += 1;
      i += 1;
    } else if (c <= 0x7ff) {
      bytes += 2;
      i += 1;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < n ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 2;
      } else {
        bytes += 3;
        i += 1;
      }
    } else {
      bytes += 3;
      i += 1;
    }
    if (bytes > cap) return cap + 1;
  }
  return bytes;
}

/** Reads every own enumerable property exactly once into fresh containers. */
function snapshot(value: unknown, depth: number): unknown {
  if (depth >= SNAPSHOT_MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) out[i] = snapshot(value[i], depth + 1);
    return out;
  }
  if (value !== null && typeof value === "object") {
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      if (key === "__proto__") {
        sceneV1Reject("scene_v1_unknown_field", key);
      }
      Object.defineProperty(out, key, {
        value: snapshot((value as Record<string, unknown>)[key], depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return value;
}

type ZodIssueLike = { readonly code: string; readonly path: ReadonlyArray<PropertyKey> };

/**
 * Maps schema issues to one stable code. Issues are ranked rather than taken
 * first-come so that the same malformed program always yields the same code
 * regardless of Zod's internal traversal order.
 */
function codeForIssues(issues: ReadonlyArray<ZodIssueLike>): SceneV1RejectCode {
  let best: SceneV1RejectCode | null = null;
  let bestRank = Infinity;

  for (const issue of issues) {
    const path = issue.path;
    let code: SceneV1RejectCode;

    if (issue.code === "unrecognized_keys") {
      const keys = (issue as { keys?: ReadonlyArray<string> }).keys ?? [];
      code = keys.some((k) => path.length === 0 && DIMENSION_KEYS.has(k))
        ? "scene_v1_dimensions_supplied"
        : "scene_v1_unknown_field";
    } else if (path[0] === "v") {
      code = "scene_v1_bad_version";
    } else if (path[0] === "background") {
      code = "scene_v1_bad_color";
    } else if (path[0] === "ops") {
      if (path.length === 1) {
        code =
          issue.code === "too_big"
            ? "scene_v1_op_count_out_of_range"
            : "scene_v1_ops_not_array";
      } else if (path.length === 2) {
        code = "scene_v1_unknown_opcode";
      } else if (path[2] === "op") {
        code = "scene_v1_unknown_opcode";
      } else if (path[2] === "color" || path[2] === "a" || path[2] === "b") {
        code = "scene_v1_bad_color";
      } else {
        code = "scene_v1_bad_operand";
      }
    } else {
      code = "scene_v1_unknown_field";
    }

    const rank = SCENE_V1_REJECT_CODES.indexOf(code);
    if (rank < bestRank) {
      bestRank = rank;
      best = code;
    }
  }

  return best ?? "scene_v1_not_an_object";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/**
 * Validates an already-parsed value. Order matters: the cheap closed-shape and
 * count gates run before anything is copied, so an oversized or hostile body
 * cannot make the validator do unbounded work on its way to being rejected.
 */
export function parseSceneV1Program(value: unknown): SceneV1Program {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    sceneV1Reject("scene_v1_not_an_object", `received ${describe(value)}`);
  }

  for (const key of Object.keys(value)) {
    if (TOP_LEVEL_KEYS.has(key)) continue;
    sceneV1Reject(
      DIMENSION_KEYS.has(key)
        ? "scene_v1_dimensions_supplied"
        : "scene_v1_unknown_field",
      key,
    );
  }

  const record = value as Record<string, unknown>;
  const rawOps = record["ops"];
  if (!Array.isArray(rawOps)) {
    sceneV1Reject("scene_v1_ops_not_array", `received ${describe(rawOps)}`);
  }
  const maxOps = SCENE_V1_LIMITS.opCountMax - 1;
  const opCount = rawOps.length;
  if (opCount > maxOps) {
    sceneV1Reject(
      "scene_v1_op_count_out_of_range",
      `${opCount} ops exceeds ${maxOps} (BG occupies record 0)`,
    );
  }

  // One read per structural field, into fresh containers. Nothing downstream
  // ever touches the caller's objects again, so a getter that changes value or
  // an array mutated after validation cannot alter the committed program.
  // `opCount` is captured once; ops are copied with an indexed loop, never
  // attacker-overridable `.map`.
  const snapshottedOps: unknown[] = new Array(opCount);
  for (let i = 0; i < opCount; i += 1) {
    snapshottedOps[i] = snapshot(rawOps[i], 2);
  }
  const snapshotted = {
    v: record["v"],
    background: snapshot(record["background"], 1),
    ops: snapshottedOps,
  };

  const result = sceneV1ProgramSchema.safeParse(snapshotted);
  if (!result.success) {
    const issues = result.error.issues as ReadonlyArray<ZodIssueLike>;
    sceneV1Reject(codeForIssues(issues), summarise(issues));
  }

  return deepFreeze(result.data) as SceneV1Program;
}

/** Validates a JSON body. The byte gate and duplicate-key scan run before `JSON.parse`. */
export function parseSceneV1ProgramJson(text: string): SceneV1Program {
  const bytes = sceneV1Utf8ByteLengthBounded(text, SCENE_V1_LIMITS.jsonBytesMax);
  if (bytes > SCENE_V1_LIMITS.jsonBytesMax) {
    sceneV1Reject(
      "scene_v1_json_too_large",
      `${bytes} > ${SCENE_V1_LIMITS.jsonBytesMax} UTF-8 bytes`,
    );
  }
  assertSceneV1JsonHasNoDuplicateKeys(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    sceneV1Reject("scene_v1_json_malformed", (err as Error).message);
  }
  return parseSceneV1Program(parsed);
}

/**
 * Iterative, bounded JSON walk that rejects duplicate member names — including
 * escape-equivalent names such as `"v"` and `"\u0076"` — before `JSON.parse`
 * can last-win them. Nesting uses an explicit stack, never the call stack.
 * String contents are lexed, not treated as structure, so key-looking text
 * inside a string cannot be misclassified as a member name.
 */
const JSON_SCAN_MAX_DEPTH = 64;

type JsonScanFrame =
  | {
      readonly kind: "object";
      readonly keys: Set<string>;
      state: "empty" | "needKey" | "afterValue";
    }
  | {
      readonly kind: "array";
      state: "empty" | "needValue" | "afterValue";
    };

function assertSceneV1JsonHasNoDuplicateKeys(text: string): void {
  const n = text.length;
  let i = 0;
  const stack: JsonScanFrame[] = [];

  const malformed = (): never => {
    sceneV1Reject("scene_v1_json_malformed", "duplicate-key scanner");
  };

  const skipWs = (): void => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i += 1;
      else break;
    }
  };

  const hexValue = (c: number): number => {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
    return malformed();
  };

  const parseString = (): string => {
    if (i >= n || text.charCodeAt(i) !== 0x22) malformed();
    i += 1;
    let out = "";
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i += 1;
        return out;
      }
      if (c === 0x5c) {
        i += 1;
        if (i >= n) malformed();
        const e = text.charCodeAt(i);
        i += 1;
        switch (e) {
          case 0x22:
            out += '"';
            break;
          case 0x5c:
            out += "\\";
            break;
          case 0x2f:
            out += "/";
            break;
          case 0x62:
            out += "\b";
            break;
          case 0x66:
            out += "\f";
            break;
          case 0x6e:
            out += "\n";
            break;
          case 0x72:
            out += "\r";
            break;
          case 0x74:
            out += "\t";
            break;
          case 0x75: {
            if (i + 4 > n) malformed();
            let cp = 0;
            for (let k = 0; k < 4; k += 1) {
              cp = (cp << 4) | hexValue(text.charCodeAt(i + k)!);
            }
            i += 4;
            out += String.fromCharCode(cp);
            break;
          }
          default:
            malformed();
        }
        continue;
      }
      if (c < 0x20) malformed();
      out += text[i]!;
      i += 1;
    }
    return malformed();
  };

  const parseNumber = (): void => {
    if (i < n && text.charCodeAt(i) === 0x2d) i += 1;
    if (i >= n) malformed();
    const first = text.charCodeAt(i);
    if (first === 0x30) {
      i += 1;
    } else if (first >= 0x31 && first <= 0x39) {
      i += 1;
      while (i < n && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x39) {
        i += 1;
      }
    } else {
      malformed();
    }
    if (i < n && text.charCodeAt(i) === 0x2e) {
      i += 1;
      if (i >= n || text.charCodeAt(i) < 0x30 || text.charCodeAt(i) > 0x39) {
        malformed();
      }
      while (i < n && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x39) {
        i += 1;
      }
    }
    if (i < n && (text.charCodeAt(i) === 0x65 || text.charCodeAt(i) === 0x45)) {
      i += 1;
      if (i < n && (text.charCodeAt(i) === 0x2b || text.charCodeAt(i) === 0x2d)) {
        i += 1;
      }
      if (i >= n || text.charCodeAt(i) < 0x30 || text.charCodeAt(i) > 0x39) {
        malformed();
      }
      while (i < n && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x39) {
        i += 1;
      }
    }
  };

  const finishValue = (): void => {
    if (stack.length === 0) return;
    stack[stack.length - 1]!.state = "afterValue";
  };

  const closeContainer = (): void => {
    stack.pop();
    finishValue();
  };

  const startValue = (): void => {
    skipWs();
    if (i >= n) malformed();
    const c = text.charCodeAt(i);
    if (c === 0x7b) {
      i += 1;
      if (stack.length >= JSON_SCAN_MAX_DEPTH) malformed();
      stack.push({ kind: "object", keys: new Set(), state: "empty" });
      return;
    }
    if (c === 0x5b) {
      i += 1;
      if (stack.length >= JSON_SCAN_MAX_DEPTH) malformed();
      stack.push({ kind: "array", state: "empty" });
      return;
    }
    if (c === 0x22) {
      parseString();
      finishValue();
      return;
    }
    if (c === 0x74) {
      if (text.slice(i, i + 4) !== "true") malformed();
      i += 4;
      finishValue();
      return;
    }
    if (c === 0x66) {
      if (text.slice(i, i + 5) !== "false") malformed();
      i += 5;
      finishValue();
      return;
    }
    if (c === 0x6e) {
      if (text.slice(i, i + 4) !== "null") malformed();
      i += 4;
      finishValue();
      return;
    }
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
      parseNumber();
      finishValue();
      return;
    }
    malformed();
  };

  startValue();
  while (stack.length > 0) {
    skipWs();
    if (i >= n) malformed();
    const top = stack[stack.length - 1]!;
    const c = text.charCodeAt(i);

    if (top.kind === "object") {
      if (top.state === "empty" || top.state === "needKey") {
        if (top.state === "empty" && c === 0x7d) {
          i += 1;
          closeContainer();
          continue;
        }
        if (c !== 0x22) malformed();
        const key = parseString();
        if (top.keys.has(key)) {
          sceneV1Reject("scene_v1_duplicate_json_key", key);
        }
        top.keys.add(key);
        skipWs();
        if (i >= n || text.charCodeAt(i) !== 0x3a) malformed();
        i += 1;
        startValue();
        continue;
      }
      if (c === 0x7d) {
        i += 1;
        closeContainer();
        continue;
      }
      if (c === 0x2c) {
        i += 1;
        top.state = "needKey";
        continue;
      }
      malformed();
    }

    if (top.state === "empty" || top.state === "needValue") {
      if (top.state === "empty" && c === 0x5d) {
        i += 1;
        closeContainer();
        continue;
      }
      startValue();
      continue;
    }
    if (c === 0x5d) {
      i += 1;
      closeContainer();
      continue;
    }
    if (c === 0x2c) {
      i += 1;
      top.state = "needValue";
      continue;
    }
    malformed();
  }

  skipWs();
  if (i !== n) malformed();
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function summarise(issues: ReadonlyArray<ZodIssueLike>): string {
  const first = issues[0];
  if (!first) return "schema rejected";
  return `${first.code} at ${first.path.map(String).join(".") || "<root>"}`;
}
