import { Server } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";

import {
  TOOL_CATALOG,
  ToolInputError,
  toolErrorPayload,
  type ToolDescriptor,
  type ToolName,
} from "../tools/contracts.js";
import {
  createHandlers,
  type HandlerOptions,
} from "../tools/handlers.js";

export interface RemoteMcpAdapter {
  getTools(): readonly ToolDescriptor[];
  executeTool(name: string, input: unknown): unknown;
}

function requireToolName(name: string): ToolName {
  const tool = TOOL_CATALOG.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new ToolInputError("unknown_tool", "Unknown Agent Wall challenge tool");
  }
  return tool.name;
}

export function createRemoteMcpAdapter(options: HandlerOptions): RemoteMcpAdapter {
  const handlers = createHandlers(options);
  return Object.freeze({
    getTools: () => TOOL_CATALOG,
    executeTool(name: string, input: unknown) {
      const toolName = requireToolName(name);
      return handlers[toolName](input);
    },
  });
}

export function createRemoteMcpServer(options: HandlerOptions): Server {
  const adapter = createRemoteMcpAdapter(options);
  const server = new Server(
    { name: "agent-wall-webmcp", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Fixture-only Agent Wall challenge tools. Base Sepolia 84532; stage_parcel is transient presentation and creates no order, payment, signature, or mint.",
    },
  );

  server.setRequestHandler("tools/list", async () => ({
    tools: TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema) as {
        type: "object";
        [key: string]: unknown;
      },
      annotations: tool.annotations,
    })),
  }));
  server.setRequestHandler("tools/call", async (request) => {
    try {
      const result = adapter.executeTool(
        request.params.name,
        request.params.arguments ?? {},
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      const payload = toolErrorPayload(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }
  });
  return server;
}

export function createRemoteMcpHttpHandler(options: HandlerOptions) {
  return createMcpHandler(() => createRemoteMcpServer(options), {
    route: "/mcp",
    legacy: "stateless",
    corsOptions: false,
    onerror(error) {
      console.error("fixture MCP handler error", error);
    },
  });
}
