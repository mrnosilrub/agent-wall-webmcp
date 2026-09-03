import { z } from "zod";

import { compileSceneV1, sha256Hex } from "../domain/scene-v1-compile.js";
import { canonicaliseSceneV1 } from "../domain/scene-v1-canonical.js";
import {
  PRICE_MICRO_USDC_PER_PIXEL,
  PRICE_USD_PER_PIXEL,
  rectPixelCount,
} from "../domain/pricing.js";
import { sceneSize, sceneTexelCount } from "../domain/scene.js";
import type { SceneV1Program } from "../domain/scene-v1-program.js";
import {
  CHAIN_ID_DECIMAL,
  TOOL_NAMES,
  TOOL_RESULT_MAX_BYTES,
  ToolInputError,
  parseToolInput,
  type InspectReceiptInput,
  type PreviewParcelInput,
  type SurveyWallInput,
  type ToolName,
} from "./contracts.js";

const rectSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const MAX_PREVIEW_PIXELS = 4_096;

const sceneFactsSchema = z.strictObject({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  texels: z.number().int().positive(),
  rgbBytes: z.number().int().positive(),
  programSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rgbSha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const fixtureReceiptSchema = z.strictObject({
  receiptId: z.string().min(1).max(128),
  status: z.literal("fixture"),
  parcel: rectSchema,
  pixels: z.number().int().positive(),
  priceUsdc: z.number().int().positive(),
  scene: sceneFactsSchema,
});

const challengeFixtureSchema = z.strictObject({
  mode: z.literal("fixture"),
  chain: z.literal("base-sepolia"),
  chainId: z.literal(CHAIN_ID_DECIMAL),
  testnet: z.literal(true),
  canonical: z.literal(false),
  wall: z.strictObject({
    width: z.literal(1000),
    height: z.literal(1000),
    totalPixels: z.literal(1_000_000),
    occupiedPixels: z.number().int().min(0).max(1_000_000),
    occupiedRects: z.array(rectSchema).max(256).default([]),
  }),
  receipts: z.record(z.string(), fixtureReceiptSchema),
});

export type ChallengeFixture = z.infer<typeof challengeFixtureSchema>;

export interface TransientStagePort {
  stage(candidate: unknown): void;
}

export interface HandlerOptions {
  readonly fixture: unknown;
  readonly transientStage: TransientStagePort;
  readonly now?: () => number;
}

type Handler = (input: unknown) => unknown;
export type HandlerMap = Readonly<Record<ToolName, Handler>>;

function envelope(fixture: ChallengeFixture) {
  return {
    mode: fixture.mode,
    chain: fixture.chain,
    chainId: fixture.chainId,
    testnet: fixture.testnet,
    canonical: fixture.canonical,
  } as const;
}

function enforceResultBound<T>(value: T): T {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > TOOL_RESULT_MAX_BYTES) {
    throw new ToolInputError("result_too_large", "Tool result exceeded its public byte budget");
  }
  return value;
}

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function assertCandidateOpen(
  fixture: ChallengeFixture,
  input: { x: number; y: number; width: number; height: number },
): void {
  if (fixture.wall.occupiedRects.some((occupied) => overlaps(input, occupied))) {
    throw new ToolInputError("occupied", "The fixture candidate overlaps an occupied Pixel");
  }
}

function assertPreviewBudget(input: { width: number; height: number }): void {
  if (input.width * input.height > MAX_PREVIEW_PIXELS) {
    throw new ToolInputError(
      "result_too_large",
      `Challenge previews are limited to ${MAX_PREVIEW_PIXELS} Pixels`,
    );
  }
}

function candidateSha256(preview: {
  readonly mode: "fixture";
  readonly chainId: string;
  readonly testnet: true;
  readonly canonical: false;
  readonly parcel: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly priceMicroUsdc: number;
  readonly scene: { readonly programSha256: string; readonly rgbSha256: string };
}): string {
  const canonicalCandidate = JSON.stringify({
    v: 1,
    mode: preview.mode,
    chainId: preview.chainId,
    testnet: preview.testnet,
    canonical: preview.canonical,
    parcel: preview.parcel,
    priceMicroUsdc: preview.priceMicroUsdc,
    programSha256: preview.scene.programSha256,
    rgbSha256: preview.scene.rgbSha256,
    intent: "presentation-only",
  });
  return sha256Hex(new TextEncoder().encode(canonicalCandidate));
}

function previewResult(
  fixture: ChallengeFixture,
  input: PreviewParcelInput,
) {
  assertCandidateOpen(fixture, input);
  assertPreviewBudget(input);
  const canonical = canonicaliseSceneV1(
    input.program as SceneV1Program,
    input,
  );
  const compiled = compileSceneV1(canonical);
  const pixels = rectPixelCount(input);
  const scene = sceneSize(input);
  return {
    ...envelope(fixture),
    parcel: { x: input.x, y: input.y, width: input.width, height: input.height },
    pixels,
    texels: sceneTexelCount(scene),
    priceUsdc: pixels * PRICE_USD_PER_PIXEL,
    priceMicroUsdc: pixels * PRICE_MICRO_USDC_PER_PIXEL,
    scene: {
      width: scene.width,
      height: scene.height,
      texels: sceneTexelCount(scene),
      rgbBytes: sceneTexelCount(scene) * 3,
      programSha256: compiled.programSha256,
      rgbSha256: compiled.rgbSha256,
    },
  } as const;
}

function surveyResult(fixture: ChallengeFixture, input: SurveyWallInput) {
  const pixels = rectPixelCount(input);
  return {
    ...envelope(fixture),
    wall: {
      width: fixture.wall.width,
      height: fixture.wall.height,
      totalPixels: fixture.wall.totalPixels,
      texelsPerPixel: 256,
    },
    candidate: {
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      pixels,
      priceUsdc: pixels * PRICE_USD_PER_PIXEL,
      available: true,
    },
  } as const;
}

export function createHandlers(options: HandlerOptions): HandlerMap {
  const candidateFixture = options.fixture as Partial<ChallengeFixture> | null;
  if (
    candidateFixture === null ||
    candidateFixture.mode !== "fixture" ||
    candidateFixture.chain !== "base-sepolia" ||
    candidateFixture.chainId !== CHAIN_ID_DECIMAL ||
    candidateFixture.testnet !== true ||
    candidateFixture.canonical !== false
  ) {
    throw new ToolInputError(
      "wrong_mode",
      "Challenge handlers require the exact Base Sepolia fixture identity",
    );
  }
  const fixture = challengeFixtureSchema.parse(options.fixture);
  const now = options.now ?? Date.now;

  const handlers: HandlerMap = Object.freeze({
    survey_wall(input: unknown) {
      const parsed = parseToolInput("survey_wall", input) as SurveyWallInput;
      assertCandidateOpen(fixture, parsed);
      return enforceResultBound(surveyResult(fixture, parsed));
    },

    preview_parcel(input: unknown) {
      const parsed = parseToolInput("preview_parcel", input) as PreviewParcelInput;
      return enforceResultBound(previewResult(fixture, parsed));
    },

    stage_parcel(input: unknown) {
      const parsed = parseToolInput("stage_parcel", input) as PreviewParcelInput;
      const preview = previewResult(fixture, parsed);
      const expiresAtMs = now() + 300_000;
      const candidateDigest = candidateSha256(preview);
      const candidate = Object.freeze({
        x: parsed.x,
        y: parsed.y,
        width: parsed.width,
        height: parsed.height,
        pixels: preview.pixels,
        priceUsdc: preview.priceUsdc,
        sceneWidth: preview.scene.width,
        sceneHeight: preview.scene.height,
        programSha256: preview.scene.programSha256,
        rgbSha256: preview.scene.rgbSha256,
        candidateSha256: candidateDigest,
        expiresAtMs,
      });
      options.transientStage.stage(candidate);
      return enforceResultBound({
        ...preview,
        candidateSha256: candidateDigest,
        stage: {
          state: "staged",
          presentation: "EPHEMERAL / NOT PURCHASED",
          ephemeral: true,
          expiresAtMs,
        },
      });
    },

    inspect_receipt(input: unknown) {
      const parsed = parseToolInput("inspect_receipt", input) as InspectReceiptInput;
      const receipt = fixture.receipts[parsed.receiptId];
      if (receipt === undefined) {
        throw new ToolInputError(
          "unavailable_receipt",
          "The requested fixture receipt is unavailable",
        );
      }
      return enforceResultBound({ ...envelope(fixture), receipt });
    },
  });

  for (const name of TOOL_NAMES) {
    if (handlers[name] === undefined) {
      throw new ToolInputError("unknown_tool", `Missing handler ${name}`);
    }
  }
  return handlers;
}
