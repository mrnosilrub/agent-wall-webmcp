/**
 * Frozen Scene-v1 SHAPES record format. Owner-approved 2026-08-25 ("approve shapes").
 *
 * This table is the single authority for opcode numbers, ordered numeric and
 * colour operands, field widths, field order, and derived record widths.
 * Program, canonical, encoder, decoder and tests project from it; they do not
 * keep a second copy.
 */

export const SCENE_V1_MAGIC = "AWS1" as const;

export const SCENE_V1_MAGIC_BYTES = Object.freeze([0x41, 0x57, 0x53, 0x31]);

/** magic 4 + version 2 + parcelW 2 + parcelH 2 + paletteLen 2. */
export const SCENE_V1_HEADER_BYTES = 12;
export const SCENE_V1_OPCOUNT_BYTES = 2;

export type SceneV1FieldKind = "numeric" | "color";
export type SceneV1FieldWidth = 1 | 2;

export interface SceneV1OpField {
  readonly name: string;
  readonly width: SceneV1FieldWidth;
  readonly kind: SceneV1FieldKind;
}

export interface SceneV1OpDescriptor {
  readonly name: SceneV1RecordOpName;
  readonly code: number;
  readonly fields: readonly SceneV1OpField[];
}

const field = (
  name: string,
  width: SceneV1FieldWidth,
  kind: SceneV1FieldKind,
): SceneV1OpField => Object.freeze({ name, width, kind });

export const SCENE_V1_OP_DESCRIPTORS = Object.freeze({
  BG: Object.freeze({
    name: "BG",
    code: 0x00,
    fields: Object.freeze([field("c", 1, "color")]),
  }),
  RECT: Object.freeze({
    name: "RECT",
    code: 0x01,
    fields: Object.freeze([
      field("x", 2, "numeric"),
      field("y", 2, "numeric"),
      field("w", 2, "numeric"),
      field("h", 2, "numeric"),
      field("c", 1, "color"),
    ]),
  }),
  CIRCLE: Object.freeze({
    name: "CIRCLE",
    code: 0x02,
    fields: Object.freeze([
      field("cx", 2, "numeric"),
      field("cy", 2, "numeric"),
      field("r", 2, "numeric"),
      field("c", 1, "color"),
    ]),
  }),
  TRI: Object.freeze({
    name: "TRI",
    code: 0x03,
    fields: Object.freeze([
      field("x0", 2, "numeric"),
      field("y0", 2, "numeric"),
      field("x1", 2, "numeric"),
      field("y1", 2, "numeric"),
      field("x2", 2, "numeric"),
      field("y2", 2, "numeric"),
      field("c", 1, "color"),
    ]),
  }),
  CHECKER: Object.freeze({
    name: "CHECKER",
    code: 0x04,
    fields: Object.freeze([
      field("x", 2, "numeric"),
      field("y", 2, "numeric"),
      field("w", 2, "numeric"),
      field("h", 2, "numeric"),
      field("a", 1, "color"),
      field("b", 1, "color"),
      field("cell", 2, "numeric"),
    ]),
  }),
} as const);

export type SceneV1RecordOpName = keyof typeof SCENE_V1_OP_DESCRIPTORS;

export const SCENE_V1_RECORD_OP_NAMES = Object.freeze(
  Object.keys(SCENE_V1_OP_DESCRIPTORS) as SceneV1RecordOpName[],
);

function projectOperands(
  op: SceneV1RecordOpName,
  kind: SceneV1FieldKind,
): readonly string[] {
  return Object.freeze(
    SCENE_V1_OP_DESCRIPTORS[op].fields
      .filter((f) => f.kind === kind)
      .map((f) => f.name),
  );
}

function projectFields(
  op: SceneV1RecordOpName,
): ReadonlyArray<readonly [string, SceneV1FieldWidth]> {
  return Object.freeze(
    SCENE_V1_OP_DESCRIPTORS[op].fields.map(
      (f) => Object.freeze([f.name, f.width] as const),
    ),
  );
}

/** Ordered opcode table projected from the descriptor table. */
export const SCENE_V1_OPCODES = Object.freeze({
  BG: Object.freeze({
    code: SCENE_V1_OP_DESCRIPTORS.BG.code,
    operands: projectOperands("BG", "numeric"),
  }),
  RECT: Object.freeze({
    code: SCENE_V1_OP_DESCRIPTORS.RECT.code,
    operands: projectOperands("RECT", "numeric"),
  }),
  CIRCLE: Object.freeze({
    code: SCENE_V1_OP_DESCRIPTORS.CIRCLE.code,
    operands: projectOperands("CIRCLE", "numeric"),
  }),
  TRI: Object.freeze({
    code: SCENE_V1_OP_DESCRIPTORS.TRI.code,
    operands: projectOperands("TRI", "numeric"),
  }),
  CHECKER: Object.freeze({
    code: SCENE_V1_OP_DESCRIPTORS.CHECKER.code,
    operands: projectOperands("CHECKER", "numeric"),
  }),
});

export const SCENE_V1_COLOR_OPERANDS: Readonly<
  Record<SceneV1RecordOpName, readonly string[]>
> = Object.freeze({
  BG: projectOperands("BG", "color"),
  RECT: projectOperands("RECT", "color"),
  CIRCLE: projectOperands("CIRCLE", "color"),
  TRI: projectOperands("TRI", "color"),
  CHECKER: projectOperands("CHECKER", "color"),
});

export const SCENE_V1_NUMERIC_OPERANDS: Readonly<
  Record<SceneV1RecordOpName, readonly string[]>
> = Object.freeze({
  BG: SCENE_V1_OPCODES.BG.operands,
  RECT: SCENE_V1_OPCODES.RECT.operands,
  CIRCLE: SCENE_V1_OPCODES.CIRCLE.operands,
  TRI: SCENE_V1_OPCODES.TRI.operands,
  CHECKER: SCENE_V1_OPCODES.CHECKER.operands,
});

export const SCENE_V1_RECORD_FIELDS: Readonly<
  Record<SceneV1RecordOpName, ReadonlyArray<readonly [string, SceneV1FieldWidth]>>
> = Object.freeze({
  BG: projectFields("BG"),
  RECT: projectFields("RECT"),
  CIRCLE: projectFields("CIRCLE"),
  TRI: projectFields("TRI"),
  CHECKER: projectFields("CHECKER"),
});

export const SCENE_V1_OPCODE_BY_NAME: Readonly<Record<SceneV1RecordOpName, number>> =
  Object.freeze({
    BG: SCENE_V1_OP_DESCRIPTORS.BG.code,
    RECT: SCENE_V1_OP_DESCRIPTORS.RECT.code,
    CIRCLE: SCENE_V1_OP_DESCRIPTORS.CIRCLE.code,
    TRI: SCENE_V1_OP_DESCRIPTORS.TRI.code,
    CHECKER: SCENE_V1_OP_DESCRIPTORS.CHECKER.code,
  });

export const SCENE_V1_NAME_BY_OPCODE = new Map<number, SceneV1RecordOpName>(
  SCENE_V1_RECORD_OP_NAMES.map((name) => [SCENE_V1_OPCODE_BY_NAME[name], name]),
);

/** Record width: opcode byte plus every field. Never hand-written. */
export function sceneV1RecordBytes(op: SceneV1RecordOpName): number {
  let bytes = 1;
  for (const f of SCENE_V1_OP_DESCRIPTORS[op].fields) bytes += f.width;
  return bytes;
}

export function sceneV1ProgramByteLength(canonical: {
  readonly palette: { readonly length: number };
  readonly ops: ReadonlyArray<{ readonly op: SceneV1RecordOpName }>;
}): number {
  let bytes =
    SCENE_V1_HEADER_BYTES + canonical.palette.length * 3 + SCENE_V1_OPCOUNT_BYTES;
  for (const op of canonical.ops) bytes += sceneV1RecordBytes(op.op);
  return bytes;
}
