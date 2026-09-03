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

export interface ToolAdapter {
  getTools(): readonly ToolDescriptor[];
  executeTool(name: string, input: unknown): unknown;
}

export interface RegisteredWebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: Readonly<Record<string, boolean>>;
  execute(
    input: unknown,
    options?: { readonly signal?: AbortSignal },
  ): Promise<string>;
}

export interface ModelContextSurface {
  registerTool(
    tool: RegisteredWebMcpTool,
    options?: { readonly signal?: AbortSignal },
  ): Promise<undefined> | undefined;
}

export type ToolResultObserver = (
  name: ToolName,
  input: unknown,
  result: unknown,
) => void;

const registrations = new WeakMap<
  ModelContextSurface,
  { readonly controller: AbortController; readonly ready: Promise<void>; users: number }
>();

function registrationHandle(
  modelContext: ModelContextSurface,
  registration: { readonly controller: AbortController; users: number },
): { readonly registered: true; teardown(): void } {
  let tornDown = false;
  return {
    registered: true,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      registration.users -= 1;
      if (registration.users === 0) {
        registration.controller.abort();
        registrations.delete(modelContext);
      }
    },
  };
}

function requireToolName(name: string): ToolName {
  const tool = TOOL_CATALOG.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new ToolInputError("unknown_tool", "Unknown Agent Wall challenge tool");
  }
  return tool.name;
}

export function createWebMcpAdapter(options: HandlerOptions): ToolAdapter {
  const handlers = createHandlers(options);
  return Object.freeze({
    getTools: () => TOOL_CATALOG,
    executeTool(name: string, input: unknown) {
      const toolName = requireToolName(name);
      return handlers[toolName](input);
    },
  });
}

export async function registerWebMcpTools(options: {
  readonly document: Document & { readonly modelContext?: ModelContextSurface };
  readonly adapter: ToolAdapter;
  readonly onResult?: ToolResultObserver;
}): Promise<{ readonly registered: boolean; teardown(): void }> {
  const modelContext = options.document.modelContext;
  if (modelContext === undefined) {
    return { registered: false, teardown() {} };
  }

  const existing = registrations.get(modelContext);
  if (existing !== undefined) {
    existing.users += 1;
    await existing.ready;
    return registrationHandle(modelContext, existing);
  }

  const controller = new AbortController();
  const ready = Promise.all(
    TOOL_CATALOG.map(async (tool) => {
      const registeredTool: RegisteredWebMcpTool = {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          ...tool.annotations,
          untrustedContentHint: false,
          consequentialHint: false,
        },
        async execute(input, executeOptions) {
          if (executeOptions?.signal?.aborted === true) {
            throw executeOptions.signal.reason;
          }
          let result: unknown;
          try {
            result = options.adapter.executeTool(tool.name, input);
          } catch (error) {
            result = toolErrorPayload(error);
          }
          try {
            options.onResult?.(tool.name, input, result);
          } catch {
            // Presentation observers must never alter the browser agent's tool result.
          }
          return JSON.stringify(result);
        },
      };
      await modelContext.registerTool(registeredTool, { signal: controller.signal });
    }),
  ).then(() => undefined);

  const registration = { controller, ready, users: 1 };
  registrations.set(modelContext, registration);
  try {
    await ready;
  } catch (error) {
    controller.abort();
    registrations.delete(modelContext);
    throw error;
  }

  return registrationHandle(modelContext, registration);
}
