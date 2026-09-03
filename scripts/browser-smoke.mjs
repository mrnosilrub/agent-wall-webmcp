import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import puppeteer from "puppeteer-core";

const root = process.cwd();
const port = 4174;
const origin = `http://127.0.0.1:${port}`;
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const preview = spawn(
  process.execPath,
  [join(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"] },
);
let previewLog = "";
preview.stdout.on("data", (chunk) => {
  previewLog += String(chunk);
});
preview.stderr.on("data", (chunk) => {
  previewLog += String(chunk);
});

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {
      // Retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite preview failed to start: ${previewLog}`);
}

const demoProgram = {
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
};

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--enable-features=WebMCP"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
  const errors = [];
  const requests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(origin, { waitUntil: "networkidle0" });

  const receipt = await page.evaluate(async (program) => {
    if (!("modelContext" in document)) throw new Error("native document.modelContext unavailable");
    const tools = await document.modelContext.getTools();
    const byName = (name) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (tool === undefined) throw new Error(`missing ${name}`);
      return tool;
    };
    const run = async (name, input) => {
      const text = await document.modelContext.executeTool(byName(name), JSON.stringify(input));
      if (text === null) throw new Error(`${name} navigated unexpectedly`);
      return JSON.parse(text);
    };
    const survey = await run("survey_wall", { x: 0, y: 0, width: 3, height: 4 });
    const invalidPreview = await run("preview_parcel", {
      x: 0,
      y: 0,
      width: 3,
      height: 4,
      program: {
        v: 1,
        background: [245, 242, 236],
        ops: [{ op: "RECT", x: 48, y: 0, w: 1, h: 1, color: [23, 23, 27] }],
      },
    });
    const invalidStage = await run("stage_parcel", {
      x: 999,
      y: 0,
      width: 2,
      height: 1,
      program,
    });
    const rejectedState = {
      scenePreviewState:
        document.querySelector(".aw-wall-canvas")?.dataset.scenePreviewState ?? null,
      stageReviewHidden: document.querySelector(".aw-stage-review")?.hidden,
    };
    const preview = await run("preview_parcel", {
      x: 0,
      y: 0,
      width: 3,
      height: 4,
      program,
    });
    const stage = await run("stage_parcel", {
      x: 0,
      y: 0,
      width: 3,
      height: 4,
      program,
    });
    const inspected = await run("inspect_receipt", {
      receiptId: "fixture-receipt-0001",
    });
    return {
      names: tools.map((tool) => tool.name).sort(),
      schemaTypes: tools.map((tool) => typeof tool.inputSchema),
      survey,
      invalidPreview,
      invalidStage,
      rejectedState,
      preview,
      stage,
      inspected,
      challengeHookPresent: "__agentWallChallenge" in window,
      badge: document.querySelector(".aw-badge__text")?.textContent,
      stagedHidden: document.querySelector(".aw-chip--staged")?.hidden,
      stagedText: document.querySelector(".aw-chip--staged")?.textContent,
      stageReviewHidden: document.querySelector(".aw-stage-review")?.hidden,
      stageReviewText: document.querySelector(".aw-stage-review")?.textContent,
      stageCandidateDigest: document
        .querySelector(".aw-stage-review")
        ?.getAttribute("data-candidate-sha256"),
      scenePreviewState: document.querySelector(".aw-wall-canvas")?.dataset.scenePreviewState,
      scenePreviewSize: document.querySelector(".aw-wall-canvas")?.dataset.scenePreviewSize,
    };
  }, demoProgram);

  const expectedNames = [
    "inspect_receipt",
    "preview_parcel",
    "stage_parcel",
    "survey_wall",
  ];
  if (JSON.stringify(receipt.names) !== JSON.stringify(expectedNames)) {
    throw new Error(`unexpected native tool list: ${JSON.stringify(receipt.names)}`);
  }
  if (!receipt.schemaTypes.every((value) => value === "string")) {
    throw new Error(`native getTools schemas were not strings: ${JSON.stringify(receipt.schemaTypes)}`);
  }
  if (
    receipt.invalidPreview.error?.code !== "invalid_program" ||
    receipt.invalidStage.error?.code !== "out_of_bounds" ||
    receipt.rejectedState.scenePreviewState !== null ||
    receipt.rejectedState.stageReviewHidden !== true
  ) {
    throw new Error(`rejected WebMCP call changed presentation: ${JSON.stringify(receipt)}`);
  }
  for (const result of [receipt.survey, receipt.preview, receipt.stage, receipt.inspected]) {
    if (
      result.mode !== "fixture" ||
      result.chainId !== "84532" ||
      result.testnet !== true ||
      result.canonical !== false
    ) {
      throw new Error(`truth envelope mismatch: ${JSON.stringify(result)}`);
    }
  }
  if (receipt.preview.pixels !== 12 || receipt.preview.priceUsdc !== 12) {
    throw new Error("preview math mismatch");
  }
  if (
    receipt.stage.stage.state !== "staged" ||
    receipt.stage.stage.ephemeral !== true ||
    receipt.stage.stage.presentation !== "EPHEMERAL / NOT PURCHASED"
  ) {
    throw new Error("stage presentation contract mismatch");
  }
  if (
    receipt.challengeHookPresent ||
    receipt.stagedHidden !== false ||
    !receipt.stagedText?.includes("expires")
  ) {
    throw new Error("stage was not applied to transient page state");
  }
  if (
    receipt.stageReviewHidden !== false ||
    typeof receipt.stageCandidateDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(receipt.stageCandidateDigest) ||
    !/EPHEMERAL\s*\/\s*NOT PURCHASED/i.test(receipt.stageReviewText ?? "") ||
    !/TESTNET/i.test(receipt.stageReviewText ?? "") ||
    !/chain 84532/i.test(receipt.stageReviewText ?? "") ||
    !/candidate digest/i.test(receipt.stageReviewText ?? "") ||
    !/scene digest/i.test(receipt.stageReviewText ?? "") ||
    !/expires/i.test(receipt.stageReviewText ?? "") ||
    !/NO HOLD/i.test(receipt.stageReviewText ?? "")
  ) {
    throw new Error(`stage review panel is incomplete: ${JSON.stringify(receipt)}`);
  }
  if (receipt.scenePreviewState !== "staged" || receipt.scenePreviewSize !== "48x64") {
    throw new Error(`compiled Scene was not painted: ${JSON.stringify(receipt)}`);
  }
  if (receipt.badge !== "WebMCP · connected") {
    throw new Error(`WebMCP badge mismatch: ${receipt.badge}`);
  }

  mkdirSync("/tmp", { recursive: true });
  await page.screenshot({ path: "/tmp/agentwall-browser-smoke.png", fullPage: true });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Clear local stage",
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing local stage clear control");
    button.click();
  });
  const afterCancel = await page.evaluate(() => ({
    stagedHidden: document.querySelector(".aw-chip--staged")?.hidden,
    stageReviewHidden: document.querySelector(".aw-stage-review")?.hidden,
    scenePreviewState: document.querySelector(".aw-wall-canvas")?.dataset.scenePreviewState,
  }));
  if (
    afterCancel.stagedHidden !== true ||
    afterCancel.stageReviewHidden !== true ||
    afterCancel.scenePreviewState !== undefined
  ) {
    throw new Error(`cancel did not clear local stage: ${JSON.stringify(afterCancel)}`);
  }
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Run stage_parcel",
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing stage_parcel button");
    button.click();
  });
  await page.waitForFunction(
    () => document.querySelector(".aw-stage-review")?.hidden === false,
    { timeout: 2_000 },
  );
  const bfcacheProbe = await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    return {
      toolCount: (await document.modelContext.getTools()).length,
      stageReviewVisible: document.querySelector(".aw-stage-review")?.hidden === false,
    };
  });
  if (bfcacheProbe.toolCount !== 4 || !bfcacheProbe.stageReviewVisible) {
    throw new Error(`bfcache-safe pagehide failed: ${JSON.stringify(bfcacheProbe)}`);
  }
  await page.reload({ waitUntil: "networkidle0" });
  const afterReload = await page.evaluate(async () => ({
    toolCount: (await document.modelContext.getTools()).length,
    challengeHookPresent: "__agentWallChallenge" in window,
    stagedHidden: document.querySelector(".aw-chip--staged")?.hidden,
  }));
  if (
    afterReload.toolCount !== 4 ||
    afterReload.challengeHookPresent ||
    afterReload.stagedHidden !== true
  ) {
    throw new Error(`reload did not clear transient state: ${JSON.stringify(afterReload)}`);
  }
  const zoomBefore = await page.$eval(".aw-zoom", (element) => element.textContent);
  for (let step = 0; step < 3; step += 1) {
    await page.click('button[aria-label="Zoom in"]');
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  const zoomAfter = await page.$eval(".aw-zoom", (element) => element.textContent);
  if (zoomBefore === zoomAfter) throw new Error("three-step zoom did not change the Wall view");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Full wall",
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("missing Full wall control");
    button.click();
  });
  for (const width of [701, 700]) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const layout = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: window.innerWidth,
      canvasPresent: document.querySelector(".aw-wall-canvas") instanceof HTMLCanvasElement,
    }));
    if (!layout.canvasPresent || layout.bodyWidth > layout.viewportWidth) {
      throw new Error(`${width}px responsive layout overflowed: ${JSON.stringify(layout)}`);
    }
  }
  if (requests.some((url) => new URL(url).origin !== origin || new URL(url).pathname === "/mcp")) {
    throw new Error(`browser tools performed unexpected network I/O: ${JSON.stringify(requests)}`);
  }
  if (errors.length > 0) throw new Error(`browser errors: ${JSON.stringify(errors)}`);

  await browser.close();
  browser = undefined;

  const fallbackBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-features=WebMCP"],
  });
  const fallbackPage = await fallbackBrowser.newPage();
  await fallbackPage.goto(origin, { waitUntil: "networkidle0" });
  const fallback = await fallbackPage.evaluate(async () => {
    const badge = document.querySelector(".aw-badge__text")?.textContent;
    const previewButton = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Run preview_parcel",
    );
    if (!(previewButton instanceof HTMLButtonElement)) throw new Error("missing fallback preview button");
    previewButton.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      modelContextPresent: "modelContext" in document,
      badge,
      quoteHidden: document.querySelector(".aw-quote")?.hidden,
    };
  });
  await fallbackBrowser.close();
  if (fallback.modelContextPresent || fallback.badge !== "WebMCP · not available" || fallback.quoteHidden) {
    throw new Error(`fallback mismatch: ${JSON.stringify(fallback)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      nativeWebMcp: true,
      toolCount: expectedNames.length,
      rejectedCallsFailClosed: true,
      stageCancelledLocally: true,
      stageClearedOnReload: true,
      zoomAndBreakpoints: [701, 700],
      fallbackWithoutWebMcp: true,
      unexpectedNetworkWrites: 0,
      screenshot: "/tmp/agentwall-browser-smoke.png",
    }),
  );
} finally {
  if (browser !== undefined) await browser.close().catch(() => undefined);
  if (preview.pid !== undefined) {
    try {
      process.kill(-preview.pid, "SIGTERM");
    } catch {
      preview.kill("SIGTERM");
    }
  }
}
