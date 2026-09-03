import { describe, expect, it, vi } from "vitest";

import { createRemoteMcpAdapter } from "../src/mcp/server.js";
import { createWebMcpAdapter } from "../src/web/webmcp.js";

const PROGRAM = {
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

const PREVIEW_INPUT = {
  x: 0,
  y: 0,
  width: 3,
  height: 4,
  program: PROGRAM,
} as const;

type ToolAdapter = {
  getTools: () => readonly { name: string }[];
  executeTool: (name: string, input: unknown) => unknown | Promise<unknown>;
};

type StagePort = { stage: (candidate: unknown) => void };

function makeAdapter(
  create: (options: {
    fixture: unknown;
    transientStage: StagePort;
    now: () => number;
  }) => unknown,
  transientStage: StagePort,
): ToolAdapter {
  return create({
    fixture: FIXTURE,
    transientStage,
    now: () => 1_700_000_000_000,
  }) as ToolAdapter;
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

async function execute(
  adapter: ToolAdapter,
  name: string,
  input: unknown,
): Promise<unknown> {
  return adapter.executeTool(name, input);
}

async function capture(
  adapter: ToolAdapter,
  name: string,
  input: unknown,
): Promise<{ value: unknown; errorCode?: string }> {
  try {
    return { value: await execute(adapter, name, input) };
  } catch (error) {
    return { value: undefined, errorCode: findErrorCode(error) };
  }
}

describe("browser WebMCP and remote MCP parity", () => {
  it("exposes exactly the same four-tool allowlist", () => {
    const browser = makeAdapter(createWebMcpAdapter, { stage: () => undefined });
    const remote = makeAdapter(createRemoteMcpAdapter, { stage: () => undefined });

    expect(browser.getTools().map((tool) => tool.name)).toEqual([
      "survey_wall",
      "preview_parcel",
      "stage_parcel",
      "inspect_receipt",
    ]);
    expect(remote.getTools().map((tool) => tool.name)).toEqual(
      browser.getTools().map((tool) => tool.name),
    );
  });

  it("returns byte-identical normalized results for canonical parity vectors", async () => {
    const browserStage = { stage: vi.fn<(candidate: unknown) => void>() };
    const remoteStage = { stage: vi.fn<(candidate: unknown) => void>() };
    const browser = makeAdapter(createWebMcpAdapter, browserStage);
    const remote = makeAdapter(createRemoteMcpAdapter, remoteStage);
    const vectors = [
      {
        name: "survey_wall",
        input: { x: 0, y: 0, width: 3, height: 4 },
      },
      { name: "preview_parcel", input: PREVIEW_INPUT },
      { name: "stage_parcel", input: PREVIEW_INPUT },
      {
        name: "inspect_receipt",
        input: { receiptId: "fixture-receipt-0001" },
      },
    ] as const;

    for (const vector of vectors) {
      const [browserResult, remoteResult] = await Promise.all([
        capture(browser, vector.name, vector.input),
        capture(remote, vector.name, vector.input),
      ]);
      expect(browserResult.errorCode).toBeUndefined();
      expect(remoteResult.errorCode).toBeUndefined();
      expect(JSON.stringify(browserResult.value)).toBe(
        JSON.stringify(remoteResult.value),
      );
    }

    expect(browserStage.stage).toHaveBeenCalledTimes(1);
    expect(remoteStage.stage).toHaveBeenCalledTimes(1);
  });

  it("preserves the same geometry, digest, price, and receipt fields", async () => {
    const browser = makeAdapter(createWebMcpAdapter, { stage: () => undefined });
    const remote = makeAdapter(createRemoteMcpAdapter, { stage: () => undefined });
    const [browserPreview, remotePreview] = await Promise.all([
      execute(browser, "preview_parcel", PREVIEW_INPUT),
      execute(remote, "preview_parcel", PREVIEW_INPUT),
    ]);
    const [browserReceipt, remoteReceipt] = await Promise.all([
      execute(browser, "inspect_receipt", {
        receiptId: "fixture-receipt-0001",
      }),
      execute(remote, "inspect_receipt", {
        receiptId: "fixture-receipt-0001",
      }),
    ]);

    for (const result of [browserPreview, remotePreview]) {
      expect(result).toEqual(
        expect.objectContaining({
          chainId: "84532",
          testnet: true,
          canonical: false,
          pixels: 12,
          texels: 3_072,
          priceUsdc: 12,
          priceMicroUsdc: 12_000_000,
          scene: expect.objectContaining({
            width: 48,
            height: 64,
            programSha256:
              "80e2b334cdba4c959d887be682d103760047fe79f1e79a9195ccf5fad6a13dce",
            rgbSha256:
              "ed0623b48f99a7150ecb38c678a4fa22ee5f95a76aa43fa5d7c37c66f9d493ad",
          }),
        }),
      );
    }
    expect(browserPreview).toEqual(remotePreview);
    expect(browserReceipt).toEqual(remoteReceipt);
    expect(browserReceipt).toEqual(
      expect.objectContaining({
        chainId: "84532",
        canonical: false,
        receipt: expect.objectContaining({
          receiptId: "fixture-receipt-0001",
          status: "fixture",
        }),
      }),
    );
  });

  it("returns the same stable error codes for malformed parity vectors", async () => {
    const browser = makeAdapter(createWebMcpAdapter, { stage: () => undefined });
    const remote = makeAdapter(createRemoteMcpAdapter, { stage: () => undefined });
    const vectors = [
      {
        name: "preview_parcel",
        input: {
          ...PREVIEW_INPUT,
          x: 999,
          width: 2,
        },
        code: "out_of_bounds",
      },
      {
        name: "preview_parcel",
        input: {
          ...PREVIEW_INPUT,
          [["authority", "Evidence"].join("")]: "rejected",
        },
        code: "unknown_key",
      },
      {
        name: "inspect_receipt",
        input: { receiptId: "fixture-receipt-does-not-exist" },
        code: "unavailable_receipt",
      },
    ] as const;

    for (const vector of vectors) {
      const [browserResult, remoteResult] = await Promise.all([
        capture(browser, vector.name, vector.input),
        capture(remote, vector.name, vector.input),
      ]);
      expect(browserResult.errorCode).toBe(vector.code);
      expect(remoteResult.errorCode).toBe(vector.code);
      expect(browserResult.errorCode).toBe(remoteResult.errorCode);
      expect(JSON.stringify(browserResult.value)).toBe(
        JSON.stringify(remoteResult.value),
      );
    }
  });
});
