// Debug network-fixture capture: the page-world event feed, the buffered
// flush into chrome.storage, and the panel's fixture tools section. Panel glue
// (renderLastPanel, confirmation) comes from ./panel/render and i18n/debug
// state from ./app — the import cycles are intentional and function-level only.

import {
  appendOzonFixtureRecords,
  emptyOzonFixtureStore,
  normalizeOzonFixtureStore,
  OzonFixtureStore,
  OzonNetworkFixtureInput,
  OZON_FIXTURE_STORE_KEY
} from "../shared/ozon-fixtures";
import { isDebugModeEnabled, t } from "./app";
import { escapeHtml, renderLastPanel, requestPanelConfirmation } from "./panel/render";

const NETWORK_FIXTURE_EVENT = "markonverter:ozon-network-fixture";

let fixtureStatus: { tone: "normal" | "error"; message: string } | null = null;
let ozonFixtureCount = 0;
let fixtureFlushTimer: number | null = null;
let pendingFixtureInputs: OzonNetworkFixtureInput[] = [];

export function installOzonFixtureCapture(): void {
  document.addEventListener(NETWORK_FIXTURE_EVENT, handleNetworkFixtureEvent);
}

function handleNetworkFixtureEvent(event: Event): void {
  if (!isDebugModeEnabled()) {
    return;
  }
  const detail = (event as CustomEvent<string>).detail;
  if (!detail) {
    return;
  }
  try {
    const input = JSON.parse(detail) as OzonNetworkFixtureInput;
    if (!isNetworkFixtureInput(input)) {
      return;
    }
    pendingFixtureInputs.push(input);
    scheduleFixtureFlush();
  } catch {
    // Ignore malformed events from the page world.
  }
}

function isNetworkFixtureInput(value: unknown): value is OzonNetworkFixtureInput {
  const candidate = value as Partial<OzonNetworkFixtureInput> | undefined;
  return (
    Boolean(candidate) &&
    typeof candidate?.source === "string" &&
    typeof candidate.method === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.pageUrl === "string" &&
    typeof candidate.responseText === "string"
  );
}

function scheduleFixtureFlush(): void {
  if (fixtureFlushTimer !== null) {
    return;
  }
  fixtureFlushTimer = window.setTimeout(() => {
    fixtureFlushTimer = null;
    void flushPendingFixtures();
  }, 500);
}

async function flushPendingFixtures(): Promise<void> {
  if (pendingFixtureInputs.length === 0) {
    return;
  }
  if (!isDebugModeEnabled()) {
    pendingFixtureInputs = [];
    return;
  }
  const inputs = pendingFixtureInputs.splice(0, pendingFixtureInputs.length);
  try {
    const store = appendOzonFixtureRecords(await readOzonFixtureStore(), inputs);
    await chrome.storage.local.set({ [OZON_FIXTURE_STORE_KEY]: store });
    ozonFixtureCount = store.records.length;
    renderLastPanel();
  } catch {
    pendingFixtureInputs.unshift(...inputs);
  }
}

export function appendOzonFixtureTools(root: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.className = "fixtureTools";

  const text = document.createElement("div");
  text.className = "fixtureToolsText";
  const statusLine = fixtureStatus ? `<span class="${fixtureStatus.tone === "error" ? "fixtureError" : ""}">${escapeHtml(fixtureStatus.message)}</span>` : "";
  text.innerHTML = `<span class="eyebrow">${escapeHtml(t("fixturesEyebrow"))}</span><strong>${escapeHtml(
    t("fixturesCaptured", { count: ozonFixtureCount })
  )}</strong>${statusLine}`;

  const actions = document.createElement("div");
  actions.className = "fixtureToolsActions";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "detailsButton";
  copyButton.textContent = t("fixturesCopy");
  copyButton.title = t("fixturesCopyTitle");
  copyButton.addEventListener("click", () => {
    void copyOzonFixtures();
  });

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "deleteButton";
  clearButton.textContent = t("fixturesClear");
  clearButton.title = t("fixturesClearTitle");
  clearButton.addEventListener("click", () => {
    void clearOzonFixtures();
  });

  actions.append(copyButton, clearButton);
  wrapper.append(text, actions);
  root.append(wrapper);
}

export async function refreshOzonFixtureSummary(): Promise<void> {
  try {
    ozonFixtureCount = (await readOzonFixtureStore()).records.length;
  } catch {
    ozonFixtureCount = 0;
  }
}

async function readOzonFixtureStore(): Promise<OzonFixtureStore> {
  const stored = await chrome.storage.local.get(OZON_FIXTURE_STORE_KEY);
  return normalizeOzonFixtureStore(stored[OZON_FIXTURE_STORE_KEY]);
}

async function copyOzonFixtures(): Promise<void> {
  await flushPendingFixtures();
  const store = await readOzonFixtureStore();
  ozonFixtureCount = store.records.length;
  if (store.records.length === 0) {
    fixtureStatus = { tone: "error", message: t("fixturesNone") };
    renderLastPanel();
    return;
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(store, null, 2));
    fixtureStatus = { tone: "normal", message: t("fixturesCopied", { count: store.records.length }) };
  } catch {
    fixtureStatus = { tone: "error", message: t("fixturesClipboardBlocked") };
  }
  renderLastPanel();
}

async function clearOzonFixtures(): Promise<void> {
  if (
    ozonFixtureCount > 0 &&
    !(await requestPanelConfirmation({
      title: t("fixturesClearTitleQuestion"),
      message: t("fixturesClearMessage"),
      confirmText: t("fixturesClearConfirm"),
      danger: true
    }))
  ) {
    return;
  }
  pendingFixtureInputs = [];
  await chrome.storage.local.set({ [OZON_FIXTURE_STORE_KEY]: emptyOzonFixtureStore() });
  ozonFixtureCount = 0;
  fixtureStatus = { tone: "normal", message: t("fixturesCleared") };
  renderLastPanel();
}
