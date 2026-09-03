import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const ignored = new Set([".git", "node_modules", "dist", ".wrangler", "coverage"]);
const forbiddenPathParts = new Set([".private", ".scratch"]);
const textExtensions = new Set([
  "", ".css", ".html", ".json", ".md", ".mjs", ".sol", ".toml", ".ts", ".yml", ".yaml",
]);
const contentRules = [
  ["credential-field", /\b(?:authorityEvidence|PRIVATE_KEY|SECRET_KEY|API_TOKEN|DATABASE_ID|account_id)\b/],
  ["private-origin", /\bagentwall\.(?:lol|art)\b/i],
  ["rpc-endpoint", /https?:\/\/[^\s"']*(?:rpc|alchemy|infura|quicknode)[^\s"']*/i],
  ["internal-operator", /\b(?:dolores|mervis|photon|ottoman)\b/i],
  ["private-overlay-path", /(?:^|["'`\s])\.(?:private|scratch)[/\\]/m],
];
const browserNetworkRule = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/;
const findings = [];
const files = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const absolute = join(directory, entry);
    const rel = relative(root, absolute).split(sep).join("/");
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      if (forbiddenPathParts.has(entry)) findings.push(`${rel}: forbidden directory`);
      walk(absolute);
    } else if (stats.isFile()) {
      if (entry === ".env" || entry.startsWith(".env.")) findings.push(`${rel}: forbidden environment file`);
      files.push(rel);
    }
  }
}
walk(root);

for (const rel of files) {
  if (!textExtensions.has(extname(rel)) || rel === ".gitignore" || rel === "scripts/scrub.mjs") continue;
  const text = readFileSync(join(root, rel), "utf8");
  for (const [label, pattern] of contentRules) {
    if (pattern.test(text)) findings.push(`${rel}: ${label}`);
  }
  if ((rel.startsWith("src/kernel/") || rel.startsWith("src/webmcp/")) && browserNetworkRule.test(text)) {
    findings.push(`${rel}: challenge browser/kernel code must be network-free`);
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const dependencyNames = Object.keys({ ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) });
for (const name of dependencyNames) {
  if (/stripe|crossmint|payment|wallet/i.test(name)) findings.push(`package.json: forbidden payment dependency ${name}`);
}

const manifest = JSON.parse(readFileSync(join(root, "projection-manifest.json"), "utf8"));
for (const entry of manifest.entries) {
  const bytes = readFileSync(join(root, entry.path));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== entry.sha256) findings.push(`${entry.path}: differs from allowlisted projection hash`);
}

if (files.includes(".git/config")) findings.push(".git/config: metadata leaked into file walk");
try {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--ignored=no"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (/^(?:\?\?|[ MADRCU]{2})\s+(?:\.env|\.private|\.scratch)(?:\/|$)/m.test(status)) {
    findings.push("git status: forbidden private/environment path is visible");
  }
} catch {
  // The initial pre-commit scrub is allowed to run before git initialization.
}

if (findings.length > 0) {
  console.error(JSON.stringify({ ok: false, findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, scannedFiles: files.length, projectionEntries: manifest.entries.length }));
