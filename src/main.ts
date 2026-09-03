import { canonicaliseSceneV1 } from "./domain/scene-v1-canonical.js";
import { compileSceneV1 } from "./domain/scene-v1-compile.js";
import type { SceneV1Program } from "./domain/scene-v1-program.js";
import {
  CHALLENGE_FIXTURE,
  DEMO_SCENE_PROGRAM,
} from "./fixtures/challenge.js";
import { createWebMcpAdapter, registerWebMcpTools } from "./web/webmcp.js";
import {
  mountAgentWall,
  type ParcelRect,
  type ScenePresetId,
} from "./web/view.js";

function sceneProgram(rect: ParcelRect, preset: ScenePresetId): SceneV1Program {
  const width = rect.width * 16;
  const height = rect.height * 16;
  const ink: [number, number, number] = [23, 23, 27];
  const paper: [number, number, number] = [245, 242, 236];
  const accent: [number, number, number] = [124, 45, 45];

  switch (preset) {
    case "field":
      return { v: 1, background: paper, ops: [] };
    case "frame":
      return {
        v: 1,
        background: paper,
        ops: [
          { op: "RECT", x: 0, y: 0, w: width, h: 1, color: ink },
          { op: "RECT", x: 0, y: height - 1, w: width, h: 1, color: ink },
          { op: "RECT", x: 0, y: 1, w: 1, h: height - 2, color: ink },
          { op: "RECT", x: width - 1, y: 1, w: 1, h: height - 2, color: ink },
        ],
      };
    case "medallion":
      return {
        v: 1,
        background: paper,
        ops: [
          {
            op: "CIRCLE",
            cx: Math.floor(width / 2),
            cy: Math.floor(height / 2),
            r: Math.max(1, Math.floor(Math.min(width, height) / 3)),
            color: accent,
          },
        ],
      };
    case "pediment":
      return {
        v: 1,
        background: paper,
        ops: [
          {
            op: "TRI",
            x0: Math.floor(width / 2),
            y0: 1,
            x1: 1,
            y1: height - 1,
            x2: width - 1,
            y2: height - 1,
            color: ink,
          },
        ],
      };
    case "mosaic":
      return {
        v: 1,
        background: paper,
        ops: [
          {
            op: "CHECKER",
            x: 0,
            y: 0,
            w: width,
            h: height,
            a: paper,
            b: accent,
            cell: Math.max(1, Math.floor(Math.min(width, height) / 8)),
          },
        ],
      };
  }
}

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("missing #app");

const adapter = createWebMcpAdapter({
  fixture: CHALLENGE_FIXTURE,
  transientStage: {
    stage() {},
  },
});

interface ScenePreviewInput extends ParcelRect {
  readonly program: SceneV1Program;
}

function renderScene(input: ScenePreviewInput): HTMLCanvasElement {
  const canonical = canonicaliseSceneV1(input.program, input);
  const width = input.width * 16;
  const height = input.height * 16;
  const rgba = new Uint8ClampedArray(width * height * 4);
  compileSceneV1(canonical, {
    onBand(band, bandIndex, rowCount) {
      let sourceOffset = 0;
      let targetOffset = bandIndex * rowCount * width * 4;
      for (let texel = 0; texel < width * rowCount; texel += 1) {
        rgba[targetOffset] = band[sourceOffset] ?? 0;
        rgba[targetOffset + 1] = band[sourceOffset + 1] ?? 0;
        rgba[targetOffset + 2] = band[sourceOffset + 2] ?? 0;
        rgba[targetOffset + 3] = 255;
        sourceOffset += 3;
        targetOffset += 4;
      }
    },
  });
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const context = surface.getContext("2d");
  if (context === null) throw new Error("2D canvas unavailable");
  context.putImageData(new ImageData(rgba, width, height), 0, 0);
  return surface;
}

function paintScene(input: ScenePreviewInput, state: "preview" | "staged"): void {
  view.applyScenePreview(input, renderScene(input), state);
}

function isToolErrorResult(result: unknown): boolean {
  if (result === null || typeof result !== "object" || Array.isArray(result)) return false;
  const error = (result as Record<string, unknown>)["error"];
  return (
    error !== null &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as Record<string, unknown>)["code"] === "string"
  );
}

const view = mountAgentWall(app, {
  surveyWall: () =>
    adapter.executeTool("survey_wall", { x: 400, y: 400, width: 40, height: 40 }),
  previewParcel: (rect) => {
    const input = {
      ...rect,
      program: DEMO_SCENE_PROGRAM,
    } as ScenePreviewInput;
    const result = adapter.executeTool("preview_parcel", input);
    paintScene(input, "preview");
    return result;
  },
  stageParcel: ({ preset, ...rect }) => {
    const input = {
      ...rect,
      program: sceneProgram(rect, preset),
    } satisfies ScenePreviewInput;
    const result = adapter.executeTool("stage_parcel", input);
    paintScene(input, "staged");
    return result;
  },
  inspectReceipt: (receiptId) =>
    adapter.executeTool("inspect_receipt", { receiptId }),
});

let teardownWebMcp: () => void = () => undefined;
try {
  const registration = await registerWebMcpTools({
    document: document as Document & {
      readonly modelContext?: Parameters<typeof registerWebMcpTools>[0]["document"]["modelContext"];
    },
    adapter,
    onResult(name, input, result) {
      if (isToolErrorResult(result)) return;
      if (name === "survey_wall") view.applySurveyOutput(result);
      if (name === "preview_parcel") view.applyPreviewOutput(result);
      if (name === "stage_parcel") view.applyStageOutput(result);
      if (name === "inspect_receipt") view.applyReceiptOutput(result);
      if (name === "preview_parcel" || name === "stage_parcel") {
        paintScene(
          input as ScenePreviewInput,
          name === "stage_parcel" ? "staged" : "preview",
        );
      }
      if (name === "preview_parcel" || name === "stage_parcel") {
        const rect = input as Partial<ParcelRect>;
        if (
          typeof rect.x === "number" &&
          typeof rect.y === "number" &&
          typeof rect.width === "number" &&
          typeof rect.height === "number"
        ) {
          view.focusParcel(rect as ParcelRect);
        }
      }
    },
  });
  teardownWebMcp = registration.teardown;
  view.applyWebMcpAvailability(registration.registered);
} catch {
  view.applyWebMcpAvailability(false);
}

window.addEventListener(
  "pagehide",
  (event) => {
    if (event.persisted) return;
    teardownWebMcp();
    view.dispose();
  },
);
