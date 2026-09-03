import { describe, expect, it, vi } from "vitest";

import { CHALLENGE_FIXTURE, DEMO_SCENE_PROGRAM } from "../src/fixtures/challenge.js";
import {
  createWebMcpAdapter,
  registerWebMcpTools,
  type ModelContextSurface,
  type RegisteredWebMcpTool,
} from "../src/web/webmcp.js";

class ModelContextTestSurface implements ModelContextSurface {
  readonly tools = new Map<string, RegisteredWebMcpTool>();

  registerTool(
    tool: RegisteredWebMcpTool,
    options?: { readonly signal?: AbortSignal },
  ): undefined {
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener(
      "abort",
      () => {
        this.tools.delete(tool.name);
      },
      { once: true },
    );
    return undefined;
  }

  async getTools(): Promise<readonly RegisteredWebMcpTool[]> {
    return [...this.tools.values()];
  }

  async executeTool(
    tool: RegisteredWebMcpTool,
    argumentsJson: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<string> {
    return tool.execute(JSON.parse(argumentsJson) as unknown, options);
  }
}

function adapter(stage = vi.fn()) {
  return createWebMcpAdapter({
    fixture: CHALLENGE_FIXTURE,
    transientStage: { stage },
    now: () => 1_700_000_000_000,
  });
}

describe("first-party document.modelContext adapter", () => {
  it("feature-detects absence without registering or changing the page", async () => {
    const registration = await registerWebMcpTools({
      document: documentStub(undefined),
      adapter: adapter(),
    });
    expect(registration.registered).toBe(false);
    expect(() => registration.teardown()).not.toThrow();
  });

  it("registers four tools, executes them through getTools/executeTool, and tears down", async () => {
    const modelContext = new ModelContextTestSurface();
    const stage = vi.fn();
    const onResult = vi.fn();
    const registration = await registerWebMcpTools({
      document: documentStub(modelContext),
      adapter: adapter(stage),
      onResult,
    });

    const tools = await modelContext.getTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "survey_wall",
      "preview_parcel",
      "stage_parcel",
      "inspect_receipt",
    ]);
    expect(tools.find((tool) => tool.name === "stage_parcel")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
      consequentialHint: false,
      untrustedContentHint: false,
    });

    const previewTool = tools.find((tool) => tool.name === "preview_parcel");
    if (previewTool === undefined) throw new Error("missing preview tool");
    const preview = JSON.parse(
      await modelContext.executeTool(
        previewTool,
        JSON.stringify({
          x: 0,
          y: 0,
          width: 3,
          height: 4,
          program: DEMO_SCENE_PROGRAM,
        }),
      ),
    ) as Record<string, unknown>;
    expect(preview).toMatchObject({
      mode: "fixture",
      chainId: "84532",
      pixels: 12,
      priceUsdc: 12,
    });
    expect(onResult).toHaveBeenCalledTimes(1);

    const invalidSurvey = JSON.parse(
      await modelContext.executeTool(
        tools.find((tool) => tool.name === "survey_wall")!,
        JSON.stringify({ x: 999, y: 0, width: 2, height: 1 }),
      ),
    ) as { error?: { code?: string } };
    expect(invalidSurvey.error?.code).toBe("out_of_bounds");

    const stageTool = tools.find((tool) => tool.name === "stage_parcel");
    if (stageTool === undefined) throw new Error("missing stage tool");
    await modelContext.executeTool(
      stageTool,
      JSON.stringify({
        x: 0,
        y: 0,
        width: 3,
        height: 4,
        program: DEMO_SCENE_PROGRAM,
      }),
    );
    expect(stage).toHaveBeenCalledTimes(1);

    registration.teardown();
    expect(await modelContext.getTools()).toHaveLength(0);
  });

  it("keeps presentation-observer failures outside the tool result channel", async () => {
    const modelContext = new ModelContextTestSurface();
    const registration = await registerWebMcpTools({
      document: documentStub(modelContext),
      adapter: adapter(),
      onResult() {
        throw new Error("presentation failed");
      },
    });
    const tool = (await modelContext.getTools()).find(
      (candidate) => candidate.name === "survey_wall",
    );
    if (tool === undefined) throw new Error("missing survey tool");
    await expect(
      modelContext.executeTool(
        tool,
        JSON.stringify({ x: 0, y: 0, width: 3, height: 4 }),
      ),
    ).resolves.toContain('"mode":"fixture"');
    registration.teardown();
  });

  it("is idempotent for duplicate initialization", async () => {
    const modelContext = new ModelContextTestSurface();
    const first = await registerWebMcpTools({
      document: documentStub(modelContext),
      adapter: adapter(),
    });
    const second = await registerWebMcpTools({
      document: documentStub(modelContext),
      adapter: adapter(),
    });
    expect(await modelContext.getTools()).toHaveLength(4);
    second.teardown();
    expect(await modelContext.getTools()).toHaveLength(4);
    first.teardown();
    expect(await modelContext.getTools()).toHaveLength(0);
  });

  it("honors an already-aborted direct execution signal", async () => {
    const modelContext = new ModelContextTestSurface();
    const registration = await registerWebMcpTools({
      document: documentStub(modelContext),
      adapter: adapter(),
    });
    const tool = (await modelContext.getTools()).find(
      (candidate) => candidate.name === "survey_wall",
    );
    if (tool === undefined) throw new Error("missing survey tool");
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      modelContext.executeTool(
        tool,
        JSON.stringify({ x: 0, y: 0, width: 3, height: 4 }),
        { signal: controller.signal },
      ),
    ).rejects.toThrow("cancelled");
    registration.teardown();
  });
});

function documentStub(modelContext: ModelContextSurface | undefined) {
  return { modelContext } as unknown as Document & {
    readonly modelContext?: ModelContextSurface;
  };
}
