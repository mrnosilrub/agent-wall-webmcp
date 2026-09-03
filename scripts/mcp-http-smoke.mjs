import { spawn } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

const root = process.cwd();
const port = 8788;
const origin = `http://127.0.0.1:${port}`;
const worker = spawn(
  process.execPath,
  [join(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] },
);
let workerLog = "";
worker.stdout.on("data", (chunk) => {
  workerLog += String(chunk);
});
worker.stderr.on("data", (chunk) => {
  workerLog += String(chunk);
});

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return await response.json();
    } catch {
      // Retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Wrangler failed to start: ${workerLog}`);
}

let client;
try {
  const health = await waitForHealth();
  client = new Client({ name: "agent-wall-http-smoke", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`));
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  const expected = [
    "inspect_receipt",
    "preview_parcel",
    "stage_parcel",
    "survey_wall",
  ];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`unexpected HTTP tool list: ${JSON.stringify(names)}`);
  }
  const called = await client.callTool({
    name: "preview_parcel",
    arguments: {
      x: 0,
      y: 0,
      width: 3,
      height: 4,
      program: {
        v: 1,
        background: [245, 242, 236],
        ops: [{ op: "RECT", x: 0, y: 0, w: 16, h: 16, color: [23, 23, 27] }],
      },
    },
  });
  const result = called.structuredContent;
  if (
    result?.mode !== "fixture" ||
    result?.chainId !== "84532" ||
    result?.pixels !== 12 ||
    result?.priceUsdc !== 12 ||
    called.isError === true
  ) {
    throw new Error(`unexpected HTTP call result: ${JSON.stringify(called)}`);
  }
  const schemaInvalid = await client.callTool({
    name: "preview_parcel",
    arguments: {
      x: 0,
      y: 0,
      width: "3",
      height: 4,
      program: {
        v: 1,
        background: [245, 242, 236],
        ops: [],
      },
    },
  });
  const schemaErrorCode = schemaInvalid.structuredContent?.error?.code;
  if (schemaInvalid.isError !== true || schemaErrorCode !== "invalid_input") {
    throw new Error(`unexpected HTTP schema error: ${JSON.stringify(schemaInvalid)}`);
  }
  const getResponse = await fetch(`${origin}/mcp`);
  if (getResponse.status !== 405) {
    throw new Error(`GET /mcp must be 405, received ${getResponse.status}`);
  }
  const rootResponse = await fetch(origin);
  const csp = rootResponse.headers.get("content-security-policy") ?? "";
  if (
    !rootResponse.ok ||
    !(await rootResponse.text()).includes("Agent Wall") ||
    !csp.includes("default-src 'self'") ||
    !csp.includes("connect-src 'none'") ||
    rootResponse.headers.get("x-content-type-options") !== "nosniff"
  ) {
    throw new Error("worker did not serve the built challenge page");
  }
  console.log(
    JSON.stringify({
      ok: true,
      standardClient: "@modelcontextprotocol/client@2.0.0",
      toolCount: names.length,
      postOnlyMcp: true,
      schemaErrorCode,
      previewPixels: result.pixels,
      previewPriceUsdc: result.priceUsdc,
      health,
    }),
  );
} catch (error) {
  console.error(workerLog);
  throw error;
} finally {
  if (client !== undefined) await client.close().catch(() => undefined);
  if (worker.pid !== undefined) {
    try {
      process.kill(-worker.pid, "SIGTERM");
    } catch {
      worker.kill("SIGTERM");
    }
  }
}
