import { z } from "zod";

import { assertValidClaimRect } from "../domain/pricing.js";
import { canonicaliseSceneV1 } from "../domain/scene-v1-canonical.js";
import {
  sceneV1ProgramSchema,
  type SceneV1Program,
} from "../domain/scene-v1-program.js";
import { planSceneV1 } from "../domain/scene-v1-plan.js";

export const CHAIN_ID_DECIMAL = "84532" as const;
export const TOOL_RESULT_MAX_BYTES = 1_536;

export const TOOL_NAMES = [
  "survey_wall",
  "preview_parcel",
  "stage_parcel",
  "inspect_receipt",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export const TOOL_ERROR_CODES = [
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
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export class ToolInputError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolInputError";
    this.code = code;
  }
}

export function toolErrorPayload(error: unknown): {
  readonly error: { readonly code: string; readonly message: string };
} {
  if (error instanceof ToolInputError) {
    return { error: { code: error.code, message: error.message } };
  }
  return { error: { code: "invalid_input", message: "Tool execution failed" } };
}

const RECT_SHAPE = {
  x: z.number().finite().int().min(0).max(999),
  y: z.number().finite().int().min(0).max(999),
  width: z.number().finite().int().min(1).max(1_000),
  height: z.number().finite().int().min(1).max(1_000),
} as const;

function withWallBounds<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape).superRefine((value, context) => {
    try {
      assertValidClaimRect(value as { x: number; y: number; width: number; height: number });
    } catch {
      context.addIssue({
        code: "custom",
        message: "Parcel must be one in-bounds rectangle on the 1000×1000 Wall",
        path: ["width"],
      });
    }
  });
}

const surveyWallInputSchema = withWallBounds(RECT_SHAPE);
const previewParcelInputSchema = withWallBounds({
  ...RECT_SHAPE,
  program: sceneV1ProgramSchema,
});
const stageParcelInputSchema = withWallBounds({
  ...RECT_SHAPE,
  program: sceneV1ProgramSchema,
});
const inspectReceiptInputSchema = z.strictObject({
  receiptId: z.string().min(1).max(128).regex(/^fixture-receipt-[0-9a-z-]+$/),
});

const INPUT_SCHEMAS = {
  survey_wall: surveyWallInputSchema,
  preview_parcel: previewParcelInputSchema,
  stage_parcel: stageParcelInputSchema,
  inspect_receipt: inspectReceiptInputSchema,
} as const;

const INPUT_KEYS: Readonly<Record<ToolName, ReadonlySet<string>>> = {
  survey_wall: new Set(["x", "y", "width", "height"]),
  preview_parcel: new Set(["x", "y", "width", "height", "program"]),
  stage_parcel: new Set(["x", "y", "width", "height", "program"]),
  inspect_receipt: new Set(["receiptId"]),
};

export type SurveyWallInput = z.infer<typeof surveyWallInputSchema>;
export type PreviewParcelInput = z.infer<typeof previewParcelInputSchema>;
export type StageParcelInput = z.infer<typeof stageParcelInputSchema>;
export type InspectReceiptInput = z.infer<typeof inspectReceiptInputSchema>;
export type ToolInput =
  | SurveyWallInput
  | PreviewParcelInput
  | StageParcelInput
  | InspectReceiptInput;

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: false;
  readonly openWorldHint: false;
}

export interface ToolDescriptor {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: ToolAnnotations;
}

function descriptor(
  name: ToolName,
  description: string,
  readOnlyHint: boolean,
): ToolDescriptor {
  const inputSchema = z.toJSONSchema(INPUT_SCHEMAS[name]) as Record<string, unknown>;
  if (name === "preview_parcel" || name === "stage_parcel") {
    inputSchema["description"] =
      "Parcel dimensions are bounded by the Wall; width × height must not exceed 4,096 Pixels.";
    inputSchema["x-agent-wall-max-pixels"] = 4_096;
  }
  return Object.freeze({
    name,
    description,
    inputSchema: Object.freeze(inputSchema),
    annotations: Object.freeze({
      readOnlyHint,
      destructiveHint: false as const,
      openWorldHint: false as const,
    }),
  });
}

export const TOOL_CATALOG: readonly ToolDescriptor[] = Object.freeze([
  descriptor(
    "survey_wall",
    "Survey one bounded rectangle of the fixture Wall and return exact Pixel count and flat-price facts.",
    true,
  ),
  descriptor(
    "preview_parcel",
    "Validate Parcel geometry and a Scene-v1 Paint Program, then return exact dimensions, price, and deterministic digests.",
    true,
  ),
  descriptor(
    "stage_parcel",
    "Stage a non-binding local Parcel presentation for human review; it never reserves, orders, signs, pays, or mints.",
    false,
  ),
  descriptor(
    "inspect_receipt",
    "Inspect one deterministic fixture receipt with explicit Base Sepolia testnet and noncanonical labels.",
    true,
  ),
]);

function hasUnknownTopLevelKey(name: ToolName, input: unknown): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const allowed = INPUT_KEYS[name];
  return Object.keys(input).some((key) => !allowed.has(key));
}

function parseFailureCode(name: ToolName, input: unknown): ToolErrorCode {
  if (hasUnknownTopLevelKey(name, input)) return "unknown_key";
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return "invalid_input";
  }
  if (name === "inspect_receipt") return "invalid_input";
  if (name === "preview_parcel" || name === "stage_parcel") {
    if (
      input !== null &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      "program" in input
    ) {
      const program = (input as { program?: unknown }).program;
      const parsedProgram = sceneV1ProgramSchema.safeParse(program);
      if (!parsedProgram.success) return "invalid_program";
    }
  }
  const rect = input as Record<string, unknown>;
  if (
    !["x", "y", "width", "height"].every((key) =>
      typeof rect[key] === "number" &&
      Number.isFinite(rect[key]) &&
      Number.isInteger(rect[key]),
    )
  ) {
    return "invalid_input";
  }
  return "out_of_bounds";
}

export function parseToolInput(name: ToolName, input: unknown): ToolInput {
  const schema = INPUT_SCHEMAS[name];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ToolInputError(parseFailureCode(name, input), "Tool input did not satisfy the closed contract");
  }

  if (name === "preview_parcel" || name === "stage_parcel") {
    const sceneInput = parsed.data as PreviewParcelInput;
    try {
      const canonical = canonicaliseSceneV1(
        sceneInput.program as SceneV1Program,
        sceneInput,
      );
      planSceneV1(canonical);
    } catch {
      throw new ToolInputError("invalid_program", "Scene-v1 program is invalid for this Parcel");
    }
  }

  return parsed.data;
}
