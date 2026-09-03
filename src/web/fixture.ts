/**
 * View-local deterministic stand-in parcels.
 *
 * Until a survey_wall output is applied, the canvas hangs these rectangles so
 * the wall is never blank. They are geometry only — no ids, owners, titles or
 * artwork claims — and the first applied survey replaces them wholesale.
 * The coordinates are literal (not generated) so the set stays auditable.
 */

export interface FixtureParcel {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const LOCAL_FIXTURE_NOTE =
  "Local stand-in parcels — the view's own deterministic preview, not survey truth. A survey_wall result replaces them.";

const standInParcels: readonly FixtureParcel[] = [
  { x: 40, y: 60, width: 120, height: 90 },
  { x: 200, y: 40, width: 60, height: 60 },
  { x: 300, y: 90, width: 180, height: 110 },
  { x: 520, y: 50, width: 90, height: 140 },
  { x: 650, y: 90, width: 200, height: 80 },
  { x: 890, y: 60, width: 70, height: 70 },
  { x: 60, y: 260, width: 80, height: 160 },
  { x: 180, y: 280, width: 140, height: 100 },
  { x: 360, y: 240, width: 100, height: 100 },
  { x: 500, y: 280, width: 220, height: 60 },
  { x: 760, y: 240, width: 90, height: 180 },
  { x: 880, y: 300, width: 80, height: 120 },
  { x: 100, y: 480, width: 160, height: 160 },
  { x: 300, y: 460, width: 80, height: 200 },
  { x: 420, y: 500, width: 240, height: 120 },
  { x: 700, y: 480, width: 110, height: 110 },
  { x: 850, y: 500, width: 100, height: 150 },
  { x: 60, y: 720, width: 100, height: 180 },
  { x: 200, y: 740, width: 180, height: 100 },
  { x: 420, y: 700, width: 120, height: 120 },
  { x: 580, y: 760, width: 60, height: 60 },
  { x: 680, y: 720, width: 160, height: 140 },
  { x: 870, y: 740, width: 90, height: 160 },
];

export const LOCAL_FIXTURE_PARCELS: readonly FixtureParcel[] = Object.freeze(
  standInParcels.map((parcel) => Object.freeze(parcel)),
);
