import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("release gate ordering", () => {
  it("scans both production bundles and scans the final Worker bundle again", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    const scrubSource = readFileSync(
      new URL("../scripts/scrub.mjs", import.meta.url),
      "utf8",
    );
    const steps = (packageJson.scripts?.["check"] ?? "")
      .split("&&")
      .map((step) => step.trim());
    const buildIndex = steps.indexOf("npm run build");
    const workerBuilds = steps
      .map((step, index) => (step === "npm run build:worker" ? index : -1))
      .filter((index) => index >= 0);
    const firstBundleScan = steps.indexOf("npm run scrub:bundle");

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(workerBuilds).toHaveLength(2);
    expect(workerBuilds[0]).toBeGreaterThan(buildIndex);
    expect(firstBundleScan).toBeGreaterThan(buildIndex);
    expect(firstBundleScan).toBeGreaterThan(workerBuilds[0]);
    expect(steps.at(-2)).toBe("npm run build:worker");
    expect(steps.at(-1)).toBe("npm run scrub:bundle");
    expect(scrubSource).toContain("workerBundleFiles.has(rel)");
    expect(scrubSource).toContain("JSON.stringify(observedWorkerBundleFiles)");
  });
});
