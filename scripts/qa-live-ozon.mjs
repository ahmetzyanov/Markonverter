#!/usr/bin/env node

import { chromium } from "playwright";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(repoRoot, "dist");
const settingsKey = "markonverter.settings";
const panelStateKey = "markonverter.panelState";
const timeoutMs = Number(process.env.OZON_QA_TIMEOUT_MS || 20_000);
const defaultSettings = {
  defaultCurrency: "RUB",
  currencyRateProvider: "cbr",
  ratesToRub: { RUB: 1, KZT: 0.17 },
  pickupPoints: [],
  comparisonPickupPointIds: null,
  manualQuotes: {}
};

const blockedTextRe =
  /(?:\b403\b|похоже,\s*нет\s*соединения|нет\s*соединения|access\s+denied|captcha|verify\s+you\s+are\s+human|antibot|robot)/i;

if (isDirectRun()) {
  await main();
}

async function main() {
  const options = parseArgs(process.argv.slice(2), process.env);
  if (options.help || !options.url) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  if (!existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("dist/manifest.json is missing. Run npm run build before live Ozon QA.");
  }

  const productUrl = normalizedOzonProductUrl(options.url);
  const temporaryProfile = !options.userDataDir;
  const userDataDir = options.userDataDir || mkdtempSync(path.join(tmpdir(), "markonverter-live-ozon-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1365, height: 900 },
      timeout: timeoutMs,
      ...(options.browserChannel ? { channel: options.browserChannel } : {}),
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });
    context.setDefaultTimeout(timeoutMs);
    await installTrustedSessionState(context, productUrl, options);

    const worker = await waitForExtensionWorker(context);
    const extensionId = new URL(worker.url()).host;
    await seedPanelState(worker);

    const page = context.pages()[0] || (await context.newPage());
    const response = await page.goto(productUrl.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    const result = await inspectLiveOzonPage(page, response);
    result.extensionId = extensionId;
    result.cookiesImported = options.cookiePath || options.storageStatePath ? true : false;
    result.browser = options.browserChannel || options.executablePath || "playwright-chromium";

    if (result.blocked) {
      await maybeWriteScreenshot(page, options.screenshotPath);
      console.error(
        [
          "LIVE_OZON_BLOCKED",
          `status=${result.status ?? "unknown"}`,
          `browser=${result.browser}`,
          `cookiesImported=${result.cookiesImported}`,
          `url=${result.finalUrl}`,
          `title=${JSON.stringify(result.title)}`,
          `reason=${JSON.stringify(result.blockReason)}`
        ].join(" ")
      );
      process.exitCode = options.blockedOk ? 0 : 2;
      return;
    }

    if (!result.panelAttached) {
      await maybeWriteScreenshot(page, options.screenshotPath);
      console.error(
        [
          "LIVE_OZON_PANEL_MISSING",
          `status=${result.status ?? "unknown"}`,
          `browser=${result.browser}`,
          `url=${result.finalUrl}`,
          `title=${JSON.stringify(result.title)}`,
          `body=${JSON.stringify(trimForLog(result.bodyText))}`
        ].join(" ")
      );
      process.exitCode = 1;
      return;
    }

    const captureCheck = options.captureCheck ? await verifyCurrentPickupCapture(page, worker, productUrl.href) : null;

    console.log(
      [
        "LIVE_OZON_OK",
        `status=${result.status ?? "unknown"}`,
        `browser=${result.browser}`,
        `extension=${result.extensionId}`,
        `panel=attached`,
        `capture=${captureCheck ? "ok" : "skipped"}`,
        `url=${result.finalUrl}`,
        `title=${JSON.stringify(result.title)}`,
        ...(captureCheck
          ? [
              `capturedQuotes=${captureCheck.manualQuoteKeys.length}`,
              `capturedPrice=${JSON.stringify(captureCheck.capturedPrice || "")}`
            ]
          : []),
        `panelText=${JSON.stringify(trimForLog(captureCheck?.panelText || result.panelText))}`
      ].join(" ")
    );
  } finally {
    if (!options.keepOpen) {
      await context?.close().catch(() => undefined);
    }
    if (temporaryProfile && !options.keepProfile) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
}

function parseArgs(args, env) {
  const options = {
    url: env.OZON_QA_URL || "",
    cookiePath: env.OZON_QA_COOKIES || "",
    storageStatePath: env.OZON_QA_STORAGE_STATE || "",
    userDataDir: env.OZON_QA_USER_DATA_DIR || "",
    browserChannel: env.OZON_QA_BROWSER_CHANNEL || "",
    executablePath: env.OZON_QA_EXECUTABLE_PATH || "",
    screenshotPath: env.OZON_QA_SCREENSHOT || "",
    keepOpen: env.OZON_QA_KEEP_OPEN === "1",
    keepProfile: env.OZON_QA_KEEP_PROFILE === "1",
    blockedOk: env.OZON_QA_BLOCKED_OK === "1",
    captureCheck: env.OZON_QA_CAPTURE_CHECK === "1",
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equalsIndex = arg.indexOf("=");
    const name = equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg;
    const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : undefined;
    const nextValue = inlineValue ?? args[index + 1];
    const consumeNext = inlineValue === undefined;

    switch (name) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--url":
        options.url = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--cookies":
        options.cookiePath = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--storage-state":
        options.storageStatePath = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--user-data-dir":
        options.userDataDir = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--browser-channel":
        options.browserChannel = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--executable-path":
        options.executablePath = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--screenshot":
        options.screenshotPath = nextValue || "";
        if (consumeNext) index += 1;
        break;
      case "--keep-open":
        options.keepOpen = true;
        break;
      case "--keep-profile":
        options.keepProfile = true;
        break;
      case "--blocked-ok":
        options.blockedOk = true;
        break;
      case "--capture-check":
        options.captureCheck = true;
        break;
      default:
        if (!arg.startsWith("-") && !options.url) {
          options.url = arg;
        } else {
          throw new Error(`Unknown live Ozon QA option: ${arg}`);
        }
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage:
  OZON_QA_URL="https://www.ozon.kz/product/..." npm run qa:ozon:live
  npm run qa:ozon:live -- --url "https://www.ozon.kz/product/..." --cookies /path/ozon-cookies.json

Optional:
  --cookies PATH          Cookie-Editor JSON, Playwright storageState JSON, Netscape cookies.txt, or a Cookie header file.
  --storage-state PATH    Playwright storageState JSON. Cookies and matching localStorage are imported.
  --browser-channel NAME  Playwright channel, for example "chrome".
  --executable-path PATH  Browser executable path when a channel is not enough.
  --user-data-dir PATH    Dedicated test profile directory. Do not point this at a profile currently open in a browser.
  --screenshot PATH       Save a screenshot on blocked or panel-missing results.
  --blocked-ok            Exit 0 when Ozon returns an antibot/no-connection page.
  --capture-check         In a test profile, verify detected-point Save and reload auto-capture store a quote.
  --keep-open             Leave the browser open for manual inspection.
`);
}

function normalizedOzonProductUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!isOzonHost(url.hostname) || !/^\/product\//i.test(url.pathname)) {
    throw new Error(`Live Ozon QA needs an Ozon product URL, got: ${rawUrl}`);
  }
  return url;
}

function isOzonHost(hostname) {
  return hostname === "ozon.ru" || hostname.endsWith(".ozon.ru") || hostname === "ozon.kz" || hostname.endsWith(".ozon.kz");
}

async function installTrustedSessionState(context, productUrl, options) {
  const statePath = options.storageStatePath || options.cookiePath;
  if (!statePath) {
    return;
  }

  const state = loadSessionState(statePath, productUrl);
  if (state.cookies.length > 0) {
    await context.addCookies(state.cookies);
  }
  if (state.origins.length > 0) {
    await context.addInitScript(
      ({ origins }) => {
        const localStorageItems = origins.find((item) => item.origin === location.origin)?.localStorage || [];
        for (const entry of localStorageItems) {
          localStorage.setItem(entry.name, entry.value);
        }
      },
      { origins: state.origins }
    );
  }
}

function loadSessionState(filePath, productUrl) {
  const rawText = readFileSync(filePath, "utf8").trim();
  if (!rawText) {
    return { cookies: [], origins: [] };
  }

  if (looksLikeJson(rawText)) {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return { cookies: normalizeCookieList(parsed, productUrl), origins: [] };
    }
    if (Array.isArray(parsed.cookies) || Array.isArray(parsed.origins)) {
      return {
        cookies: normalizeCookieList(parsed.cookies || [], productUrl),
        origins: normalizeOrigins(parsed.origins || [], productUrl)
      };
    }
    if (Array.isArray(parsed.data)) {
      return { cookies: normalizeCookieList(parsed.data, productUrl), origins: [] };
    }
    throw new Error(`Unsupported JSON cookie file shape: ${filePath}`);
  }

  const netscapeCookies = parseNetscapeCookies(rawText, productUrl);
  if (netscapeCookies.length > 0) {
    return { cookies: netscapeCookies, origins: [] };
  }

  return { cookies: parseCookieHeader(rawText, productUrl), origins: [] };
}

function looksLikeJson(text) {
  return text.startsWith("{") || text.startsWith("[");
}

function normalizeCookieList(items, productUrl) {
  return items.map((item) => normalizeCookie(item, productUrl)).filter(Boolean);
}

function normalizeCookie(item, productUrl) {
  if (!item || typeof item.name !== "string") {
    return null;
  }
  const cookie = {
    name: item.name,
    value: String(item.value ?? ""),
    path: item.path || "/",
    httpOnly: Boolean(item.httpOnly),
    secure: Boolean(item.secure),
    sameSite: normalizeSameSite(item.sameSite)
  };
  const expires = item.expires ?? item.expirationDate ?? item.expiry;
  if (Number.isFinite(Number(expires)) && Number(expires) > 0) {
    cookie.expires = Number(expires);
  }
  if (typeof item.domain === "string" && item.domain.trim()) {
    cookie.domain = item.domain.trim();
  } else {
    cookie.url = productUrl.origin;
  }
  return cookie;
}

function normalizeSameSite(value) {
  const normalized = String(value || "Lax").toLowerCase().replace(/[_\s-]+/g, "");
  if (normalized === "strict") return "Strict";
  if (normalized === "none" || normalized === "norestriction" || normalized === "no_restriction") return "None";
  return "Lax";
}

function normalizeOrigins(items, productUrl) {
  return items
    .filter((item) => item && item.origin === productUrl.origin && Array.isArray(item.localStorage))
    .map((item) => ({
      origin: item.origin,
      localStorage: item.localStorage
        .filter((entry) => entry && typeof entry.name === "string" && typeof entry.value === "string")
        .map((entry) => ({ name: entry.name, value: entry.value }))
    }));
}

function parseNetscapeCookies(text, productUrl) {
  const cookies = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") && !trimmed.startsWith("#HttpOnly_")) {
      continue;
    }
    const httpOnly = trimmed.startsWith("#HttpOnly_");
    const normalized = httpOnly ? trimmed.replace(/^#HttpOnly_/, "") : trimmed;
    const parts = normalized.split(/\t/);
    if (parts.length !== 7) {
      continue;
    }
    const [domain, _includeSubdomains, cookiePath, secure, expires, name, value] = parts;
    if (!domain.includes("ozon.")) {
      continue;
    }
    cookies.push({
      name,
      value,
      domain,
      path: cookiePath || "/",
      secure: /^true$/i.test(secure),
      httpOnly,
      sameSite: "Lax",
      ...(Number(expires) > 0 ? { expires: Number(expires) } : {})
    });
  }
  if (cookies.length > 0) {
    return cookies;
  }
  if (text.includes("\t")) {
    throw new Error("No Ozon cookies were found in Netscape cookies.txt input.");
  }
  return [];
}

function parseCookieHeader(text, productUrl) {
  const source = text.replace(/^cookie:\s*/i, "").trim();
  const cookies = source
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        return null;
      }
      return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
        url: productUrl.origin,
        path: "/",
        secure: productUrl.protocol === "https:",
        httpOnly: false,
        sameSite: "Lax"
      };
    })
    .filter(Boolean);
  if (cookies.length === 0) {
    throw new Error("Cookie input did not contain any usable cookies.");
  }
  return cookies;
}

async function waitForExtensionWorker(browserContext) {
  const existing = browserContext.serviceWorkers().find((worker) => worker.url().endsWith("/background.js"));
  if (existing) {
    return existing;
  }
  const worker = await browserContext.waitForEvent("serviceworker", { timeout: timeoutMs });
  if (!worker.url().endsWith("/background.js")) {
    throw new Error(`Unexpected extension service worker: ${worker.url()}`);
  }
  return worker;
}

async function seedPanelState(worker) {
  await chromeStorageSet(worker, {
    [panelStateKey]: { collapsed: false }
  });
  const settings = await chromeStorageGet(worker, settingsKey);
  if (!settings) {
    return;
  }
  await chromeStorageSet(worker, {
    [settingsKey]: settings,
    [panelStateKey]: { collapsed: false }
  });
}

async function verifyCurrentPickupCapture(page, worker, productUrl) {
  await chromeStorageSet(worker, {
    [settingsKey]: defaultSettings,
    [panelStateKey]: { collapsed: false }
  });
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.locator("#markonverter-panel-root").waitFor({ state: "attached", timeout: timeoutMs });
  await waitForPanelText(page, /New pickup points/i, "detected current pickup point");

  await clickPanelButton(page, "Save");
  const savedSettings = await waitForSettingsCondition(
    worker,
    (settings) => (settings.pickupPoints || []).length > 0 && Object.keys(settings.manualQuotes || {}).length > 0,
    "detected pickup quote capture"
  );

  await chromeStorageSet(worker, {
    [settingsKey]: {
      ...savedSettings,
      manualQuotes: {}
    }
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.locator("#markonverter-panel-root").waitFor({ state: "attached", timeout: timeoutMs });

  const recapturedSettings = await waitForSettingsCondition(
    worker,
    (settings) => Object.keys(settings.manualQuotes || {}).length > 0,
    "reload current pickup quote capture"
  );
  const manualQuoteEntries = Object.entries(recapturedSettings.manualQuotes || {});
  const firstQuote = manualQuoteEntries[0]?.[1]?.quote;

  return {
    manualQuoteKeys: manualQuoteEntries.map(([key]) => key),
    capturedPrice: firstQuote ? `${firstQuote.rawText || firstQuote.amount} ${firstQuote.currency}` : "",
    panelText: await livePanelText(page)
  };
}

async function waitForSettingsCondition(worker, predicate, label) {
  const deadline = Date.now() + timeoutMs;
  let current = null;
  while (Date.now() < deadline) {
    current = await chromeStorageGet(worker, settingsKey);
    if (predicate(current || {})) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}. Current settings: ${JSON.stringify(redactSettingsForLog(current), null, 2)}`);
}

async function waitForPanelText(page, matcher, label) {
  const deadline = Date.now() + timeoutMs;
  let current = "";
  while (Date.now() < deadline) {
    current = await livePanelText(page);
    if (matcher.test(current)) {
      return current;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${label}. Current panel text: ${trimForLog(current)}`);
}

async function livePanelText(page) {
  return page
    .locator("#markonverter-panel-root")
    .evaluate((host) => host.shadowRoot?.querySelector(".panel")?.textContent || "")
    .catch(() => "");
}

async function clickPanelButton(page, label) {
  await page.locator("#markonverter-panel-root").evaluate((host, buttonLabel) => {
    const buttons = Array.from(host.shadowRoot?.querySelectorAll("button") || []);
    const button = buttons.find(
      (item) => (item.textContent || "").trim() === buttonLabel || (item.textContent || "").includes(buttonLabel)
    );
    if (!button) {
      throw new Error(`Button not found: ${buttonLabel}. Buttons: ${buttons.map((item) => (item.textContent || "").trim()).join("|")}`);
    }
    button.click();
  }, label);
}

function redactSettingsForLog(settings) {
  if (!settings || typeof settings !== "object") {
    return settings;
  }
  return {
    pickupPoints: (settings.pickupPoints || []).map((point) => ({
      id: point.id,
      name: point.name,
      marketplace: point.marketplace,
      country: point.country,
      currency: point.currency,
      externalLocationId: point.externalLocationId
    })),
    manualQuoteKeys: Object.keys(settings.manualQuotes || {}),
    comparisonPickupPointIds: settings.comparisonPickupPointIds || null
  };
}

async function chromeStorageSet(worker, value) {
  await worker.evaluate((stored) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(stored, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(undefined);
      });
    });
  }, value);
}

async function chromeStorageGet(worker, key) {
  return worker.evaluate((storageKey) => {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(storageKey, (result) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(result[storageKey]);
      });
    });
  }, key);
}

async function inspectLiveOzonPage(page, response) {
  const status = response?.status() ?? null;
  const finalUrl = page.url();
  const title = await page.title().catch(() => "");
  const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const blockReason = detectBlocked(status, title, bodyText);
  const panelLocator = page.locator("#markonverter-panel-root");
  const panelAttached = blockReason ? false : await panelLocator.waitFor({ state: "attached", timeout: 8_000 }).then(() => true, () => false);
  const panelText = panelAttached
    ? await panelLocator.evaluate((host) => host.shadowRoot?.querySelector(".panel")?.textContent || "").catch(() => "")
    : "";

  return {
    status,
    finalUrl,
    title,
    bodyText,
    blocked: Boolean(blockReason),
    blockReason,
    panelAttached,
    panelText
  };
}

function detectBlocked(status, title, bodyText) {
  const combined = `${status ?? ""}\n${title}\n${bodyText}`;
  if (status === 403) {
    return trimForLog(bodyText || title || "HTTP 403");
  }
  if (blockedTextRe.test(combined)) {
    return trimForLog(combined);
  }
  return "";
}

async function maybeWriteScreenshot(page, screenshotPath) {
  if (!screenshotPath) {
    return;
  }
  mkdirSync(path.dirname(path.resolve(screenshotPath)), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.error(`LIVE_OZON_SCREENSHOT path=${path.resolve(screenshotPath)}`);
}

function trimForLog(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function isDirectRun() {
  return import.meta.url === pathToFileURL(process.argv[1] || "").href;
}

export {
  loadSessionState,
  normalizeCookieList,
  normalizeCookie,
  normalizeOrigins,
  parseArgs,
  parseCookieHeader,
  parseNetscapeCookies
};
