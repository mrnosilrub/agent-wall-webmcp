import { describe, expect, it } from "vitest";

import {
  CHAIN_ID_DECIMAL,
  TOOL_CATALOG,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
  TOOL_RESULT_MAX_BYTES,
  parseToolInput,
} from "../src/tools/contracts.js";

const CANONICAL_TOOL_NAMES = [
  "survey_wall",
  "preview_parcel",
  "stage_parcel",
  "inspect_receipt",
] as const;

type CanonicalToolName = (typeof CANONICAL_TOOL_NAMES)[number];

const PROGRAM = {
  v: 1,
  background: [245, 242, 236],
  ops: [
    {
      op: "RECT",
      x: 0,
      y: 0,
      w: 16,
      h: 16,
      color: [23, 23, 27],
    },
  ],
} as const;

const VALID_INPUTS = {
  survey_wall: { x: 0, y: 0, width: 3, height: 4 },
  preview_parcel: { x: 0, y: 0, width: 3, height: 4, program: PROGRAM },
  stage_parcel: { x: 0, y: 0, width: 3, height: 4, program: PROGRAM },
  inspect_receipt: { receiptId: "fixture-receipt-0001" },
} as const;

const EXPECTED_INPUT_KEYS: Record<CanonicalToolName, readonly string[]> = {
  survey_wall: ["x", "y", "width", "height"],
  preview_parcel: ["x", "y", "width", "height", "program"],
  stage_parcel: ["x", "y", "width", "height", "program"],
  inspect_receipt: ["receiptId"],
};

const FORBIDDEN_INPUT_KEYS = [
  "payment",
  "paymentIntent",
  "paymentMethod",
  "card",
  "applePay",
  "order",
  "orderId",
  "reservation",
  "reservationId",
  "hold",
  "signature",
  "authorization",
  "authority",
  ["authority", "Evidence"].join(""),
  "wallet",
  ["private", "Key"].join(""),
  "recipient",
  "payer",
  "provider",
  "rpcUrl",
  "mint",
  "charge",
  "capture",
] as const;

function inputWith(
  name: CanonicalToolName,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...VALID_INPUTS[name], ...patch };
}

function parse(name: CanonicalToolName, input: unknown): unknown {
  return parseToolInput(name, input);
}

describe("canonical Agent Wall tool contracts", () => {
  it("freezes exactly the four first-party tools in canonical order", () => {
    expect(TOOL_NAMES).toEqual(CANONICAL_TOOL_NAMES);
    expect(TOOL_CATALOG.map((tool) => tool.name)).toEqual(CANONICAL_TOOL_NAMES);
    expect(new Set(TOOL_CATALOG.map((tool) => tool.name)).size).toBe(4);

    for (const tool of TOOL_CATALOG) {
      expect(tool.name.length).toBeLessThan(30);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(Object.keys(tool).sort()).toEqual(
        ["annotations", "description", "inputSchema", "name"].sort(),
      );
    }
  });

  it("pins the annotations and closed input shape for every tool", () => {
    const readOnlyByTool: Record<CanonicalToolName, boolean> = {
      survey_wall: true,
      preview_parcel: true,
      stage_parcel: false,
      inspect_receipt: true,
    };

    for (const toolName of CANONICAL_TOOL_NAMES) {
      const tool = TOOL_CATALOG.find((candidate) => candidate.name === toolName);
      expect(tool).toBeDefined();
      if (!tool) continue;

      expect(tool.annotations).toEqual({
        readOnlyHint: readOnlyByTool[toolName],
        destructiveHint: false,
        openWorldHint: false,
      });

      const schema = tool.inputSchema as {
        type?: unknown;
        additionalProperties?: unknown;
        required?: unknown;
        properties?: Record<string, unknown>;
      };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required).toEqual(EXPECTED_INPUT_KEYS[toolName]);
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        [...EXPECTED_INPUT_KEYS[toolName]].sort(),
      );
    }

    for (const toolName of ["preview_parcel", "stage_parcel"] as const) {
      const schema = TOOL_CATALOG.find((tool) => tool.name === toolName)?.inputSchema;
      expect(schema?.["x-agent-wall-max-pixels"]).toBe(4_096);
      expect(schema?.["description"]).toContain("width × height");
      expect(schema?.["description"]).toContain("4,096");
    }
  });

  it("uses the exact decimal Base Sepolia chain identity and result cap", () => {
    expect(typeof CHAIN_ID_DECIMAL).toBe("string");
    expect(CHAIN_ID_DECIMAL).toBe("84532");
    expect(CHAIN_ID_DECIMAL).not.toBe("0x14a34");
    expect(CHAIN_ID_DECIMAL).not.toBe("8453");
    expect(TOOL_RESULT_MAX_BYTES).toBe(1_536);
    expect(TOOL_ERROR_CODES).toEqual([
      "invalid_input",
      "unknown_key",
      "out_of_bounds",
      "invalid_program",
      "occupied",
      "expired_stage",
      "wrong_mode",
      "unavailable_receipt",
      "unknown_tool",
      "result_too_large",
    ]);
  });

  it("distinguishes malformed input from valid-shaped out-of-bounds geometry", () => {
    expect(() => parse("inspect_receipt", { receiptId: "" })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() => parse("survey_wall", { x: 0, y: 0, width: "3", height: 4 })).toThrowError(
      expect.objectContaining({ code: "invalid_input" }),
    );
    expect(() => parse("survey_wall", { x: 999, y: 0, width: 2, height: 1 })).toThrowError(
      expect.objectContaining({ code: "out_of_bounds" }),
    );
  });

  it("accepts the canonical inputs and rejects every unknown top-level key", () => {
    for (const toolName of CANONICAL_TOOL_NAMES) {
      expect(() => parse(toolName, VALID_INPUTS[toolName])).not.toThrow();
      expect(() =>
        parse(toolName, inputWith(toolName, { unexpected: true })),
      ).toThrow();
    }
  });

  it("rejects unknown keys at every nested Scene-v1 object boundary", () => {
    const preview = VALID_INPUTS.preview_parcel;
    const program = preview.program;
    const op = program.ops[0];

    expect(() =>
      parse("preview_parcel", {
        ...preview,
        program: { ...program, unknownProgramKey: true },
      }),
    ).toThrow();

    expect(() =>
      parse("preview_parcel", {
        ...preview,
        program: { ...program, ops: [{ ...op, unknownOpKey: true }] },
      }),
    ).toThrow();

    for (const key of ["dimensions", "resolution", "sceneWidth", "sceneHeight"]) {
      expect(() =>
        parse("preview_parcel", {
          ...preview,
          program: { ...program, [key]: { width: 48, height: 64 } },
        }),
      ).toThrow();
    }
  });

  it("does not admit payment, order, custody, signing, or authority fields", () => {
    for (const toolName of CANONICAL_TOOL_NAMES) {
      for (const forbiddenKey of FORBIDDEN_INPUT_KEYS) {
        expect(() =>
          parse(toolName, inputWith(toolName, { [forbiddenKey]: "forbidden" })),
        ).toThrow();
      }
    }
  });

  it("accepts every inclusive Wall rectangle boundary", () => {
    const validParcels = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 999, y: 999, width: 1, height: 1 },
      { x: 999, y: 0, width: 1, height: 1000 },
      { x: 0, y: 999, width: 1000, height: 1 },
      { x: 0, y: 0, width: 1000, height: 1000 },
    ] as const;

    for (const parcel of validParcels) {
      expect(() =>
        parse("preview_parcel", { ...parcel, program: PROGRAM }),
      ).not.toThrow();
      expect(() => parse("survey_wall", parcel)).not.toThrow();
    }
  });

  it("rejects every outside, zero, fractional, and non-finite Wall boundary", () => {
    const invalidParcels = [
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: -1, width: 1, height: 1 },
      { x: 1000, y: 0, width: 1, height: 1 },
      { x: 0, y: 1000, width: 1, height: 1 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 },
      { x: 1001, y: 0, width: 1, height: 1 },
      { x: 0, y: 1001, width: 1, height: 1 },
      { x: 999, y: 0, width: 2, height: 1 },
      { x: 0, y: 999, width: 1, height: 2 },
      { x: 1, y: 0, width: 1000, height: 1 },
      { x: 0, y: 1, width: 1, height: 1000 },
      { x: 0.5, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1.5, height: 1 },
      { x: Number.NaN, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 },
    ] as const;

    for (const parcel of invalidParcels) {
      expect(() =>
        parse("preview_parcel", { ...parcel, program: PROGRAM }),
      ).toThrow();
      expect(() => parse("survey_wall", parcel)).toThrow();
    }
  });

  it("binds Scene-v1 geometry to the Parcel instead of accepting caller dimensions", () => {
    const onePixel = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      program: PROGRAM,
    };
    const edgeRectProgram = {
      ...PROGRAM,
      ops: [
        {
          op: "RECT",
          x: 15,
          y: 15,
          w: 1,
          h: 1,
          color: [23, 23, 27],
        },
      ],
    } as const;
    const outsideSceneProgram = {
      ...PROGRAM,
      ops: [
        {
          op: "RECT",
          x: 16,
          y: 0,
          w: 1,
          h: 1,
          color: [23, 23, 27],
        },
      ],
    } as const;

    expect(() => parse("preview_parcel", onePixel)).not.toThrow();
    expect(() =>
      parse("preview_parcel", { ...onePixel, program: edgeRectProgram }),
    ).not.toThrow();
    expect(() =>
      parse("preview_parcel", { ...onePixel, program: outsideSceneProgram }),
    ).toThrow();
    expect(() =>
      parse("preview_parcel", {
        ...onePixel,
        sceneWidth: 16,
        sceneHeight: 16,
      }),
    ).toThrow();
  });
});
