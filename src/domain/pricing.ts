/** Agent Wall fixed-price and rectangle law (PRD v2.0 §3–4). */

export const TOTAL_PIXELS = 1_000_000;
export const GRID_SIZE = 1000;
export const MIN_PURCHASE_PIXELS = 1; // one pixel is a claim
export const PRICE_MICRO_USDC_PER_PIXEL = 1_000_000;
export const PRICE_CENTS_PER_PIXEL = 100;
export const PRICE_USD_PER_PIXEL = 1;

export interface FlatQuote {
  soldBefore: number;
  pixels: number;
  soldAfter: number;
  priceMicroUsdc: number;
  priceCents: number;
  priceUsd: number;
}

export function quoteFlat(soldBefore: number, pixels: number): FlatQuote {
  if (!Number.isInteger(soldBefore) || soldBefore < 0 || soldBefore > TOTAL_PIXELS) {
    throw new RangeError(`soldBefore must be integer in [0, ${TOTAL_PIXELS}]`);
  }
  if (!Number.isInteger(pixels) || pixels <= 0) {
    throw new RangeError("pixels must be a positive integer");
  }
  if (soldBefore + pixels > TOTAL_PIXELS) {
    throw new RangeError(
      `purchase ${pixels} from sold=${soldBefore} exceeds wall (${TOTAL_PIXELS})`,
    );
  }

  return {
    soldBefore,
    pixels,
    soldAfter: soldBefore + pixels,
    priceMicroUsdc: pixels * PRICE_MICRO_USDC_PER_PIXEL,
    priceCents: pixels * PRICE_CENTS_PER_PIXEL,
    priceUsd: pixels * PRICE_USD_PER_PIXEL,
  };
}

function roundToTwoDecimals(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export interface StatusSnapshot {
  totalPixels: number;
  soldPixels: number;
  remainingPixels: number;
  pctSold: number;
  pricingModel: "flat";
  unitPriceUsd: number;
  unitPriceMicroUsdc: number;
  primarySelloutRevenueUsd: number;
  minPurchasePixels: number;
}

export function wallStatus(soldPixels: number): StatusSnapshot {
  if (!Number.isInteger(soldPixels) || soldPixels < 0 || soldPixels > TOTAL_PIXELS) {
    throw new RangeError(`soldPixels must be integer in [0, ${TOTAL_PIXELS}]`);
  }
  const s = soldPixels / TOTAL_PIXELS;
  return {
    totalPixels: TOTAL_PIXELS,
    soldPixels,
    remainingPixels: TOTAL_PIXELS - soldPixels,
    pctSold: roundToTwoDecimals(s * 100),
    pricingModel: "flat",
    unitPriceUsd: PRICE_USD_PER_PIXEL,
    unitPriceMicroUsdc: PRICE_MICRO_USDC_PER_PIXEL,
    primarySelloutRevenueUsd: TOTAL_PIXELS * PRICE_USD_PER_PIXEL,
    minPurchasePixels: MIN_PURCHASE_PIXELS,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rectPixelCount(r: Rect): number {
  return r.width * r.height;
}

export function assertValidClaimRect(r: Rect): void {
  const { x, y, width, height } = r;
  for (const [name, v] of [
    ["x", x],
    ["y", y],
    ["width", width],
    ["height", height],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) {
      throw new RangeError(`${name} must be a non-negative integer`);
    }
  }
  if (width === 0 || height === 0) {
    throw new RangeError("width and height must be > 0");
  }
  if (x + width > GRID_SIZE || y + height > GRID_SIZE) {
    throw new RangeError(`rectangle exceeds ${GRID_SIZE}×${GRID_SIZE} grid`);
  }
  const n = width * height;
  if (n < MIN_PURCHASE_PIXELS) {
    throw new RangeError(
      `minimum purchase is ${MIN_PURCHASE_PIXELS} px; got ${n}`,
    );
  }
}

export interface PreviewClaimResult {
  rect: Rect;
  pixels: number;
  quote: FlatQuote;
  pricing: "flat";
}

export function previewClaim(soldPixels: number, rect: Rect): PreviewClaimResult {
  assertValidClaimRect(rect);
  const pixels = rectPixelCount(rect);
  if (soldPixels + pixels > TOTAL_PIXELS) {
    throw new RangeError("not enough remaining pixels for this claim");
  }
  const quote = quoteFlat(soldPixels, pixels);
  return {
    rect,
    pixels,
    quote,
    pricing: "flat",
  };
}
