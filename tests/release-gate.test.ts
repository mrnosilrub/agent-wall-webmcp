import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("release gate ordering", () => {
  it("builds before scanning the production bundle and scans the final bundle again", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    const steps = (packageJson.scripts?.["check"] ?? "")
      .split("&&")
      .map((step) => step.trim());
    const buildIndex = steps.indexOf("npm run build");
    const firstBundleScan = steps.indexOf("npm run scrub:bundle");

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(firstBundleScan).toBeGreaterThan(buildIndex);
    expect(steps.at(-1)).toBe("npm run scrub:bundle");
  });
});
