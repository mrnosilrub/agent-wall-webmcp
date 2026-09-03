/**
 * Navigable projection of the 1000×1000 wall onto one Canvas 2D element.
 *
 * No DOM grid, no animation loop, no network: drawing happens on demand —
 * pan, zoom, resize, data change — coalesced through requestAnimationFrame
 * when available. Parcel fills are a pure function of geometry, so the same
 * fixture data always paints the same wall. Theme colours are read from the
 * --wall-* custom properties once at construction (with bundled fallbacks),
 * so the canvas and src/web/styles.css stay in step without duplicating
 * tokens in two places as literals.
 *
 * Pointer model: a press that moves fewer than CLICK_SLOP_PX is a click
 * (parcel selection, or moving the focus origin); anything further is a pan.
 * Two pointers pinch-zoom. The wheel zooms around the cursor. Keyboard: arrows
 * pan, +/− zoom, 0/Home refits the full wall.
 */

import { GRID_SIZE } from "../domain/pricing.js";

export interface WallParcel {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly id?: string;
}

export interface FocusRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WallViewInfo {
  readonly zoomPercent: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface WallCanvasOptions {
  readonly onParcelChosen?: (parcel: WallParcel) => void;
  readonly onRectChosen?: (origin: { readonly x: number; readonly y: number }) => void;
  readonly onViewChanged?: (info: WallViewInfo) => void;
}

interface CanvasTheme {
  readonly mat: string;
  readonly ground: string;
  readonly grid: string;
  readonly stroke: string;
  readonly focus: string;
  readonly hover: string;
  readonly label: string;
  readonly tones: readonly string[];
}

interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

interface ScenePreview {
  readonly rect: FocusRect;
  readonly source: CanvasImageSource;
  readonly state: "preview" | "staged";
}

const MAX_SCALE = 64;
const FIT_MARGIN_PX = 24;
const PAN_MARGIN_PX = 96;
const CLICK_SLOP_PX = 5;
const MAJOR_GRID_PX = 100;
const MINOR_GRID_PX = 10;
const LABEL_MIN_SCALE = 6;

const FALLBACK_TONES: readonly string[] = Object.freeze([
  "#d8cdb4",
  "#cec2a4",
  "#c2b493",
  "#d3c8b1",
  "#c6ba9d",
  "#b9aa88",
]);

const FALLBACK_THEME: CanvasTheme = Object.freeze({
  mat: "#f1eee6",
  ground: "#eae4d3",
  grid: "#dbd3bd",
  stroke: "#7e7458",
  focus: "#7c2d2d",
  hover: "#3f3a2d",
  label: "#57503f",
  tones: FALLBACK_TONES,
});

function readTheme(canvas: HTMLCanvasElement): CanvasTheme {
  const style = getComputedStyle(canvas);
  const token = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  return {
    mat: token("--wall-mat", FALLBACK_THEME.mat),
    ground: token("--wall-ground", FALLBACK_THEME.ground),
    grid: token("--wall-grid", FALLBACK_THEME.grid),
    stroke: token("--wall-stroke", FALLBACK_THEME.stroke),
    focus: token("--wall-focus", FALLBACK_THEME.focus),
    hover: token("--wall-hover", FALLBACK_THEME.hover),
    label: token("--wall-label", FALLBACK_THEME.label),
    tones: FALLBACK_TONES.map((fallback, index) =>
      token(`--wall-tone-${index}`, fallback),
    ),
  };
}

/** FNV-style mix over geometry: identical rectangles always share a tone. */
function parcelToneIndex(parcel: FocusRect, toneCount: number): number {
  let hash = 0x811c9dc5;
  for (const axis of [parcel.x, parcel.y, parcel.width, parcel.height]) {
    hash ^= axis;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % toneCount;
}

function clampRange(value: number, lo: number, hi: number, fallback: number): number {
  if (lo > hi) return fallback;
  return Math.min(Math.max(value, lo), hi);
}

export class WallCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly options: WallCanvasOptions;
  private readonly theme: CanvasTheme;
  private readonly abort = new AbortController();
  private readonly resizeObserver: ResizeObserver | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private parcels: readonly WallParcel[] = [];
  private focusRect: FocusRect | null = null;
  private scenePreview: ScenePreview | null = null;
  private hoverParcel: WallParcel | null = null;
  private view: ViewTransform = { scale: 1, tx: 0, ty: 0 };
  private cssWidth = 0;
  private cssHeight = 0;
  private devicePixelRatio = 1;
  private framePending = false;
  private pendingFit = true;
  private disposed = false;
  private dragOrigin: {
    px: number;
    py: number;
    tx: number;
    ty: number;
    moved: boolean;
  } | null = null;
  private pinchOrigin: {
    dist: number;
    scale: number;
    cx: number;
    cy: number;
    tx: number;
    ty: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, options: WallCanvasOptions = {}) {
    this.canvas = canvas;
    this.options = options;
    this.ctx = canvas.getContext("2d");
    this.theme = readTheme(canvas);
    this.attachListeners();
    this.syncSize();
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.syncSize());
      this.resizeObserver.observe(canvas);
    }
  }

  // ── public surface ──────────────────────────────────────────────────────

  setParcels(parcels: readonly WallParcel[]): void {
    this.parcels = parcels;
    this.hoverParcel = null;
    this.scheduleDraw();
  }

  setFocusRect(rect: FocusRect | null): void {
    if (
      this.scenePreview !== null &&
      (rect === null ||
        rect.x !== this.scenePreview.rect.x ||
        rect.y !== this.scenePreview.rect.y ||
        rect.width !== this.scenePreview.rect.width ||
        rect.height !== this.scenePreview.rect.height)
    ) {
      this.scenePreview = null;
      delete this.canvas.dataset.scenePreviewState;
      delete this.canvas.dataset.scenePreviewSize;
    }
    this.focusRect = rect;
    this.scheduleDraw();
  }

  setScenePreview(
    rect: FocusRect,
    source: CanvasImageSource,
    state: "preview" | "staged",
  ): void {
    this.scenePreview = { rect: { ...rect }, source, state };
    this.canvas.dataset.scenePreviewState = state;
    const dimensions = source as { readonly width?: unknown; readonly height?: unknown };
    this.canvas.dataset.scenePreviewSize = `${String(dimensions.width)}x${String(
      dimensions.height,
    )}`;
    this.focusRect = { ...rect };
    this.scheduleDraw();
  }

  clearScenePreview(): void {
    this.scenePreview = null;
    delete this.canvas.dataset.scenePreviewState;
    delete this.canvas.dataset.scenePreviewSize;
    this.scheduleDraw();
  }

  resetView(): void {
    this.fitView();
    this.clampView();
    this.scheduleDraw();
  }

  zoomIn(): void {
    this.zoomAt(this.cssWidth / 2, this.cssHeight / 2, 1.5);
  }

  zoomOut(): void {
    this.zoomAt(this.cssWidth / 2, this.cssHeight / 2, 1 / 1.5);
  }

  ensureVisible(rect: FocusRect): void {
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
    const { scale, tx, ty } = this.view;
    const margin = 32 / scale;
    const x0 = (0 - tx) / scale;
    const x1 = (this.cssWidth - tx) / scale;
    const y0 = (0 - ty) / scale;
    const y1 = (this.cssHeight - ty) / scale;
    const inside =
      rect.x >= x0 + margin &&
      rect.x + rect.width <= x1 - margin &&
      rect.y >= y0 + margin &&
      rect.y + rect.height <= y1 - margin;
    if (inside) return;
    this.view.tx = this.cssWidth / 2 - (rect.x + rect.width / 2) * scale;
    this.view.ty = this.cssHeight / 2 - (rect.y + rect.height / 2) * scale;
    this.clampView();
    this.scheduleDraw();
  }

  focus(rect: FocusRect): void {
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
    const paddedWidth = Math.max(rect.width * 1.8, 12);
    const paddedHeight = Math.max(rect.height * 1.8, 12);
    this.view.scale = Math.min(
      Math.max(
        Math.min(this.cssWidth / paddedWidth, this.cssHeight / paddedHeight),
        this.fitScale(),
      ),
      MAX_SCALE,
    );
    this.view.tx = this.cssWidth / 2 - (rect.x + rect.width / 2) * this.view.scale;
    this.view.ty = this.cssHeight / 2 - (rect.y + rect.height / 2) * this.view.scale;
    this.clampView();
    this.scheduleDraw();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.resizeObserver?.disconnect();
  }

  // ── listeners ───────────────────────────────────────────────────────────

  private attachListeners(): void {
    const signal = this.abort.signal;
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { signal });
    this.canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    this.canvas.addEventListener("pointerup", this.onPointerUp, { signal });
    this.canvas.addEventListener("pointercancel", this.onPointerCancel, { signal });
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false, signal });
    this.canvas.addEventListener("keydown", this.onKeydown, { signal });
    this.canvas.addEventListener("blur", this.onBlur, { signal });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.disposed) return;
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    this.hoverParcel = null;
    if (this.pointers.size === 1) {
      this.dragOrigin = {
        px: event.offsetX,
        py: event.offsetY,
        tx: this.view.tx,
        ty: this.view.ty,
        moved: false,
      };
      this.pinchOrigin = null;
    } else if (this.pointers.size === 2) {
      this.dragOrigin = null;
      this.pinchOrigin = this.readPinch();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.disposed) return;
    if (!this.pointers.has(event.pointerId)) {
      this.updateHover(event.offsetX, event.offsetY);
      return;
    }
    this.pointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
    if (this.pinchOrigin !== null && this.pointers.size >= 2) {
      const points = [...this.pointers.values()];
      const a = points[0]!;
      const b = points[1]!;
      const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const origin = this.pinchOrigin;
      const scale = origin.scale * (dist / origin.dist);
      const wx = (origin.cx - origin.tx) / origin.scale;
      const wy = (origin.cy - origin.ty) / origin.scale;
      this.view.scale = scale;
      this.view.tx = cx - wx * scale;
      this.view.ty = cy - wy * scale;
      this.clampView();
      this.scheduleDraw();
      return;
    }
    if (this.dragOrigin !== null) {
      const dx = event.offsetX - this.dragOrigin.px;
      const dy = event.offsetY - this.dragOrigin.py;
      if (!this.dragOrigin.moved && Math.hypot(dx, dy) > CLICK_SLOP_PX) {
        this.dragOrigin.moved = true;
        this.setCanvasCursor("grabbing");
      }
      if (this.dragOrigin.moved) {
        this.view.tx = this.dragOrigin.tx + dx;
        this.view.ty = this.dragOrigin.ty + dy;
        this.clampView();
        this.scheduleDraw();
      }
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.disposed) return;
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer id may already be released; nothing to do.
    }
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchOrigin = null;
    if (this.pointers.size === 0 && this.dragOrigin !== null) {
      const drag = this.dragOrigin;
      this.dragOrigin = null;
      if (!drag.moved) this.activateAt(event.offsetX, event.offsetY);
      this.setCanvasCursor("grab");
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchOrigin = null;
    if (this.pointers.size === 0) {
      this.dragOrigin = null;
      this.setCanvasCursor("grab");
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.disposed) return;
    event.preventDefault();
    this.zoomAt(event.offsetX, event.offsetY, Math.exp(-event.deltaY * 0.0012));
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (this.disposed || event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? 200 : 60;
    switch (event.key) {
      case "ArrowLeft":
        this.panBy(step, 0);
        break;
      case "ArrowRight":
        this.panBy(-step, 0);
        break;
      case "ArrowUp":
        this.panBy(0, step);
        break;
      case "ArrowDown":
        this.panBy(0, -step);
        break;
      case "+":
      case "=":
        this.zoomIn();
        break;
      case "-":
      case "_":
        this.zoomOut();
        break;
      case "0":
      case "Home":
        this.resetView();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.pointers.clear();
    this.dragOrigin = null;
    this.pinchOrigin = null;
  };

  // ── interaction internals ───────────────────────────────────────────────

  private readPinch(): {
    dist: number;
    scale: number;
    cx: number;
    cy: number;
    tx: number;
    ty: number;
  } {
    const points = [...this.pointers.values()];
    const a = points[0]!;
    const b = points[1]!;
    return {
      dist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      scale: this.view.scale,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      tx: this.view.tx,
      ty: this.view.ty,
    };
  }

  private updateHover(px: number, py: number): void {
    const parcel = this.hitTest(px, py);
    if (parcel === this.hoverParcel) return;
    this.hoverParcel = parcel;
    this.setCanvasCursor(parcel === null ? "grab" : "pointer");
    this.scheduleDraw();
  }

  private hitTest(px: number, py: number): WallParcel | null {
    if (this.cssWidth <= 0) return null;
    const wx = Math.floor((px - this.view.tx) / this.view.scale);
    const wy = Math.floor((py - this.view.ty) / this.view.scale);
    for (let i = this.parcels.length - 1; i >= 0; i -= 1) {
      const parcel = this.parcels[i]!;
      if (
        wx >= parcel.x &&
        wx < parcel.x + parcel.width &&
        wy >= parcel.y &&
        wy < parcel.y + parcel.height
      ) {
        return parcel;
      }
    }
    return null;
  }

  private activateAt(px: number, py: number): void {
    const parcel = this.hitTest(px, py);
    if (parcel !== null) {
      this.ensureVisible(parcel);
      this.options.onParcelChosen?.(parcel);
      return;
    }
    if (this.cssWidth <= 0) return;
    const x = Math.min(
      Math.max(Math.floor((px - this.view.tx) / this.view.scale), 0),
      GRID_SIZE - 1,
    );
    const y = Math.min(
      Math.max(Math.floor((py - this.view.ty) / this.view.scale), 0),
      GRID_SIZE - 1,
    );
    this.options.onRectChosen?.({ x, y });
  }

  private setCanvasCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  // ── view transform ──────────────────────────────────────────────────────

  private syncSize(): void {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) return;
    if (width === this.cssWidth && height === this.cssHeight) return;
    this.devicePixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    this.cssWidth = width;
    this.cssHeight = height;
    this.canvas.width = Math.round(width * this.devicePixelRatio);
    this.canvas.height = Math.round(height * this.devicePixelRatio);
    if (this.pendingFit) {
      this.fitView();
      this.pendingFit = false;
    } else {
      this.clampView();
    }
    this.scheduleDraw();
  }

  private fitScale(): number {
    const usable = Math.max(
      Math.min(this.cssWidth, this.cssHeight) - FIT_MARGIN_PX * 2,
      1,
    );
    return usable / GRID_SIZE;
  }

  private fitView(): void {
    const scale = this.fitScale();
    this.view = {
      scale,
      tx: (this.cssWidth - GRID_SIZE * scale) / 2,
      ty: (this.cssHeight - GRID_SIZE * scale) / 2,
    };
  }

  private clampView(): void {
    if (this.cssWidth <= 0) return;
    const minScale = this.fitScale() * 0.5;
    this.view.scale = Math.min(Math.max(this.view.scale, minScale), MAX_SCALE);
    const wallSize = GRID_SIZE * this.view.scale;
    this.view.tx = clampRange(
      this.view.tx,
      PAN_MARGIN_PX - wallSize,
      this.cssWidth - PAN_MARGIN_PX,
      (this.cssWidth - wallSize) / 2,
    );
    this.view.ty = clampRange(
      this.view.ty,
      PAN_MARGIN_PX - wallSize,
      this.cssHeight - PAN_MARGIN_PX,
      (this.cssHeight - wallSize) / 2,
    );
  }

  private panBy(dx: number, dy: number): void {
    if (this.cssWidth <= 0) return;
    this.view.tx += dx;
    this.view.ty += dy;
    this.clampView();
    this.scheduleDraw();
  }

  private zoomAt(px: number, py: number, factor: number): void {
    if (this.cssWidth <= 0) return;
    const wx = (px - this.view.tx) / this.view.scale;
    const wy = (py - this.view.ty) / this.view.scale;
    this.view.scale *= factor;
    this.view.tx = px - wx * this.view.scale;
    this.view.ty = py - wy * this.view.scale;
    this.clampView();
    this.scheduleDraw();
  }

  private viewInfo(): WallViewInfo {
    const { scale, tx, ty } = this.view;
    return {
      zoomPercent: Math.round(scale * 100),
      x0: Math.max(0, Math.floor((0 - tx) / scale)),
      y0: Math.max(0, Math.floor((0 - ty) / scale)),
      x1: Math.min(GRID_SIZE, Math.ceil((this.cssWidth - tx) / scale)),
      y1: Math.min(GRID_SIZE, Math.ceil((this.cssHeight - ty) / scale)),
    };
  }

  // ── drawing ─────────────────────────────────────────────────────────────

  private scheduleDraw(): void {
    if (this.disposed || this.framePending || this.ctx === null) return;
    this.framePending = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        this.framePending = false;
        this.draw();
      });
    } else {
      this.framePending = false;
      this.draw();
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    if (
      this.disposed ||
      ctx === null ||
      this.cssWidth <= 0 ||
      this.cssHeight <= 0
    ) {
      return;
    }
    const { scale, tx, ty } = this.view;
    const width = this.cssWidth;
    const height = this.cssHeight;

    ctx.setTransform(this.devicePixelRatio, 0, 0, this.devicePixelRatio, 0, 0);
    ctx.fillStyle = this.theme.mat;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);
    ctx.fillStyle = this.theme.ground;
    ctx.fillRect(0, 0, GRID_SIZE, GRID_SIZE);
    this.drawGrid(ctx, scale);

    const viewX0 = (0 - tx) / scale;
    const viewX1 = (width - tx) / scale;
    const viewY0 = (0 - ty) / scale;
    const viewY1 = (height - ty) / scale;
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = this.theme.stroke;
    for (const parcel of this.parcels) {
      if (parcel.x >= viewX1 || parcel.x + parcel.width <= viewX0) continue;
      if (parcel.y >= viewY1 || parcel.y + parcel.height <= viewY0) continue;
      ctx.fillStyle =
        this.theme.tones[parcelToneIndex(parcel, this.theme.tones.length)] ??
        this.theme.ground;
      ctx.fillRect(parcel.x, parcel.y, parcel.width, parcel.height);
      ctx.strokeRect(parcel.x, parcel.y, parcel.width, parcel.height);
    }
    if (this.scenePreview !== null) {
      const { rect, source, state } = this.scenePreview;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
      if (state === "staged") {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = this.theme.focus;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      ctx.restore();
    }
    if (this.hoverParcel !== null) {
      ctx.save();
      ctx.setLineDash([5 / scale, 4 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = this.theme.hover;
      ctx.strokeRect(
        this.hoverParcel.x,
        this.hoverParcel.y,
        this.hoverParcel.width,
        this.hoverParcel.height,
      );
      ctx.restore();
    }
    if (this.focusRect !== null) {
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = this.theme.focus;
      ctx.strokeRect(
        this.focusRect.x,
        this.focusRect.y,
        this.focusRect.width,
        this.focusRect.height,
      );
    }
    ctx.restore();

    this.drawLabels(ctx, scale, tx, ty);
    this.options.onViewChanged?.(this.viewInfo());
  }

  private drawGrid(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.strokeStyle = this.theme.grid;
    if (scale * MAJOR_GRID_PX >= 12) {
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let g = 0; g <= GRID_SIZE; g += MAJOR_GRID_PX) {
        ctx.moveTo(g, 0);
        ctx.lineTo(g, GRID_SIZE);
        ctx.moveTo(0, g);
        ctx.lineTo(GRID_SIZE, g);
      }
      ctx.stroke();
    }
    if (scale * MINOR_GRID_PX >= 9) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let g = MINOR_GRID_PX; g < GRID_SIZE; g += MINOR_GRID_PX) {
        if (g % MAJOR_GRID_PX === 0) continue;
        ctx.moveTo(g, 0);
        ctx.lineTo(g, GRID_SIZE);
        ctx.moveTo(0, g);
        ctx.lineTo(GRID_SIZE, g);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = 1.2 / scale;
    ctx.strokeStyle = this.theme.stroke;
    ctx.strokeRect(0, 0, GRID_SIZE, GRID_SIZE);
  }

  private drawLabels(
    ctx: CanvasRenderingContext2D,
    scale: number,
    tx: number,
    ty: number,
  ): void {
    if (scale < LABEL_MIN_SCALE) return;
    ctx.font = "500 10px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = this.theme.label;
    for (const parcel of this.parcels) {
      const sx = parcel.x * scale + tx;
      const sy = parcel.y * scale + ty;
      const sw = parcel.width * scale;
      const sh = parcel.height * scale;
      if (sw < 44 || sh < 18) continue;
      if (sx > this.cssWidth || sy > this.cssHeight || sx + sw < 0 || sy + sh < 0) {
        continue;
      }
      ctx.fillText(parcel.id ?? `${parcel.x}, ${parcel.y}`, sx + 4, sy + 3);
    }
  }
}
