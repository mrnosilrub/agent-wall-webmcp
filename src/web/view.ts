/**
 * Agent Wall challenge view — quiet, museum-grade, fixture-safe.
 *
 * mountAgentWall(root, controller) takes over `root` and builds the whole
 * surface in vanilla DOM (no innerHTML anywhere, so tool data can never
 * become markup): a WebMCP availability badge, the standing truth label
 * "Base Sepolia · chain 84532 · fixture / noncanonical", a navigable
 * 1000×1000 wall canvas, one parcel dossier, a receipt panel, and a quiet
 * tool-activity/proof log that keeps the raw JSON of every applied output.
 *
 * ── Controller contract ──────────────────────────────────────────────────
 * The controller is wired by the parent. Each method wraps one WebMCP tool
 * and resolves to plain, structured-clone-able data (typed `unknown` here —
 * the view never trusts its shape):
 *
 *   surveyWall()                     → survey_wall
 *   previewParcel(query)             → preview_parcel
 *   stageParcel(request)             → stage_parcel
 *   inspectReceipt(token)            → inspect_receipt
 *
 * Every method is optional: unwired tools degrade to a quiet log entry and
 * nothing leaves the page. If surveyWall is present it is invoked once on
 * mount.
 *
 * ── Expected output shapes (tolerantly read) ─────────────────────────────
 * survey:    { soldPixels?, totalPixels?, pctSold?,
 *              parcels: Array<{ x, y, width|w, height|h, id? }> }
 *            A bare parcel array is also accepted. Numbers may be strings.
 * preview:   { rect?: { x, y, width, height }, pixels?,
 *              quote?: { priceUsd?, priceCents?, priceMicroUsdc?,
 *                        soldBefore?, soldAfter? }, pricing? }
 * stage:     { token? | receiptToken? | stagedToken? | id?, … }
 * receipt:   { token?, chainId?, network?, fixture?, canonical?,
 *              digest? | hash?, stagedAt?, expiresAt? }
 *
 * Unknown fields are ignored, never invented: the view shows only what an
 * output actually states, plus the standing truth label. Staging lives in
 * memory only — reloading the page clears it — and no reservation, payment
 * or mint is ever performed by this view.
 */

import "./styles.css";

import { GRID_SIZE } from "../domain/pricing.js";
import { TEXELS_PER_PIXEL_AXIS } from "../domain/scene.js";

import { LOCAL_FIXTURE_NOTE, LOCAL_FIXTURE_PARCELS } from "./fixture.js";
import {
  WallCanvas,
  type WallParcel,
  type WallViewInfo,
} from "./wall-canvas.js";

// ── public types ──────────────────────────────────────────────────────────

/** The four WebMCP tools this view is built around. */
export type ToolName =
  | "survey_wall"
  | "preview_parcel"
  | "stage_parcel"
  | "inspect_receipt";

/** Controller results are plain data; the view reads them defensively. */
export type ToolResult = unknown;
export type MaybePromise<T> = T | Promise<T>;

export interface ParcelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ParcelQuery = ParcelRect;

/** Compositional presets the parent maps to Scene-v1 programs. */
export type ScenePresetId = "field" | "frame" | "medallion" | "pediment" | "mosaic";

export interface ScenePresetOption {
  readonly id: ScenePresetId;
  readonly label: string;
  readonly blurb: string;
}

export interface StageRequest extends ParcelRect {
  readonly preset: ScenePresetId;
}

export interface AgentWallController {
  /** Invokes the survey_wall tool. */
  surveyWall?(): MaybePromise<ToolResult>;
  /** Invokes the preview_parcel tool for one rectangle. */
  previewParcel?(query: ParcelQuery): MaybePromise<ToolResult>;
  /** Invokes the stage_parcel tool for one rectangle and Scene preset. */
  stageParcel?(request: StageRequest): MaybePromise<ToolResult>;
  /** Invokes the inspect_receipt tool for a staged receipt reference. */
  inspectReceipt?(token: string): MaybePromise<ToolResult>;
}

export interface AgentWallView {
  /** Parse and hang a survey_wall output; replaces the local stand-in parcels. */
  applySurveyOutput(output: unknown): void;
  /** Parse and show a preview_parcel quote in the dossier. */
  applyPreviewOutput(output: unknown): void;
  /** Parse a stage_parcel output; records the receipt reference, if any. */
  applyStageOutput(output: unknown): void;
  /** Parse and show an inspect_receipt output in the receipt panel. */
  applyReceiptOutput(output: unknown): void;
  /** Paint an already-validated Scene raster into its Wall rectangle. */
  applyScenePreview(
    rect: ParcelRect,
    source: CanvasImageSource,
    state: "preview" | "staged",
  ): void;
  /** true/false or a short status string; anything else reads as unknown. */
  applyWebMcpAvailability(availability: unknown): void;
  /** Load a rectangle into the dossier fields and bring it into view. */
  focusParcel(rect: ParcelRect): void;
  /** Reset the canvas to the full 1000×1000 wall. */
  showFullWall(): void;
  /** Tear down listeners and empty the mount root. */
  dispose(): void;
}

const presetTable: ScenePresetOption[] = [
  { id: "mosaic", label: "Mosaic", blurb: "A measured checker field — one CHECKER." },
  { id: "field", label: "Field", blurb: "Ground colour only — the BG record." },
  { id: "frame", label: "Frame", blurb: "A single hairline border — one RECT." },
  { id: "medallion", label: "Medallion", blurb: "A centred circle — one CIRCLE." },
  { id: "pediment", label: "Pediment", blurb: "A quiet triangular field — one TRI." },
];

/** Frozen preset vocabulary; ids are what stage requests carry. */
export const SCENE_PRESETS: readonly ScenePresetOption[] = Object.freeze(presetTable);

// ── module state ──────────────────────────────────────────────────────────

type LogKind = "output" | "error" | "local";

const MAX_LOG_ENTRIES = 40;
const INT_FMT = new Intl.NumberFormat("en-US");
const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const TRUTH_LABEL = "Base Sepolia · chain 84532 · fixture / noncanonical";
const STAGE_NOTE =
  "Stages in this page only — reloading clears it. No reservation, payment, or mint occurs.";
const WALL_CANVAS_LABEL = `Wall canvas, ${GRID_SIZE} by ${GRID_SIZE} pixels. Arrow keys pan, plus and minus zoom, zero shows the full wall.`;

let mountSequence = 0;

// ── defensive readers ─────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readInteger(value: unknown): number | null {
  const parsed = readNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function readText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function firstNumber(
  sources: readonly (Record<string, unknown> | null)[],
  keys: readonly string[],
): number | null {
  for (const source of sources) {
    if (source === null) continue;
    for (const key of keys) {
      const found = readNumber(source[key]);
      if (found !== null) return found;
    }
  }
  return null;
}

function firstText(
  sources: readonly (Record<string, unknown> | null)[],
  keys: readonly string[],
): string | null {
  for (const source of sources) {
    if (source === null) continue;
    for (const key of keys) {
      const found = readText(source[key]);
      if (found !== null) return found;
    }
  }
  return null;
}

function firstBoolean(
  sources: readonly (Record<string, unknown> | null)[],
  keys: readonly string[],
): boolean | null {
  for (const source of sources) {
    if (source === null) continue;
    for (const key of keys) {
      const found = readBoolean(source[key]);
      if (found !== null) return found;
    }
  }
  return null;
}

function readRectFrom(record: Record<string, unknown>): ParcelRect | null {
  const x = readInteger(record["x"]);
  const y = readInteger(record["y"]);
  const width = readInteger(record["width"] ?? record["w"]);
  const height = readInteger(record["height"] ?? record["h"]);
  if (x === null || y === null || width === null || height === null) return null;
  if (x < 0 || y < 0 || width < 1 || height < 1) return null;
  if (x + width > GRID_SIZE || y + height > GRID_SIZE) return null;
  return { x, y, width, height };
}

function readRect(value: unknown): ParcelRect | null {
  const record = asRecord(value);
  if (record === null) return null;
  const nested = asRecord(record["rect"]) ?? asRecord(record["parcel"]) ?? record;
  return readRectFrom(nested);
}

function readParcels(value: unknown): WallParcel[] {
  let list: readonly unknown[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else {
    const record = asRecord(value);
    const candidates = record?.["parcels"];
    if (Array.isArray(candidates)) list = candidates;
  }
  const found: WallParcel[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    if (record === null) continue;
    const rect = readRectFrom(asRecord(record["rect"]) ?? record);
    if (rect === null) continue;
    const id = readText(record["id"]);
    found.push(id === null ? rect : { ...rect, id });
  }
  return found;
}

// ── small utilities ───────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== "") node.className = className;
  return node;
}

function makeButton(
  label: string,
  className: string,
  onClick: () => void,
  title?: string,
): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.textContent = label;
  if (title !== undefined) button.title = title;
  button.addEventListener("click", () => onClick());
  return button;
}

function fmtInt(value: number): string {
  return INT_FMT.format(value);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

function messageOf(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return safeJson(err);
}

function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(
      value,
      (_key: string, item: unknown) => (typeof item === "bigint" ? item.toString() : item),
      2,
    );
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

// ── mount ─────────────────────────────────────────────────────────────────

export function mountAgentWall(
  root: HTMLElement,
  controller?: AgentWallController | null,
): AgentWallView {
  let disposed = false;
  const inspectReceiptId = "fixture-receipt-0001";
  let parcels: readonly WallParcel[] = LOCAL_FIXTURE_PARCELS;
  let lastRect: ParcelRect | null = null;
  let announceTimer: number | null = null;
  let stageExpiryTimer: number | null = null;
  const busyTools = new Set<ToolName>();

  mountSequence += 1;
  const uid = `agentwall-${mountSequence}`;

  const article = el("div", "agentwall");
  root.replaceChildren(article);

  // ── header: identity, WebMCP badge, standing truth label ───────────────

  const header = el("header", "aw-header");
  const ident = el("div", "aw-ident");
  const title = el("h1", "aw-title");
  title.textContent = "Agent Wall";
  const subtitle = el("p", "aw-subtitle");
  subtitle.textContent =
    "A fixture-safe WebMCP challenge surface — the wall is the work, the chrome stays quiet.";
  ident.append(title, subtitle);

  const chips = el("div", "aw-chips");
  const badge = el("span", "aw-badge");
  badge.dataset.state = "unknown";
  const badgeDot = el("span", "aw-badge__dot");
  const badgeText = el("span", "aw-badge__text");
  badgeText.textContent = "WebMCP · unknown";
  badge.append(badgeDot, badgeText);
  const truthChip = el("span", "aw-chip aw-chip--truth");
  truthChip.textContent = TRUTH_LABEL;
  chips.append(badge, truthChip);
  header.append(ident, chips);

  const standingNote = el("p", "aw-standing-note");
  standingNote.textContent =
    "Deterministic fixture projection — no live chain state, ownership, or artwork records. Flat fixture pricing, $1 per pixel. Staging is local to this page; reloading clears it.";
  article.append(header, standingNote);

  // ── the wall ───────────────────────────────────────────────────────────

  const mainEl = el("div", "aw-main");

  const canvasPanel = el("section", "aw-panel aw-canvas-panel");
  const canvasHead = el("div", "aw-panel__head");
  const canvasHeading = el("div", "aw-panel__heading");
  const canvasTitle = el("h2", "aw-panel__title");
  canvasTitle.textContent = "The wall";
  const occupancy = el("span", "aw-occupancy");
  occupancy.textContent = `${fmtInt(GRID_SIZE)} × ${fmtInt(GRID_SIZE)} px · occupancy pending survey`;
  canvasHeading.append(canvasTitle, occupancy);

  const canvasControls = el("div", "aw-canvas-controls");
  const zoomOutBtn = makeButton("−", "aw-btn aw-btn--square", () => wallCanvas.zoomOut());
  zoomOutBtn.setAttribute("aria-label", "Zoom out");
  const zoomReadout = el("span", "aw-zoom");
  zoomReadout.textContent = "—";
  const zoomInBtn = makeButton("+", "aw-btn aw-btn--square", () => wallCanvas.zoomIn());
  zoomInBtn.setAttribute("aria-label", "Zoom in");
  const fullWallBtn = makeButton("Full wall", "aw-btn", () =>
    wallCanvas.resetView(),
  );
  canvasControls.append(zoomOutBtn, zoomReadout, zoomInBtn, fullWallBtn);
  canvasHead.append(canvasHeading, canvasControls);

  const canvasFrame = el("div", "aw-canvas-frame");
  const canvas = el("canvas", "aw-wall-canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "wall canvas");
  canvas.setAttribute("aria-label", WALL_CANVAS_LABEL);
  canvasFrame.append(canvas);

  const canvasFoot = el("div", "aw-canvas-foot");
  const statusLine = el("p", "aw-canvas-status");
  statusLine.textContent = `view x 0–${fmtInt(GRID_SIZE)} · y 0–${fmtInt(GRID_SIZE)}`;
  const hintLine = el("p", "aw-canvas-hint");
  hintLine.textContent =
    "Drag to pan · scroll or pinch to zoom · click a parcel to load its rectangle · arrow keys pan, + and − zoom, 0 shows the full wall.";
  const sourceNotice = el("p", "aw-canvas-source");
  sourceNotice.textContent = LOCAL_FIXTURE_NOTE;
  canvasFoot.append(statusLine, hintLine, sourceNotice);
  canvasPanel.append(canvasHead, canvasFrame, canvasFoot);
  mainEl.append(canvasPanel);
  article.append(mainEl);

  const wallCanvas = new WallCanvas(canvas, {
    onParcelChosen: (parcel) => {
      loadRectIntoFields(parcel);
      announce(
        `Parcel loaded: x ${parcel.x}, y ${parcel.y}, ${parcel.width} by ${parcel.height}.`,
      );
    },
    onRectChosen: (origin) => {
      xInput.value = String(origin.x);
      yInput.value = String(origin.y);
      syncDerived();
      announce(`Focus origin moved to x ${origin.x}, y ${origin.y}.`);
    },
    onViewChanged: (info: WallViewInfo) => {
      statusLine.textContent = `view x ${fmtInt(info.x0)}–${fmtInt(info.x1)} · y ${fmtInt(
        info.y0,
      )}–${fmtInt(info.y1)} · ${info.zoomPercent}%`;
      zoomReadout.textContent = `${info.zoomPercent}%`;
      canvas.setAttribute(
        "aria-label",
        `${WALL_CANVAS_LABEL} View: x ${info.x0} to ${info.x1}, y ${info.y0} to ${info.y1}, zoom ${info.zoomPercent} percent.`,
      );
    },
  });
  wallCanvas.setParcels(parcels);

  // ── parcel dossier ─────────────────────────────────────────────────────

  const side = el("div", "aw-side");
  const dossier = el("section", "aw-panel");
  const dossierHead = el("div", "aw-panel__head");
  const dossierHeading = el("div", "aw-panel__heading");
  const dossierTitle = el("h2", "aw-panel__title");
  dossierTitle.textContent = "Parcel dossier";
  const stagedChip = el("span", "aw-chip aw-chip--staged");
  stagedChip.textContent = "staged locally · cleared on reload";
  stagedChip.hidden = true;
  dossierHeading.append(dossierTitle, stagedChip);
  dossierHead.append(dossierHeading);

  const dossierBody = el("div", "aw-panel__body");

  function numberField(
    name: string,
    label: string,
    min: number,
    max: number,
    initial: string,
  ): { wrap: HTMLDivElement; input: HTMLInputElement } {
    const input = el("input", "aw-field__input");
    input.id = `${uid}-${name}`;
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = "1";
    input.inputMode = "numeric";
    input.value = initial;
    const labelEl = el("label", "aw-field__label");
    labelEl.htmlFor = input.id;
    labelEl.textContent = label;
    const wrap = el("div", "aw-field");
    wrap.append(labelEl, input);
    input.addEventListener("input", () => syncDerived());
    return { wrap, input };
  }

  const fieldsGrid = el("div", "aw-fields");
  const xField = numberField("x", "x (0–999)", 0, GRID_SIZE - 1, "400");
  const yField = numberField("y", "y (0–999)", 0, GRID_SIZE - 1, "400");
  const widthField = numberField("width", "width (1–1000)", 1, GRID_SIZE, "40");
  const heightField = numberField("height", "height (1–1000)", 1, GRID_SIZE, "40");
  fieldsGrid.append(xField.wrap, yField.wrap, widthField.wrap, heightField.wrap);
  const xInput = xField.input;
  const yInput = yField.input;
  const widthInput = widthField.input;
  const heightInput = heightField.input;

  const errorLine = el("p", "aw-field__error");
  errorLine.setAttribute("aria-live", "polite");
  errorLine.hidden = true;

  const derivedLine = el("p", "aw-derived");
  derivedLine.textContent = "—";
  const focusLine = el("p", "aw-focus-line");

  const presetRow = el("div", "aw-field");
  const presetLabel = el("label", "aw-field__label");
  presetLabel.textContent = "Scene preset";
  const presetSelect = el("select", "aw-select");
  presetSelect.id = `${uid}-preset`;
  presetLabel.htmlFor = presetSelect.id;
  for (const preset of SCENE_PRESETS) {
    const option = el("option");
    option.value = preset.id;
    option.textContent = preset.label;
    presetSelect.append(option);
  }
  presetSelect.value = SCENE_PRESETS[0]!.id;
  presetSelect.addEventListener("change", onPresetChange);
  presetRow.append(presetLabel, presetSelect);
  const presetBlurb = el("p", "aw-preset-blurb");
  presetBlurb.textContent = SCENE_PRESETS[0]!.blurb;

  const pickerRow = el("div", "aw-field");
  const pickerLabel = el("label", "aw-field__label");
  pickerLabel.textContent = "Focus a listed parcel";
  const picker = el("select", "aw-select");
  picker.id = `${uid}-parcel`;
  pickerLabel.htmlFor = picker.id;
  picker.addEventListener("change", onPickerChange);
  pickerRow.append(pickerLabel, picker);

  const quoteBlock = el("div", "aw-quote");
  quoteBlock.hidden = true;
  const quoteTitle = el("h3", "aw-quote__title");
  quoteTitle.textContent = "Quote · preview_parcel";
  const quoteDl = el("dl", "aw-dl");
  quoteBlock.append(quoteTitle, quoteDl);

  const actions = el("div", "aw-actions");
  const previewBtn = makeButton("Run preview_parcel", "aw-btn", onPreviewClicked);
  const stageBtn = makeButton("Run stage_parcel", "aw-btn aw-btn--primary", onStageClicked);
  stageBtn.title = STAGE_NOTE;
  const stageNote = el("p", "aw-stage-note");
  stageNote.textContent = STAGE_NOTE;
  const inspectBtn = makeButton("Run inspect_receipt", "aw-btn", onInspectClicked);
  inspectBtn.disabled = true;
  actions.append(previewBtn, stageBtn, stageNote, inspectBtn);

  const stageReview = el("section", "aw-stage-review");
  stageReview.hidden = true;
  const stageReviewEyebrow = el("p", "aw-stage-review__eyebrow");
  stageReviewEyebrow.textContent = "Local review state";
  const stageReviewTitle = el("h3", "aw-stage-review__title");
  stageReviewTitle.textContent = "EPHEMERAL / NOT PURCHASED";
  const stageReviewDl = el("dl", "aw-dl aw-stage-review__facts");
  const stageReviewBoundary = el("p", "aw-stage-review__boundary");
  stageReviewBoundary.textContent =
    "NO HOLD · NO RESERVATION · NO ORDER · NO SIGNATURE · NO PAYMENT · NO MINT";
  const clearStageBtn = makeButton("Clear local stage", "aw-btn", () => {
    clearLocalStage("cancelled_stage");
  });
  stageReview.append(
    stageReviewEyebrow,
    stageReviewTitle,
    stageReviewDl,
    stageReviewBoundary,
    clearStageBtn,
  );

  dossierBody.append(
    fieldsGrid,
    errorLine,
    derivedLine,
    focusLine,
    presetRow,
    presetBlurb,
    pickerRow,
    quoteBlock,
    actions,
    stageReview,
  );
  dossier.append(dossierHead, dossierBody);

  // ── receipt panel ──────────────────────────────────────────────────────

  const receiptPanel = el("section", "aw-panel");
  const receiptHead = el("div", "aw-panel__head");
  const receiptTitle = el("h2", "aw-panel__title");
  receiptTitle.textContent = "Receipt · inspect_receipt";
  receiptHead.append(receiptTitle);
  const receiptBody = el("div", "aw-panel__body");
  const receiptEmpty = el("p", "aw-empty");
  receiptEmpty.textContent =
    "No receipt inspected yet. Stage locally, then inspect the receipt.";
  const receiptDl = el("dl", "aw-dl");
  receiptDl.hidden = true;
  receiptBody.append(receiptEmpty, receiptDl);
  receiptPanel.append(receiptHead, receiptBody);
  side.append(dossier, receiptPanel);
  mainEl.append(side);

  // ── tool activity / proof panel ────────────────────────────────────────

  const activity = el("section", "aw-panel aw-activity");
  const activityHead = el("div", "aw-panel__head");
  const activityHeading = el("div", "aw-panel__heading");
  const activityTitle = el("h2", "aw-panel__title");
  activityTitle.textContent = "WebMCP tool activity";
  const busyIndicator = el("span", "aw-busy");
  busyIndicator.dataset.busy = "false";
  busyIndicator.textContent = "working…";
  busyIndicator.setAttribute("aria-hidden", "true");
  activityHeading.append(activityTitle, busyIndicator);
  const resurveyBtn = makeButton("Run survey_wall", "aw-btn", onResurveyClicked);
  activityHead.append(activityHeading, resurveyBtn);
  const logEl = el("ol", "aw-log");
  activity.append(activityHead, logEl);
  article.append(activity);

  const liveRegion = el("div", "aw-live");
  liveRegion.setAttribute("role", "status");
  article.append(liveRegion);

  // ── field state ────────────────────────────────────────────────────────

  function readFields(): { rect: ParcelRect | null; problem: string | null } {
    const x = readInteger(xInput.value);
    const y = readInteger(yInput.value);
    const width = readInteger(widthInput.value);
    const height = readInteger(heightInput.value);
    if (x === null || x < 0 || x > GRID_SIZE - 1) {
      return { rect: null, problem: `x must be an integer from 0 to ${GRID_SIZE - 1}.` };
    }
    if (y === null || y < 0 || y > GRID_SIZE - 1) {
      return { rect: null, problem: `y must be an integer from 0 to ${GRID_SIZE - 1}.` };
    }
    if (width === null || width < 1 || width > GRID_SIZE) {
      return { rect: null, problem: `width must be an integer from 1 to ${GRID_SIZE}.` };
    }
    if (height === null || height < 1 || height > GRID_SIZE) {
      return { rect: null, problem: `height must be an integer from 1 to ${GRID_SIZE}.` };
    }
    if (x + width > GRID_SIZE) {
      return { rect: null, problem: `x + width must not exceed ${GRID_SIZE}.` };
    }
    if (y + height > GRID_SIZE) {
      return { rect: null, problem: `y + height must not exceed ${GRID_SIZE}.` };
    }
    return { rect: { x, y, width, height }, problem: null };
  }

  function indexOfParcel(rect: ParcelRect): number {
    return parcels.findIndex(
      (parcel) =>
        parcel.x === rect.x &&
        parcel.y === rect.y &&
        parcel.width === rect.width &&
        parcel.height === rect.height,
    );
  }

  function syncDerived(): void {
    const check = readFields();
    lastRect = check.rect;
    if (check.rect === null) {
      errorLine.textContent = check.problem ?? "Enter a rectangle inside the wall.";
      errorLine.hidden = false;
      derivedLine.textContent = "—";
      focusLine.textContent = "";
      wallCanvas.setFocusRect(null);
    } else {
      errorLine.hidden = true;
      errorLine.textContent = "";
      const { width, height } = check.rect;
      derivedLine.textContent = `${width} × ${height} px · ${fmtInt(
        width * height,
      )} px · scene ${fmtInt(width * TEXELS_PER_PIXEL_AXIS)} × ${fmtInt(
        height * TEXELS_PER_PIXEL_AXIS,
      )} texels`;
      const listed = indexOfParcel(check.rect);
      if (listed === -1) {
        focusLine.textContent = "Manual rectangle — not a listed parcel.";
      } else {
        const parcel = parcels[listed]!;
        focusLine.textContent = `Listed parcel #${listed + 1}${
          parcel.id === undefined ? "" : ` · ${parcel.id}`
        }`;
      }
      wallCanvas.setFocusRect(check.rect);
      picker.value = listed === -1 ? "" : String(listed);
    }
    refreshButtons();
  }

  function loadRectIntoFields(rect: ParcelRect): void {
    xInput.value = String(rect.x);
    yInput.value = String(rect.y);
    widthInput.value = String(rect.width);
    heightInput.value = String(rect.height);
    syncDerived();
  }

  function clampRect(rect: ParcelRect): ParcelRect | null {
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      return null;
    }
    const x = Math.min(Math.max(Math.round(rect.x), 0), GRID_SIZE - 1);
    const y = Math.min(Math.max(Math.round(rect.y), 0), GRID_SIZE - 1);
    const width = Math.min(Math.max(Math.round(rect.width), 1), GRID_SIZE - x);
    const height = Math.min(Math.max(Math.round(rect.height), 1), GRID_SIZE - y);
    return { x, y, width, height };
  }

  function rebuildPicker(): void {
    picker.replaceChildren();
    const placeholder = el("option");
    placeholder.value = "";
    placeholder.textContent = "— choose a parcel —";
    picker.append(placeholder);
    for (let i = 0; i < parcels.length; i += 1) {
      const parcel = parcels[i]!;
      const option = el("option");
      option.value = String(i);
      option.textContent = `#${i + 1} · x ${parcel.x} · y ${parcel.y} · ${parcel.width} × ${parcel.height}`;
      picker.append(option);
    }
  }

  function selectedPreset(): ScenePresetId {
    const found = SCENE_PRESETS.find((preset) => preset.id === presetSelect.value);
    return found === undefined ? SCENE_PRESETS[0]!.id : found.id;
  }

  function onPresetChange(): void {
    const found = SCENE_PRESETS.find((preset) => preset.id === presetSelect.value);
    presetBlurb.textContent = found === undefined ? "" : found.blurb;
  }

  function onPickerChange(): void {
    const index = Number(picker.value);
    if (!Number.isInteger(index) || index < 0 || index >= parcels.length) return;
    const parcel = parcels[index]!;
    loadRectIntoFields(parcel);
    wallCanvas.ensureVisible(parcel);
    announce(
      `Parcel ${index + 1}: x ${parcel.x}, y ${parcel.y}, ${parcel.width} by ${parcel.height}.`,
    );
  }

  // ── controller invokers ────────────────────────────────────────────────

  function surveyInvoker(): (() => MaybePromise<ToolResult>) | null {
    if (controller === null || controller === undefined) return null;
    const method = controller.surveyWall;
    return typeof method === "function" ? () => method.call(controller) : null;
  }

  function previewInvoker(query: ParcelQuery): (() => MaybePromise<ToolResult>) | null {
    if (controller === null || controller === undefined) return null;
    const method = controller.previewParcel;
    return typeof method === "function" ? () => method.call(controller, query) : null;
  }

  function stageInvoker(request: StageRequest): (() => MaybePromise<ToolResult>) | null {
    if (controller === null || controller === undefined) return null;
    const method = controller.stageParcel;
    return typeof method === "function" ? () => method.call(controller, request) : null;
  }

  function inspectInvoker(token: string): (() => MaybePromise<ToolResult>) | null {
    if (controller === null || controller === undefined) return null;
    const method = controller.inspectReceipt;
    return typeof method === "function" ? () => method.call(controller, token) : null;
  }

  // ── tool runs, busy state, activity log ────────────────────────────────

  function setBusy(tool: ToolName, isBusy: boolean): void {
    if (isBusy) {
      busyTools.add(tool);
    } else {
      busyTools.delete(tool);
    }
    busyIndicator.dataset.busy = busyTools.size > 0 ? "true" : "false";
    refreshButtons();
  }

  function refreshButtons(): void {
    const ready = lastRect !== null;
    previewBtn.disabled = !ready || busyTools.has("preview_parcel");
    stageBtn.disabled = !ready || busyTools.has("stage_parcel");
    inspectBtn.disabled = busyTools.has("inspect_receipt");
    resurveyBtn.disabled = busyTools.has("survey_wall");
  }

  async function runTool(
    tool: ToolName,
    invoke: (() => MaybePromise<ToolResult>) | null,
    apply: (output: unknown) => void,
  ): Promise<void> {
    if (disposed) return;
    if (invoke === null) {
      logEntry(tool, "local", `${tool} is not wired — nothing left this page`);
      announce(`${tool} is not wired.`);
      return;
    }
    setBusy(tool, true);
    try {
      const output = await invoke();
      if (disposed) return;
      apply(output);
    } catch (err) {
      if (!disposed) {
        logEntry(tool, "error", `${tool} failed: ${messageOf(err)}`);
        announce(`${tool} failed.`);
      }
    } finally {
      setBusy(tool, false);
    }
  }

  function logEntry(tool: ToolName, kind: LogKind, summary: string, raw?: unknown): void {
    const entry = el("li", "aw-log__entry");
    entry.dataset.tool = tool;
    entry.dataset.kind = kind;
    const head = el("div", "aw-log__head");
    const toolTag = el("span", "aw-log__tool");
    toolTag.textContent = tool;
    const kindTag = el("span", "aw-log__kind");
    kindTag.textContent = kind;
    const stamp = el("time", "aw-log__time");
    const now = new Date();
    stamp.dateTime = now.toISOString();
    stamp.textContent = formatTime(now);
    head.append(toolTag, kindTag, stamp);
    const summaryLine = el("p", "aw-log__summary");
    summaryLine.textContent = summary;
    entry.append(head, summaryLine);
    if (raw !== undefined) {
      const details = el("details", "aw-log__raw");
      const summaryLabel = el("summary");
      summaryLabel.textContent = "raw output";
      const pre = el("pre", "aw-log__pre");
      pre.textContent = safeJson(raw);
      details.append(summaryLabel, pre);
      entry.append(details);
    }
    logEl.prepend(entry);
    while (logEl.children.length > MAX_LOG_ENTRIES) {
      logEl.lastElementChild?.remove();
    }
  }

  function announce(message: string): void {
    if (disposed) return;
    liveRegion.textContent = "";
    if (announceTimer !== null) window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      announceTimer = null;
      if (!disposed) liveRegion.textContent = message;
    }, 40);
  }

  // ── button handlers ────────────────────────────────────────────────────

  function onPreviewClicked(): void {
    const rect = lastRect;
    if (rect === null) return;
    void runTool("preview_parcel", previewInvoker(rect), applyPreviewOutput);
  }

  function onStageClicked(): void {
    const rect = lastRect;
    if (rect === null) return;
    void runTool(
      "stage_parcel",
      stageInvoker({ ...rect, preset: selectedPreset() }),
      applyStageOutput,
    );
  }

  function onInspectClicked(): void {
    void runTool(
      "inspect_receipt",
      inspectInvoker(inspectReceiptId),
      applyReceiptOutput,
    );
  }

  function onResurveyClicked(): void {
    void runTool("survey_wall", surveyInvoker(), applySurveyOutput);
  }

  // ── shared rendering ───────────────────────────────────────────────────

  function renderRows(
    list: HTMLDListElement,
    rows: readonly (readonly [string, string])[],
  ): void {
    list.replaceChildren();
    if (rows.length === 0) {
      const empty = el("div", "aw-empty");
      empty.textContent = "No recognized fields — see the raw record under Tool activity.";
      list.append(empty);
      return;
    }
    for (const [label, value] of rows) {
      const row = el("div", "aw-dl__row");
      const term = el("dt");
      term.textContent = label;
      const detail = el("dd");
      detail.textContent = value;
      row.append(term, detail);
      list.append(row);
    }
  }

  // ── apply methods (also the parent's push API) ─────────────────────────

  function applySurveyOutput(output: unknown): void {
    if (disposed) return;
    const record = asRecord(output);
    const wall = asRecord(record?.["wall"]);
    const found = readParcels(output);
    const sold = firstNumber([record, wall], ["soldPixels", "occupiedPixels", "sold"]);
    const total = firstNumber([record, wall], ["totalPixels", "total"]);
    const pct = firstNumber([record], ["pctSold", "percentSold"]);
    if (found.length > 0) {
      parcels = found;
      wallCanvas.setParcels(found);
      rebuildPicker();
      sourceNotice.hidden = true;
    }
    if (sold !== null || total !== null || pct !== null) {
      const totalText = fmtInt(total ?? GRID_SIZE * GRID_SIZE);
      const parts: string[] = [];
      if (sold !== null) parts.push(`${fmtInt(sold)} / ${totalText} px sold`);
      else parts.push(`${totalText} px total`);
      if (pct !== null) parts.push(`${pct}%`);
      parts.push("fixture");
      occupancy.textContent = parts.join(" · ");
    }
    const summaryParts: string[] = [
      found.length > 0 ? `${found.length} parcels` : "no parcels recognized",
    ];
    if (sold !== null) summaryParts.push(`${fmtInt(sold)} px sold`);
    if (pct !== null) summaryParts.push(`${pct}%`);
    if (found.length === 0) summaryParts.push("kept local stand-in");
    logEntry("survey_wall", "output", summaryParts.join(" · "), output);
    if (found.length > 0) {
      syncDerived();
      announce(`Survey applied: ${found.length} parcels.`);
    }
  }

  function applyPreviewOutput(output: unknown): void {
    if (disposed) return;
    const record = asRecord(output);
    const quote = asRecord(record?.["quote"]);
    const rect = readRect(output);
    const pixels =
      firstNumber([record, quote], ["pixels", "pixelCount"]) ??
      (rect === null ? null : rect.width * rect.height);
    const usd = firstNumber([quote, record], ["priceUsdc", "priceUsd", "usd"]);
    const cents = firstNumber([quote, record], ["priceCents", "cents"]);
    const micro = firstNumber([quote, record], ["priceMicroUsdc", "microUsdc"]);
    const soldBefore = firstNumber([quote, record], ["soldBefore"]);
    const soldAfter = firstNumber([quote, record], ["soldAfter"]);
    const pricing = firstText([record, quote], ["pricing", "pricingModel"]);
    const rows: Array<readonly [string, string]> = [];
    if (rect !== null) {
      rows.push(["Rectangle", `${rect.x}, ${rect.y} · ${rect.width} × ${rect.height}`]);
    }
    if (pixels !== null) rows.push(["Pixels", `${fmtInt(pixels)} px`]);
    if (usd !== null) rows.push(["Price", USD_FMT.format(usd)]);
    if (cents !== null) rows.push(["Cents", `${fmtInt(cents)} ¢`]);
    if (micro !== null) rows.push(["Micro-USDC", `${fmtInt(micro)} µUSDC`]);
    if (soldBefore !== null && soldAfter !== null) {
      rows.push(["Sold", `${fmtInt(soldBefore)} → ${fmtInt(soldAfter)} px`]);
    }
    if (pricing !== null) rows.push(["Pricing", pricing]);
    renderRows(quoteDl, rows);
    quoteBlock.hidden = false;
    const summary = rows
      .filter(([label]) => label === "Pixels" || label === "Price")
      .map(([, value]) => value)
      .join(" · ");
    logEntry(
      "preview_parcel",
      "output",
      summary === "" ? "output not recognized" : summary,
      output,
    );
    announce(
      `Quote: ${pixels === null ? "unknown size" : `${fmtInt(pixels)} pixels`}${
        usd === null ? "" : `, ${USD_FMT.format(usd)}`
      }.`,
    );
  }

  function clearLocalStage(reason: "cancelled_stage" | "expired_stage"): void {
    if (stageExpiryTimer !== null) {
      window.clearTimeout(stageExpiryTimer);
      stageExpiryTimer = null;
    }
    stagedChip.hidden = true;
    stagedChip.textContent = "staged locally · cleared on reload";
    stageReview.hidden = true;
    delete stageReview.dataset.candidateSha256;
    renderRows(stageReviewDl, []);
    wallCanvas.clearScenePreview();
    refreshButtons();
    logEntry("stage_parcel", "output", `${reason} · local presentation cleared`, {
      code: reason,
    });
    announce(reason === "expired_stage" ? "Local stage expired and was cleared." : "Local stage cleared.");
  }

  function applyStageOutput(output: unknown): void {
    if (disposed) return;
    const record = asRecord(output);
    const stage = asRecord(record?.["stage"]);
    const scene = asRecord(record?.["scene"]);
    const rect = readRect(output);
    const stageState = firstText([stage], ["state"]);
    const presentation = firstText([stage], ["presentation"]);
    const expiresAtMs = firstNumber([stage], ["expiresAtMs"]);
    const candidateDigest = firstText([record], ["candidateSha256"]);
    const programDigest = firstText([scene], ["programSha256"]);
    const sceneDigest = firstText([scene], ["rgbSha256"]);
    const chainId = firstText([record], ["chainId"]);
    const testnet = firstBoolean([record], ["testnet"]);
    const pixels = firstNumber([record], ["pixels"]);
    const priceUsdc = firstNumber([record], ["priceUsdc"]);
    const valid =
      stageState === "staged" &&
      presentation === "EPHEMERAL / NOT PURCHASED" &&
      stage?.["ephemeral"] === true &&
      expiresAtMs !== null &&
      expiresAtMs > Date.now() &&
      candidateDigest !== null &&
      /^[0-9a-f]{64}$/.test(candidateDigest) &&
      programDigest !== null &&
      sceneDigest !== null &&
      chainId === "84532" &&
      testnet === true &&
      rect !== null &&
      pixels !== null &&
      priceUsdc !== null;
    if (!valid) {
      stagedChip.hidden = true;
      stageReview.hidden = true;
      refreshButtons();
      logEntry("stage_parcel", "error", "stage review rejected incomplete bound facts", output);
      announce("Stage output was incomplete and was not presented.");
      return;
    }

    stagedChip.textContent =
      `staged locally · expires ${new Date(expiresAtMs).toISOString().slice(11, 19)} UTC`;
    stagedChip.hidden = false;
    stageReview.dataset.candidateSha256 = candidateDigest;
    renderRows(stageReviewDl, [
      ["Network", "Base Sepolia · chain 84532 · TESTNET"],
      ["Parcel", `${rect.x}, ${rect.y} · ${rect.width} × ${rect.height} · ${fmtInt(pixels)} Pixels`],
      ["Fixture quote", `${fmtInt(priceUsdc)} USDC`],
      ["Candidate digest", candidateDigest],
      ["Program digest", programDigest],
      ["Scene digest", sceneDigest],
      ["Expires", new Date(expiresAtMs).toISOString()],
    ]);
    stageReview.hidden = false;
    if (stageExpiryTimer !== null) window.clearTimeout(stageExpiryTimer);
    stageExpiryTimer = window.setTimeout(
      () => clearLocalStage("expired_stage"),
      Math.max(0, expiresAtMs - Date.now()),
    );
    refreshButtons();
    logEntry("stage_parcel", "output", `${stageState} locally · ${presentation}`, output);
    announce("Staged locally for review. No purchase or financial action occurred.");
  }

  function applyReceiptOutput(output: unknown): void {
    if (disposed) return;
    const record = asRecord(output);
    const receipt = asRecord(record?.["receipt"]);
    const parcel = asRecord(receipt?.["parcel"]);
    const scene = asRecord(receipt?.["scene"]);
    const rows: Array<readonly [string, string]> = [];
    const token = firstText([receipt, record], ["receiptId", "token", "receiptToken", "id"]);
    if (token !== null) rows.push(["Reference", token]);
    const chainId = firstNumber([record], ["chainId"]);
    if (chainId !== null) {
      rows.push([
        "Chain ID",
        `${String(chainId)}${chainId === 84532 ? " · Base Sepolia" : ""}`,
      ]);
    }
    const network = firstText([record], ["chain", "network", "chainName", "networkName"]);
    if (network !== null) rows.push(["Network", network]);
    const fixture =
      record?.["mode"] === "fixture" ? true : firstBoolean([record], ["fixture", "isFixture"]);
    if (fixture !== null) rows.push(["Fixture", fixture ? "yes" : "no"]);
    const canonical = firstBoolean([record], ["canonical", "isCanonical"]);
    if (canonical !== null) rows.push(["Canonical", canonical ? "yes" : "no"]);
    const digest = firstText(
      [receipt, scene, record],
      ["receiptDigest", "programSha256", "digest", "hash", "sha256"],
    );
    if (digest !== null) rows.push(["Digest", digest]);
    const stagedAt = firstText([record], ["stagedAt", "timestamp"]);
    if (stagedAt !== null) rows.push(["Staged", stagedAt]);
    const expires = firstText([record], ["expiresAt", "expiry"]);
    if (expires !== null) rows.push(["Expires", expires]);
    const receiptRect = parcel === null ? null : readRectFrom(parcel);
    if (receiptRect !== null) {
      rows.push([
        "Parcel",
        `${receiptRect.x}, ${receiptRect.y} · ${receiptRect.width} × ${receiptRect.height}`,
      ]);
    }
    renderRows(receiptDl, rows);
    receiptEmpty.hidden = true;
    receiptDl.hidden = false;
    const summaryParts: string[] = [];
    if (chainId !== null) summaryParts.push(`chain ${fmtInt(chainId)}`);
    if (network !== null) summaryParts.push(network);
    if (fixture !== null) summaryParts.push(fixture ? "fixture" : "not fixture");
    logEntry(
      "inspect_receipt",
      "output",
      summaryParts.length > 0 ? summaryParts.join(" · ") : "receipt applied",
      output,
    );
    announce("Receipt applied.");
  }

  function applyWebMcpAvailability(availability: unknown): void {
    if (disposed) return;
    let state: "available" | "unavailable" | "unknown" = "unknown";
    let note: string | null = null;
    if (availability === true) {
      state = "available";
    } else if (availability === false) {
      state = "unavailable";
    } else if (typeof availability === "string" && availability.trim() !== "") {
      const text = availability.trim();
      const lower = text.toLowerCase();
      if (
        lower.includes("unavail") ||
        lower.includes("absent") ||
        lower.includes("disabled") ||
        lower.includes("missing") ||
        lower.includes("not ")
      ) {
        state = "unavailable";
      } else if (
        lower.includes("avail") ||
        lower.includes("connect") ||
        lower.includes("ready") ||
        lower.includes("ok") ||
        lower.includes("true")
      ) {
        state = "available";
      } else {
        note = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      }
    }
    badge.dataset.state = state;
    badgeText.textContent =
      state === "available"
        ? "WebMCP · connected"
        : state === "unavailable"
          ? "WebMCP · not available"
          : "WebMCP · unknown";
    if (note === null) {
      badge.removeAttribute("title");
    } else {
      badge.title = note;
    }
    announce(
      `WebMCP ${
        state === "available" ? "available" : state === "unavailable" ? "not available" : "unknown"
      }.`,
    );
  }

  // ── initial state ──────────────────────────────────────────────────────

  rebuildPicker();
  syncDerived();
  const initialSurvey = surveyInvoker();
  if (initialSurvey !== null) {
    void runTool("survey_wall", initialSurvey, applySurveyOutput);
  }

  return {
    applySurveyOutput,
    applyPreviewOutput,
    applyStageOutput,
    applyReceiptOutput,
    applyWebMcpAvailability,
    applyScenePreview(
      rect: ParcelRect,
      source: CanvasImageSource,
      state: "preview" | "staged",
    ): void {
      if (disposed) return;
      const clamped = clampRect(rect);
      if (clamped === null) return;
      wallCanvas.setScenePreview(clamped, source, state);
    },
    focusParcel(rect: ParcelRect): void {
      if (disposed) return;
      const clamped = clampRect(rect);
      if (clamped === null) return;
      loadRectIntoFields(clamped);
      wallCanvas.focus(clamped);
      announce(
        `Focused x ${clamped.x}, y ${clamped.y}, ${clamped.width} by ${clamped.height}.`,
      );
    },
    showFullWall(): void {
      if (disposed) return;
      wallCanvas.resetView();
      announce("Full wall view.");
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      wallCanvas.dispose();
      if (announceTimer !== null) window.clearTimeout(announceTimer);
      if (stageExpiryTimer !== null) window.clearTimeout(stageExpiryTimer);
      root.replaceChildren();
    },
  };
}
