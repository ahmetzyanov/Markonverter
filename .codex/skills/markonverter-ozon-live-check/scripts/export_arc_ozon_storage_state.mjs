#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = "/Users/gogla/PycharmProjects/markonverter";
const defaultLocalStorageDir = path.join(homedir(), "Library/Application Support/Arc/User Data/Default/Local Storage/leveldb");
const defaultCookiesPath = path.join(repoRoot, ".secrets/ozon-cookies.txt");
const defaultOutputPath = path.join(repoRoot, ".secrets/ozon-arc-storage-state.json");

const options = parseArgs(process.argv.slice(2));
const localStorageDir = path.resolve(options.localStorageDir || defaultLocalStorageDir);
const cookiesPath = path.resolve(options.cookiesPath || defaultCookiesPath);
const outputPath = path.resolve(options.outputPath || defaultOutputPath);

if (!existsSync(localStorageDir)) {
  throw new Error(`Arc localStorage LevelDB not found: ${localStorageDir}`);
}
if (!existsSync(cookiesPath)) {
  throw new Error(`Ozon cookie export not found: ${cookiesPath}`);
}

const { ClassicLevel, cleanup } = await loadClassicLevel();
try {
  const cookies = JSON.parse(readFileSync(cookiesPath, "utf8"));
  const localStorage = await readOzonLocalStorage(ClassicLevel, localStorageDir);
  const origins = [...localStorage.entries()].map(([origin, items]) => ({ origin, localStorage: items }));

  mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify({ cookies, origins }, null, 2), { mode: 0o600 });
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, outputPath);
  chmodSync(outputPath, 0o600);

  console.log(
    JSON.stringify({
      storageState: "written",
      cookies: cookies.length,
      origins: origins.map((origin) => ({
        origin: origin.origin,
        localStorage: origin.localStorage.length
      }))
    })
  );
} finally {
  cleanup();
}

async function readOzonLocalStorage(ClassicLevel, sourceDir) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "markonverter-ozon-local-storage-"));
  const dbCopy = path.join(tempDir, "leveldb");
  cpSync(sourceDir, dbCopy, { recursive: true });

  const db = new ClassicLevel(dbCopy, { keyEncoding: "buffer", valueEncoding: "buffer" });
  const origins = new Map();
  try {
    await db.open();
    for await (const [key, value] of db.iterator()) {
      const entry = decodeLocalStorageEntry(key, value);
      if (!entry) {
        continue;
      }
      if (!origins.has(entry.origin)) {
        origins.set(entry.origin, []);
      }
      origins.get(entry.origin).push({ name: entry.name, value: entry.value });
    }
  } finally {
    await db.close().catch(() => undefined);
    rmSync(tempDir, { recursive: true, force: true });
  }
  return origins;
}

function decodeLocalStorageEntry(key, value) {
  const nulIndex = key.indexOf(0);
  if (key[0] !== 0x5f || nulIndex < 0) {
    return null;
  }

  const origin = key.subarray(1, nulIndex).toString("utf8");
  if (!/^https:\/\/(?:www\.)?ozon\.(?:ru|kz)$/i.test(origin)) {
    return null;
  }

  let nameBytes = key.subarray(nulIndex + 1);
  if (nameBytes[0] === 1) {
    nameBytes = nameBytes.subarray(1);
  }

  let valueBytes = value;
  if (valueBytes[0] === 1) {
    valueBytes = valueBytes.subarray(1);
  }

  return {
    origin,
    name: nameBytes.toString("utf8"),
    value: valueBytes.toString("utf8")
  };
}

async function loadClassicLevel() {
  try {
    const loaded = await import("classic-level");
    return { ClassicLevel: loaded.ClassicLevel, cleanup: () => undefined };
  } catch {
    const dependencyDir = mkdtempSync(path.join(tmpdir(), "markonverter-classic-level-"));
    writeFileSync(path.join(dependencyDir, "package.json"), '{"private":true,"type":"module"}\n');
    execFileSync("npm", ["install", "classic-level@2", "--silent"], {
      cwd: dependencyDir,
      stdio: "ignore"
    });
    const require = createRequire(path.join(dependencyDir, "package.json"));
    const entry = require.resolve("classic-level");
    const loaded = await import(pathToFileURL(entry).href);
    return {
      ClassicLevel: loaded.ClassicLevel,
      cleanup: () => rmSync(dependencyDir, { recursive: true, force: true })
    };
  }
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [rawName, inlineValue] = arg.split(/=(.*)/s, 2);
    const value = inlineValue ?? args[index + 1];
    const consumeNext = inlineValue === undefined;
    switch (rawName) {
      case "--local-storage-dir":
        options.localStorageDir = value;
        if (consumeNext) index += 1;
        break;
      case "--cookies":
        options.cookiesPath = value;
        if (consumeNext) index += 1;
        break;
      case "--output":
        options.outputPath = value;
        if (consumeNext) index += 1;
        break;
      default:
        if (arg === "--help" || arg === "-h") {
          printUsage();
          process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printUsage() {
  console.log(`Usage: export_arc_ozon_storage_state.mjs [--cookies PATH] [--output PATH]

Build a Playwright storageState JSON for Ozon from:
- Markonverter's exported Arc Ozon cookies
- Arc localStorage entries for https://www.ozon.ru and https://ozon.kz

The script prints only counts and origin names, never localStorage values.`);
}
