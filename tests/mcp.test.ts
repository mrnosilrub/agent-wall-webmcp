import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";

import { CHALLENGE_FIXTURE, DEMO_SCENE_PROGRAM } from "../src/fixtures/challenge.js";
import { createRemoteMcpServer } from "../src/mcp/server.js";
import {
  createWebMcpAdapter,
  registerWebMcpTools,
  type ModelContextSurface,
  type RegisteredWebMcpTool,
} from "../src/web/webmcp.js";

const closeables: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.allSettled(closeables.splice(0).map((value) => value.close()));
});

describe("standard MCP client compatibility", () => {
  it("lists and executes the same fixture-safe catalog over an MCP transport", async () => {
    const server = createRemoteMcpServer({
      fixture: CHALLENGE_FIXTURE,
      transientStage: { stage() {} },
      now: () => 1_700_000_000_000,
    });
    const client = new Client({ name: "agent-wall-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    closeables.push(client, server);
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "survey_wall",
      "preview_parcel",
      "stage_parcel",
      "inspect_receipt",
    ]);
    expect(listed.tools.find((tool) => tool.name === "stage_parcel")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });

    const called = await client.callTool({
      name: "preview_parcel",
      arguments: {
        x: 0,
        y: 0,
        width: 3,
        height: 4,
        program: DEMO_SCENE_PROGRAM,
      },
    });
    expect(called.isError).not.toBe(true);
    expect(called.structuredContent).toMatchObject({
      mode: "fixture",
      chain: "base-sepolia",
      chainId: "84532",
      testnet: true,
      canonical: false,
      pixels: 12,
      priceUsdc: 12,
    });
  });

  it("matches direct document.modelContext execution for every tool and an error", async () => {
    const options = {
      fixture: CHALLENGE_FIXTURE,
      transientStage: { stage() {} },
      now: () => 1_700_000_000_000,
    } as const;
    const server = createRemoteMcpServer(options);
    const client = new Client({ name: "agent-wall-parity-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    closeables.push(client, server);
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const registered = new Map<string, RegisteredWebMcpTool>();
    const modelContext: ModelContextSurface = {
      registerTool(tool, registrationOptions) {
        registered.set(tool.name, tool);
        registrationOptions?.signal?.addEventListener(
          "abort",
          () => registered.delete(tool.name),
          { once: true },
        );
        return undefined;
      },
    };
    const registration = await registerWebMcpTools({
      document: { modelContext } as Document & { readonly modelContext: ModelContextSurface },
      adapter: createWebMcpAdapter(options),
    });

    const vectors = [
      ["survey_wall", { x: 0, y: 0, width: 3, height: 4 }],
      [
        "preview_parcel",
        { x: 0, y: 0, width: 3, height: 4, program: DEMO_SCENE_PROGRAM },
      ],
      [
        "stage_parcel",
        { x: 0, y: 0, width: 3, height: 4, program: DEMO_SCENE_PROGRAM },
      ],
      ["inspect_receipt", { receiptId: "fixture-receipt-0001" }],
    ] as const;

    for (const [name, input] of vectors) {
      const webTool = registered.get(name);
      if (webTool === undefined) throw new Error(`missing WebMCP tool ${name}`);
      const webResult = JSON.parse(await webTool.execute(input)) as unknown;
      const remoteResult = await client.callTool({ name, arguments: input });
      expect(remoteResult.isError).not.toBe(true);
      expect(JSON.stringify(remoteResult.structuredContent)).toBe(
        JSON.stringify(webResult),
      );
    }

    const invalidInput = { x: 999, y: 0, width: 2, height: 1 };
    const webSurvey = registered.get("survey_wall");
    if (webSurvey === undefined) throw new Error("missing WebMCP survey tool");
    const webError = JSON.parse(await webSurvey.execute(invalidInput)) as {
      error?: { code?: unknown };
    };
    const webErrorCode = webError.error?.code;
    const remoteError = await client.callTool({
      name: "survey_wall",
      arguments: invalidInput,
    });
    expect(remoteError.isError).toBe(true);
    expect(webErrorCode).toBe("out_of_bounds");
    expect(
      (remoteError.structuredContent as { error?: { code?: unknown } }).error?.code,
    ).toBe(webErrorCode);

    const schemaInvalid = await client.callTool({
      name: "preview_parcel",
      arguments: {
        x: 0,
        y: 0,
        width: "3",
        height: 4,
        program: DEMO_SCENE_PROGRAM,
      },
    });
    expect(schemaInvalid.isError).toBe(true);
    expect(
      (schemaInvalid.structuredContent as { error?: { code?: unknown } } | undefined)
        ?.error?.code,
    ).toBe("invalid_input");

    registration.teardown();
  });
});
