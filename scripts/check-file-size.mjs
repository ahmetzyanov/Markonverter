#!/usr/bin/env node
// File-size gate for src/**/*.ts: soft limit 300 counted lines (warn), hard
// limit 500 (fail). Blank lines and comment-only lines are not counted.
// ALLOWLIST holds the files that predate the gate — shrink it as they get
// split (see TODO.md "Lint Gate"), never add to it.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SOFT_LIMIT = 300;
const HARD_LIMIT = 500;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

const ALLOWLIST = new Set([
  "src/marketplaces/ozon/pickup-capture.ts",
  "src/marketplaces/ozon/private-api.ts",
  "src/content/panel/styles.ts"
]);

function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return tsFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

// ponytail: line-trim comment detection; code after "*/" on the same line or
// "//" inside template literals miscounts a little. Good enough for a gate.
function countedLines(text) {
  let inBlockComment = false;
  let count = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (inBlockComment) {
      if (line.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }
    if (line.startsWith("//")) {
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) {
        inBlockComment = true;
      }
      continue;
    }
    count += 1;
  }
  return count;
}

let failed = false;
for (const path of tsFiles(SRC).sort()) {
  const file = relative(ROOT, path).replaceAll("\\", "/");
  const lines = countedLines(readFileSync(path, "utf8"));
  if (lines > HARD_LIMIT && !ALLOWLIST.has(file)) {
    console.error(`FAIL ${file}: ${lines} lines > hard limit ${HARD_LIMIT} — split it (see TODO.md "Lint Gate")`);
    failed = true;
  } else if (lines > SOFT_LIMIT) {
    const note = ALLOWLIST.has(file) && lines > HARD_LIMIT ? " (allowlisted, shrink me)" : "";
    console.warn(`warn ${file}: ${lines} lines > soft limit ${SOFT_LIMIT}${note}`);
  }
}

process.exit(failed ? 1 : 0);
