import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ignored = new Set([".git", "node_modules", ".wrangler", "coverage"]);
const forbiddenPathParts = new Set([".private", ".scratch"]);
const allowedFiles = new Set([
  ".gitignore",
  "ARCHITECTURE.md",
  "LICENSE",
  "PRIOR_WORK.md",
  "README.md",
  "SECURITY.md",
  "index.html",
  "package-lock.json",
  "package.json",
  "projection-manifest.json",
  "tsconfig.json",
  "vite.config.ts",
  "wrangler.toml",
  "contracts/AgentWallParcelDeed.sol",
  "public/favicon.svg",
  "scripts/browser-smoke.mjs",
  "scripts/mcp-http-smoke.mjs",
  "scripts/scrub.mjs",
  "src/domain/pricing.ts",
  "src/domain/scene-v1-canonical.ts",
  "src/domain/scene-v1-compile.ts",
  "src/domain/scene-v1-format.ts",
  "src/domain/scene-v1-plan.ts",
  "src/domain/scene-v1-predicate.ts",
  "src/domain/scene-v1-program.ts",
  "src/domain/scene.ts",
  "src/fixtures/challenge.ts",
  "src/main.ts",
  "src/mcp/server.ts",
  "src/mcp/worker-boundary.ts",
  "src/tools/contracts.ts",
  "src/tools/handlers.ts",
  "src/web/css-modules.d.ts",
  "src/web/fixture.ts",
  "src/web/styles.css",
  "src/web/view.ts",
  "src/web/wall-canvas.ts",
  "src/web/webmcp.ts",
  "src/worker.ts",
  "tests/contracts.test.ts",
  "tests/kernel.test.ts",
  "tests/mcp.test.ts",
  "tests/parity.test.ts",
  "tests/release-gate.test.ts",
  "tests/webmcp.test.ts",
  "tests/worker.test.ts",
]);
const allowedDirectories = new Set([
  "contracts",
  "dist",
  "dist/assets",
  "public",
  "scripts",
  "src",
  "src/domain",
  "src/fixtures",
  "src/mcp",
  "src/tools",
  "src/web",
  "tests",
]);
const textExtensions = new Set([
  "", ".css", ".html", ".js", ".json", ".map", ".md", ".mjs", ".sol", ".svg", ".toml", ".ts", ".txt", ".yml", ".yaml",
]);
const contentRules = [
  ["absolute-user-path", /\/Users\/[A-Za-z0-9._-]+\//],
  ["file-uri", /file:\/\//i],
  ["credential-field", /\b(?:authorityEvidence|PRIVATE_KEY|SECRET_KEY|API_TOKEN|DATABASE_ID|account_id)\b/],
  ["private-origin", /\bagentwall\.(?:lol|art)\b/i],
  ["rpc-endpoint", /https?:\/\/[^\s"']*(?:rpc|alchemy|infura|quicknode)[^\s"']*/i],
  ["internal-operator", /\b(?:dolores|mervis|photon|ottoman)\b/i],
  ["private-overlay-path", /(?:^|["'`\s])\.(?:private|scratch)[/\\]/m],
  ["private-key-block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["known-token-prefix", /\b(?:gh[pousr]_|github_pat_|AKIA|ASIA|xox[baprs]-|sk-(?:live|proj|test)-)[A-Za-z0-9_-]{12,}/],
  ["bearer-credential", /\bAuthorization\s*[:=]\s*["'`]Bearer\s+[A-Za-z0-9._~+/-]{16,}/i],
  ["secret-assignment", /\b(?:password|passwd|client_secret|access_token|auth_token)\b\s*[:=]\s*["'`][^"'`\s]{8,}/i],
];
const browserNetworkRule = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/;
const findings = [];
const files = [];
const requireBuild = process.env["AGENT_WALL_REQUIRE_BUILD"] === "1";

if (requireBuild && !existsSync(join(root, "dist"))) {
  findings.push("dist: required production bundle is missing");
}

function allowedFile(rel) {
  return (
    allowedFiles.has(rel) ||
    rel === "dist/index.html" ||
    rel === "dist/favicon.svg" ||
    /^dist\/assets\/index-[A-Za-z0-9_-]+\.(?:css|js|js\.map)$/.test(rel)
  );
}

function scanText(label, text) {
  for (const [findingLabel, pattern] of contentRules) {
    if (pattern.test(text)) findings.push(`${label}: ${findingLabel}`);
  }
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const absolute = join(directory, entry);
    const rel = relative(root, absolute).split(sep).join("/");
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) {
      findings.push(`${rel}: symbolic links are forbidden`);
      continue;
    }
    if (stats.isDirectory()) {
      if (!allowedDirectories.has(rel)) findings.push(`${rel}: outside positive release allowlist`);
      if (forbiddenPathParts.has(entry)) findings.push(`${rel}: forbidden directory`);
      walk(absolute);
    } else if (stats.isFile()) {
      if (!allowedFile(rel)) findings.push(`${rel}: outside positive release allowlist`);
      if (entry === ".env" || entry.startsWith(".env.")) findings.push(`${rel}: forbidden environment file`);
      files.push(rel);
    }
  }
}
walk(root);
if (requireBuild && files.filter((rel) => rel.startsWith("dist/")).length < 5) {
  findings.push("dist: production bundle is incomplete");
}

for (const rel of files) {
  if (!textExtensions.has(extname(rel)) || rel === ".gitignore" || rel === "scripts/scrub.mjs") continue;
  const text = readFileSync(join(root, rel), "utf8");
  scanText(rel, text);
  if ((rel === "src/main.ts" || rel.startsWith("src/tools/") || rel.startsWith("src/web/")) && browserNetworkRule.test(text)) {
    findings.push(`${rel}: challenge browser/kernel code must be network-free`);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dependencyNames = Object.keys({ ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) });
for (const name of dependencyNames) {
  if (/stripe|crossmint|payment|wallet/i.test(name)) findings.push(`package.json: forbidden payment dependency ${name}`);
}

const manifest = JSON.parse(readFileSync(join(root, "projection-manifest.json"), "utf8"));
const expectedProjectionPaths = [
  "contracts/AgentWallParcelDeed.sol",
  "src/domain/pricing.ts",
  "src/domain/scene-v1-canonical.ts",
  "src/domain/scene-v1-compile.ts",
  "src/domain/scene-v1-format.ts",
  "src/domain/scene-v1-plan.ts",
  "src/domain/scene-v1-predicate.ts",
  "src/domain/scene-v1-program.ts",
  "src/domain/scene.ts",
].sort();
const manifestPaths = manifest.entries.map((entry) => entry.path).sort();
if (JSON.stringify(manifestPaths) !== JSON.stringify(expectedProjectionPaths)) {
  findings.push("projection-manifest.json: projection path set differs from the frozen positive allowlist");
}
for (const entry of manifest.entries) {
  const bytes = readFileSync(join(root, entry.path));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) findings.push(`${entry.path}: differs from allowlisted projection hash`);
}

let historyRevisions = 0;
let historyFiles = 0;
const gitHistoryScanned = existsSync(join(root, ".git"));
if (gitHistoryScanned) {
  try {
    const status = execFileSync("git", ["status", "--porcelain=v1", "--ignored=no"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (/^(?:\?\?|[ MADRCU]{2})\s+(?:\.env|\.private|\.scratch)(?:\/|$)/m.test(status)) {
      findings.push("git status: forbidden private/environment path is visible");
    }
    const revisions = execFileSync("git", ["rev-list", "--all"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().split("\n").filter(Boolean);
    for (const revision of revisions) {
      const tree = execFileSync("git", ["ls-tree", "-r", "-z", revision], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const record of tree.split("\0").filter(Boolean)) {
        const separator = record.indexOf("\t");
        const metadata = record.slice(0, separator).split(" ");
        const rel = record.slice(separator + 1);
        historyFiles += 1;
        if (!allowedFile(rel)) {
          findings.push(`git:${revision.slice(0, 12)}:${rel}: outside positive release allowlist`);
        }
        if (metadata[0] === "120000" || metadata[1] !== "blob") {
          findings.push(`git:${revision.slice(0, 12)}:${rel}: non-regular files are forbidden`);
          continue;
        }
        if (!textExtensions.has(extname(rel)) || rel === ".gitignore" || rel === "scripts/scrub.mjs") {
          continue;
        }
        const text = execFileSync("git", ["show", `${revision}:${rel}`], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        });
        scanText(`git:${revision.slice(0, 12)}:${rel}`, text);
      }
      historyRevisions += 1;
    }
  } catch {
    findings.push("git history scan failed closed");
  }
}

if (findings.length > 0) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  scannedFiles: files.length,
  projectionEntries: manifest.entries.length,
  gitHistoryScanned,
  historyRevisions,
  historyFiles,
}));
