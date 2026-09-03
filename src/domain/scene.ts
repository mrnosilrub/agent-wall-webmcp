/**
 * Permanent Genesis Scene geometry. A W×H Parcel has one (16W)×(16H) Scene.
 * Pure O(1) arithmetic. Does not allocate an RGB frame or know about transport.
 */

import { GRID_SIZE } from "./pricing.js";

export const TEXELS_PER_PIXEL_AXIS = 16;
export const TEXELS_PER_PIXEL = TEXELS_PER_PIXEL_AXIS * TEXELS_PER_PIXEL_AXIS;

export interface ParcelDimensions {
  width: number;
  height: number;
}

declare const sceneSizeBrand: unique symbol;

/** Derived Scene dimensions. Opaque at the type interface; runtime still re-validates. */
export type SceneSize = {
  readonly width: number;
  readonly height: number;
  readonly [sceneSizeBrand]: void;
};

function assertParcelDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > GRID_SIZE ||
    height > GRID_SIZE
  ) {
    throw new RangeError(
      `parcel width and height must be integers in [1, ${GRID_SIZE}]`,
    );
  }
}

function assertSceneAxes(width: number, height: number): void {
  const min = TEXELS_PER_PIXEL_AXIS;
  const max = GRID_SIZE * TEXELS_PER_PIXEL_AXIS;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < min ||
    height < min ||
    width > max ||
    height > max ||
    width % TEXELS_PER_PIXEL_AXIS !== 0 ||
    height % TEXELS_PER_PIXEL_AXIS !== 0
  ) {
    throw new RangeError(
      `Scene width and height must be integer multiples of ${TEXELS_PER_PIXEL_AXIS} in [${min}, ${max}]`,
    );
  }
}

export function sceneSize(parcel: ParcelDimensions): SceneSize {
  const width = parcel.width;
  const height = parcel.height;
  assertParcelDimensions(width, height);
  return Object.freeze({
    width: width * TEXELS_PER_PIXEL_AXIS,
    height: height * TEXELS_PER_PIXEL_AXIS,
  }) as SceneSize;
}

function snapshotScene(scene: SceneSize): { width: number; height: number } {
  const width = scene.width;
  const height = scene.height;
  assertSceneAxes(width, height);
  return { width, height };
}

function texelCountFromAxes(width: number, height: number): number {
  const texels = width * height;
  if (!Number.isSafeInteger(texels) || texels < 1) {
    throw new RangeError("Scene texel count is not a safe positive integer");
  }
  return texels;
}

function rgbByteLengthFromAxes(width: number, height: number): number {
  const bytes = texelCountFromAxes(width, height) * 3;
  if (!Number.isSafeInteger(bytes) || bytes < 1) {
    throw new RangeError("Scene RGB byte length is not a safe positive integer");
  }
  return bytes;
}

export function sceneTexelCount(scene: SceneSize): number {
  const { width, height } = snapshotScene(scene);
  return texelCountFromAxes(width, height);
}

export function sceneRgbByteLength(scene: SceneSize): number {
  const { width, height } = snapshotScene(scene);
  return rgbByteLengthFromAxes(width, height);
}
