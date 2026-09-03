import { describe, expect, it, vi } from "vitest";

import { createHandlers } from "../src/tools/handlers.js";

const FIXTURE = {
  mode: "fixture",
  chain: "base-sepolia",
  chainId: "84532",
  testnet: true,
  canonical: false,
  wall: {
    width: 1000,
    height: 1000,
    totalPixels: 1_000_000,
    occupiedPixels: 0,
  },
  receipts: {
    "fixture-receipt-0001": {
      receiptId: "fixture-receipt-0001",
      status: "fixture",
      parcel: { x: 0, y: 0, width: 3, height: 4 },
      pixels: 12,
      priceUsdc: 12,
      scene: {
        width: 48,
        height: 64,
        texels: 3_072,
        rgbBytes: 9_216,
        programSha256:
          "80e2b334cdba4c959d887be682d103760047fe79f1e79a9195ccf5fad6a13dce",
        rgbSha256:
          "ed0623b48f99a7150ecb38c678a4fa22ee5f95a76aa43fa5d7c37c66f9d493ad",
      },
    },
  },
} as const;

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

const DEMO_PROGRAM = {
  v: 1,
  background: [245, 242, 236],
  ops: [
    {
      op: "CHECKER",
      x: 0,
      y: 0,
      w: 48,
      h: 64,
      a: [245, 242, 236],
      b: [124, 45, 45],
      cell: 16,
    },
  ],
} as const;

const PREVIEW_INPUT = {
  x: 0,
  y: 0,
  width: 3,
  height: 4,
  program: DEMO_PROGRAM,
} as const;

const ENVELOPE = {
  mode: "fixture",
  chain: "base-sepolia",
  chainId: "84532",
  testnet: true,
  canonical: false,
} as const;

const EXPECTED_SURVEY = {
  ...ENVELOPE,
  wall: {
    width: 1000,
    height: 1000,
    totalPixels: 1_000_000,
    texelsPerPixel: 256,
  },
  candidate: {
    x: 0,
    y: 0,
    width: 3,
    height: 4,
    pixels: 12,
    priceUsdc: 12,
    available: true,
  },
} as const;

const EXPECTED_PREVIEW = {
  ...ENVELOPE,
  parcel: { x: 0, y: 0, width: 3, height: 4 },
  pixels: 12,
  texels: 3_072,
  priceUsdc: 12,
  priceMicroUsdc: 12_000_000,
  scene: {
    width: 48,
    height: 64,
    texels: 3_072,
    rgbBytes: 9_216,
    programSha256:
      "80e2b334cdba4c959d887be682d103760047fe79f1e79a9195ccf5fad6a13dce",
    rgbSha256:
      "ed0623b48f99a7150ecb38c678a4fa22ee5f95a76aa43fa5d7c37c66f9d493ad",
  },
} as const;

const EXPECTED_STAGE = {
  ...EXPECTED_PREVIEW,
  candidateSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  stage: {
    state: "staged",
    presentation: "EPHEMERAL / NOT PURCHASED",
    ephemeral: true,
    expiresAtMs: 1_700_000_300_000,
  },
} as const;

const EXPECTED_RECEIPT = {
  ...ENVELOPE,
  receipt: FIXTURE.receipts["fixture-receipt-0001"],
} as const;

const FORBIDDEN_OUTPUT_KEYS = new Set([
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
]);

type Handler = (input: unknown) => unknown | Promise<unknown>;
type HandlerMap = Record<string, Handler>;

function makeHandlers(
  transientStage: { stage: (candidate: unknown) => void } = {
    stage: () => undefined,
  },
  fixture: unknown = FIXTURE,
  now: () => number = () => 1_700_000_000_000,
): HandlerMap {
  return createHandlers({ fixture, transientStage, now }) as HandlerMap;
}

async function execute(
  handlers: HandlerMap,
  name: string,
  input: unknown,
): Promise<unknown> {
  const handler = handlers[name];
  expect(handler, `${name} handler must be present`).toEqual(expect.any(Function));
  return handler(input);
}

function findErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  if (record.error && typeof record.error === "object") {
    const nested = (record.error as Record<string, unknown>).code;
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

async function expectErrorCode(
  operation: () => unknown | Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let observed: unknown;
  try {
    observed = await operation();
  } catch (error) {
    observed = error;
  }
  expect(findErrorCode(observed)).toBe(expectedCode);
}

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.push(key);
    collectKeys(child, keys);
  }
  return keys;
}

function assertBoundedFixtureResult(result: unknown): void {
  const serialized = JSON.stringify(result);
  expect(serialized).toBeTypeOf("string");
  if (serialized === undefined) throw new Error("fixture result must be JSON");
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(1_536);
  expect(collectKeys(result).some((key) => FORBIDDEN_OUTPUT_KEYS.has(key))).toBe(
    false,
  );
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

describe("pure Agent Wall kernel handlers", () => {
  it("returns bounded, deterministic fixture vectors for all four tools", async () => {
    const handlers = makeHandlers();

    const survey = await execute(handlers, "survey_wall", {
      x: 0,
      y: 0,
      width: 3,
      height: 4,
    });
    const preview = await execute(handlers, "preview_parcel", PREVIEW_INPUT);
    const stage = await execute(handlers, "stage_parcel", PREVIEW_INPUT);
    const receipt = await execute(handlers, "inspect_receipt", {
      receiptId: "fixture-receipt-0001",
    });

    expect(survey).toEqual(EXPECTED_SURVEY);
    expect(preview).toEqual(EXPECTED_PREVIEW);
    expect(stage).toEqual(EXPECTED_STAGE);
    expect(receipt).toEqual(EXPECTED_RECEIPT);

    for (const result of [survey, preview, stage, receipt]) {
      assertBoundedFixtureResult(result);
    }

    expect(JSON.stringify(survey)).toBe(
      JSON.stringify(
        await execute(handlers, "survey_wall", {
          x: 0,
          y: 0,
          width: 3,
          height: 4,
        }),
      ),
    );
    expect(JSON.stringify(preview)).toBe(
      JSON.stringify(await execute(handlers, "preview_parcel", PREVIEW_INPUT)),
    );
    expect(
      (await execute(handlers, "stage_parcel", PREVIEW_INPUT) as Record<string, unknown>)
        .candidateSha256,
    ).toBe((stage as Record<string, unknown>).candidateSha256);
  });

  it("derives exact Pixel, texel, Scene, and flat USDC facts", async () => {
    const result = (await execute(
      makeHandlers(),
      "preview_parcel",
      PREVIEW_INPUT,
    )) as Record<string, unknown>;
    const parcel = result.parcel as Record<string, number>;
    const scene = result.scene as Record<string, number | string>;

    expect(parcel).toEqual({ x: 0, y: 0, width: 3, height: 4 });
    expect(result.pixels).toBe(parcel.width * parcel.height);
    expect(result.texels).toBe((result.pixels as number) * 256);
    expect(result.priceUsdc).toBe(result.pixels);
    expect(result.priceMicroUsdc).toBe((result.pixels as number) * 1_000_000);
    expect(scene.width).toBe(parcel.width * 16);
    expect(scene.height).toBe(parcel.height * 16);
    expect(scene.texels).toBe(Number(scene.width) * Number(scene.height));
    expect(scene.rgbBytes).toBe(Number(scene.texels) * 3);
    expect(scene.programSha256).toBe(
      "80e2b334cdba4c959d887be682d103760047fe79f1e79a9195ccf5fad6a13dce",
    );
    expect(scene.rgbSha256).toBe(
      "ed0623b48f99a7150ecb38c678a4fa22ee5f95a76aa43fa5d7c37c66f9d493ad",
    );
  });

  it("accepts inclusive geometry edges and rejects geometry outside the Wall", async () => {
    const handlers = makeHandlers();
    const validParcels = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 999, y: 999, width: 1, height: 1 },
      { x: 999, y: 0, width: 1, height: 1000 },
      { x: 0, y: 999, width: 1000, height: 1 },
    ];

    for (const parcel of validParcels) {
      const result = await execute(handlers, "preview_parcel", {
        ...parcel,
        program: PROGRAM,
      });
      expect((result as Record<string, unknown>).parcel).toEqual(parcel);
    }

    for (const parcel of [
      { x: -1, y: 0, width: 1, height: 1 },
      { x: 0, y: -1, width: 1, height: 1 },
      { x: 1000, y: 0, width: 1, height: 1 },
      { x: 0, y: 1000, width: 1, height: 1 },
      { x: 999, y: 0, width: 2, height: 1 },
      { x: 0, y: 999, width: 1, height: 2 },
      { x: 0, y: 0, width: 0, height: 1 },
      { x: 0, y: 0, width: 1, height: 0 },
    ]) {
      await expectErrorCode(
        () =>
          execute(handlers, "preview_parcel", {
            ...parcel,
            program: PROGRAM,
          }),
        "out_of_bounds",
      );
    }
  });

  it("rejects invalid Scene-v1 geometry with a stable error code", async () => {
    const handlers = makeHandlers();
    await expectErrorCode(
      () =>
        execute(handlers, "preview_parcel", {
          ...PREVIEW_INPUT,
          width: 1,
          height: 1,
          program: {
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
          },
        }),
      "invalid_program",
    );
  });

  it("is pure for read/preview handlers and never needs a network", async () => {
    const handlers = makeHandlers();
    const frozenInput = deepFreeze(structuredClone(PREVIEW_INPUT));
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error("network access is forbidden in the kernel");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const before = JSON.stringify(frozenInput);
      const first = await execute(handlers, "preview_parcel", frozenInput);
      const second = await execute(handlers, "preview_parcel", frozenInput);
      const survey = await execute(handlers, "survey_wall", {
        x: 0,
        y: 0,
        width: 3,
        height: 4,
      });
      const receipt = await execute(handlers, "inspect_receipt", {
        receiptId: "fixture-receipt-0001",
      });

      expect(JSON.stringify(frozenInput)).toBe(before);
      expect(first).toEqual(second);
      expect(survey).toEqual(EXPECTED_SURVEY);
      expect(receipt).toEqual(EXPECTED_RECEIPT);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses only the injected transient stage effect and returns presentation facts", async () => {
    const stageEffect = { stage: vi.fn<(candidate: unknown) => void>() };
    const handlers = makeHandlers(stageEffect);
    const result = await execute(handlers, "stage_parcel", PREVIEW_INPUT);

    expect(result).toEqual(EXPECTED_STAGE);
    expect(stageEffect.stage).toHaveBeenCalledTimes(1);
    const effectArgument = stageEffect.stage.mock.calls[0]?.[0];
    expect(effectArgument).toEqual(
      expect.objectContaining({
        x: 0,
        y: 0,
        width: 3,
        height: 4,
        pixels: 12,
        priceUsdc: 12,
        sceneWidth: 48,
        sceneHeight: 64,
        programSha256:
          "80e2b334cdba4c959d887be682d103760047fe79f1e79a9195ccf5fad6a13dce",
        rgbSha256:
          "ed0623b48f99a7150ecb38c678a4fa22ee5f95a76aa43fa5d7c37c66f9d493ad",
      }),
    );
    expect(collectKeys(effectArgument).some((key) => FORBIDDEN_OUTPUT_KEYS.has(key))).toBe(
      false,
    );
  });

  it("fails closed on mode and decimal chain identity", () => {
    const invalidFixtures = [
      { ...FIXTURE, chainId: "84531" },
      { ...FIXTURE, chainId: 84532 },
      { ...FIXTURE, chainId: "0x14a34" },
      { ...FIXTURE, mode: "live" },
      { ...FIXTURE, testnet: false },
      { ...FIXTURE, canonical: true },
    ];

    for (const fixture of invalidFixtures.slice(0, 3)) {
      expect(() => makeHandlers(undefined, fixture)).toThrow();
    }
    for (const fixture of invalidFixtures.slice(3)) {
      expect(() => makeHandlers(undefined, fixture)).toThrowError(
        expect.objectContaining({ code: "wrong_mode" }),
      );
    }
  });

  it("rejects fixture-occupied candidates with the stable occupied code", async () => {
    const handlers = makeHandlers(undefined, {
      ...FIXTURE,
      wall: {
        ...FIXTURE.wall,
        occupiedPixels: 1,
        occupiedRects: [{ x: 2, y: 3, width: 1, height: 1 }],
      },
    });
    await expectErrorCode(
      () => execute(handlers, "survey_wall", { x: 0, y: 0, width: 3, height: 4 }),
      "occupied",
    );
  });

  it("rejects oversized preview compilation before allocating Scene pixels", async () => {
    const handlers = makeHandlers();
    await expectErrorCode(
      () =>
        execute(handlers, "preview_parcel", {
          x: 0,
          y: 0,
          width: 1000,
          height: 1000,
          program: PROGRAM,
        }),
      "result_too_large",
    );
  });

  it("returns stable error codes without creating a receipt or order", async () => {
    const handlers = makeHandlers();

    await expectErrorCode(
      () =>
        execute(handlers, "inspect_receipt", {
          receiptId: "fixture-receipt-does-not-exist",
        }),
      "unavailable_receipt",
    );

    await expectErrorCode(
      () =>
        execute(handlers, "preview_parcel", {
          ...PREVIEW_INPUT,
          [["authority", "Evidence"].join("")]: "not-accepted",
        }),
      "unknown_key",
    );
  });
});
