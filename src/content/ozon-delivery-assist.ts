// The in-page assist injected into Ozon's native delivery selector: a status
// bar prepended to the dialog plus per-row "add pickup point" actions. DOM
// detection lives in ozon-delivery-dom.ts; panel/state glue is imported from
// app.ts — the import cycle is intentional and function-level only.

import { OzonPickupCandidate } from "../marketplaces/ozon/pickup-capture";
import { ozonCandidateDisplayName } from "../marketplaces/ozon/pickup-matching";
import { ProductIdentity } from "../shared/types";
import {
  getCurrentProduct,
  getLatestSettings,
  runIfProductPage,
  setLatestSettings,
  t
} from "./app";
import {
  discoverOzonPickupCandidatesFromApi,
  latestPickupCandidates,
  mergePickupCandidates,
  requestPagePickupCandidates
} from "./ozon-candidates";
import { autoCaptureCurrentVisibleQuote, saveDetectedPickupCandidate } from "./ozon-quote-capture";
import { MENU_ASSIST_ID, PANEL_ID } from "./ids";
import { renderLastPanel } from "./panel/render";
import { getSavedOzonExternalIds } from "./panel/sections";
import { collectOzonDeliveryRowCandidates, findOzonDeliveryContainer, OzonPickupRowCandidate } from "./ozon-delivery-dom";

const MENU_ASSIST_STYLE_ID = "markonverter-ozon-delivery-assist-style";
const PAGE_ACTION_SELECTOR = "[data-markonverter-page-action]";

let assistSyncTimer: number | null = null;
let suppressAssistObserverUntil = 0;
const pageActionHandlers = new WeakMap<HTMLElement, (event: Event) => void>();
let pageActionEventGuardInstalled = false;

export function installOzonDeliveryMenuAssist(): void {
  const sync = () => {
    if (Date.now() < suppressAssistObserverUntil) {
      return;
    }
    if (!getCurrentProduct()) {
      document.getElementById(MENU_ASSIST_ID)?.remove();
      return;
    }
    ensureOzonDeliveryMenuAssist();
  };

  sync();
  // Coalesce mutation bursts: Ozon mutates the body constantly, and sync does
  // layout-forcing DOM scans, so running it per-mutation-batch janks the page.
  let syncTimer: number | null = null;
  const scheduleSync = () => {
    if (syncTimer !== null) {
      return;
    }
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      sync();
    }, 100);
  };
  new MutationObserver(scheduleSync).observe(document.body, {
    childList: true,
    subtree: true
  });
  setInterval(sync, 1500);
}

export function scheduleOzonDeliveryAssistSync(): void {
  if (assistSyncTimer !== null) {
    return;
  }
  assistSyncTimer = window.setTimeout(() => {
    assistSyncTimer = null;
    if (getCurrentProduct()) {
      ensureOzonDeliveryMenuAssist();
    }
  }, 100);
}

export async function syncCurrentOzonDeliveryMenuAssist(): Promise<void> {
  ensureOzonDeliveryAssistStyles();
  const target = findOzonDeliveryContainer();
  const assist = document.getElementById(MENU_ASSIST_ID);
  const product = getCurrentProduct();
  if (!target || !assist || !product || assist.parentElement !== target) {
    ensureOzonDeliveryMenuAssist();
    return;
  }
  await syncOzonDeliveryMenuAssist(target, assist, product);
}

function ensureOzonDeliveryMenuAssist(): void {
  ensureOzonDeliveryAssistStyles();
  const target = findOzonDeliveryContainer();
  const existing = document.getElementById(MENU_ASSIST_ID);
  if (!target) {
    existing?.remove();
    return;
  }
  if (existing && existing.parentElement === target) {
    const product = getCurrentProduct();
    if (product) {
      void syncOzonDeliveryMenuAssist(target, existing, product);
    }
    return;
  }

  existing?.remove();
  const product = getCurrentProduct();
  if (!product) {
    return;
  }

  const assist = document.createElement("div");
  assist.id = MENU_ASSIST_ID;
  assist.setAttribute(
    "style",
    [
      "display:flex",
      "align-items:center",
      "box-sizing:border-box",
      "width:100%",
      "max-width:100%",
      "min-width:0",
      "flex-wrap:wrap",
      "gap:8px",
      "margin:8px 0",
      "padding:8px",
      "border:1px solid #dce3ee",
      "border-radius:8px",
      "background:#ffffff",
      "font:13px -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif",
      "color:#17233c",
      "overflow:hidden",
      "z-index:2147483647"
    ].join(";")
  );

  suppressOzonAssistObserver();
  target.prepend(assist);
  void syncOzonDeliveryMenuAssist(target, assist, product);
}

export function collectOzonPickupCandidatesFromDeliveryContainer(target: HTMLElement): boolean {
  requestPagePickupCandidates();
  const rows = collectOzonDeliveryRowCandidates(target, latestPickupCandidates);
  const rowCandidates = rows.flatMap((row) => (row.candidate ? [row.candidate] : []));
  if (rowCandidates.length === 0) {
    return false;
  }
  if (mergePickupCandidates(rowCandidates)) {
    renderLastPanel();
  }
  scheduleOzonDeliveryAssistSync();
  return true;
}

async function syncOzonDeliveryMenuAssist(target: HTMLElement, assist: HTMLElement, product: ProductIdentity): Promise<void> {
  requestPagePickupCandidates();
  const rows = collectOzonDeliveryRowCandidates(target, latestPickupCandidates);
  const rowCandidates = rows.flatMap((row) => (row.candidate ? [row.candidate] : []));
  if (rowCandidates.length > 0 && mergePickupCandidates(rowCandidates)) {
    renderLastPanel();
  }

  let settings = await getLatestSettings();
  const savedExternalIds = getSavedOzonExternalIds(settings);
  suppressOzonAssistObserver();
  decorateOzonDeliveryRows(target, rows, savedExternalIds, product);
  renderOzonDeliveryAssist(assist, rows, savedExternalIds);
  if (settings) {
    const updatedSettings = await autoCaptureCurrentVisibleQuote(product, settings);
    if (updatedSettings !== settings) {
      settings = updatedSettings;
      setLatestSettings(settings);
      await runIfProductPage();
    }
  }
}

function suppressOzonAssistObserver(): void {
  suppressAssistObserverUntil = Date.now() + 300;
}

function decorateOzonDeliveryRows(
  target: HTMLElement,
  rows: OzonPickupRowCandidate[],
  savedExternalIds: Set<string>,
  product: ProductIdentity
): void {
  const activeRows = new Set(rows.map((row) => row.row));
  target.querySelectorAll<HTMLElement>("[data-markonverter-pvz-action]").forEach((control) => {
    if (!control.parentElement || !activeRows.has(control.parentElement)) {
      control.parentElement?.classList.remove("markonverter-ozon-pvz-row");
      control.remove();
    }
  });

  for (const { row, candidate } of rows) {
    if (!candidate) {
      continue;
    }
    const stateKey = `${candidate.externalLocationId}:${savedExternalIds.has(candidate.externalLocationId) ? "saved" : "add"}`;
    const existing = Array.from(row.children).find(
      (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.markonverterPvzAction === "true"
    );
    if (existing?.dataset.markonverterActionState === stateKey) {
      continue;
    }
    const action = buildOzonRowAction(candidate, savedExternalIds.has(candidate.externalLocationId), product, stateKey);
    row.classList.add("markonverter-ozon-pvz-row");
    if (existing) {
      existing.replaceWith(action);
    } else {
      row.append(action);
    }
  }
}

function buildOzonRowAction(
  candidate: OzonPickupCandidate,
  isSaved: boolean,
  product: ProductIdentity,
  stateKey: string
): HTMLElement {
  const action = document.createElement("span");
  action.dataset.markonverterPvzAction = "true";
  action.dataset.markonverterActionState = stateKey;
  action.dataset.markonverterExternalLocationId = candidate.externalLocationId;
  action.className = `markonverter-ozon-pvz-action${isSaved ? " is-saved" : ""}`;
  action.textContent = isSaved ? t("assistSaved") : t("assistAdd");
  action.title = isSaved ? t("assistAlreadySavedTitle") : t("assistAddTitle", { name: ozonCandidateDisplayName(candidate) });
  action.setAttribute("role", "button");
  action.tabIndex = isSaved ? -1 : 0;
  action.setAttribute("aria-disabled", String(isSaved));
  bindGuardedPageAction(action, () => {
    if (!isSaved) {
      void saveDetectedPickupCandidate(candidate, product);
    }
  });
  return action;
}

export function markSavedPickupCandidateInPage(candidate: OzonPickupCandidate): void {
  document.querySelectorAll<HTMLElement>("[data-markonverter-pvz-action]").forEach((action) => {
    if (action.dataset.markonverterExternalLocationId !== candidate.externalLocationId) {
      return;
    }
    action.textContent = t("assistSaved");
    action.title = t("assistAlreadySavedTitle");
    action.classList.add("is-saved");
    action.dataset.markonverterActionState = `${candidate.externalLocationId}:saved`;
    if (action instanceof HTMLButtonElement) {
      action.disabled = true;
    } else {
      action.setAttribute("aria-disabled", "true");
      action.tabIndex = -1;
    }
  });
}

function renderOzonDeliveryAssist(assist: HTMLElement, rows: OzonPickupRowCandidate[], savedExternalIds: Set<string>): void {
  const identifiedRows = rows.filter((row) => row.candidate);
  const savedCount = identifiedRows.filter((row) => row.candidate && savedExternalIds.has(row.candidate.externalLocationId)).length;
  const statusText =
    rows.length > 0
      ? t("assistStatus", {
          rows: rows.length,
          saved: savedCount,
          loading: identifiedRows.length < rows.length ? t("assistStatusLoading") : ""
        })
      : t("assistListNotLoaded");
  const stateKey = `${rows.length}:${identifiedRows.length}:${savedCount}:${statusText}`;
  if (assist.dataset.markonverterAssistState === stateKey) {
    return;
  }
  assist.dataset.markonverterAssistState = stateKey;
  assist.innerHTML = "";

  const status = document.createElement("span");
  status.className = "markonverter-assist-status";
  status.textContent = statusText;

  const refreshButton = pageButton(t("assistRefreshPvz"), "secondary");
  bindGuardedPageAction(refreshButton, () => {
    requestPagePickupCandidates();
    const product = getCurrentProduct();
    if (product) {
      discoverOzonPickupCandidatesFromApi(product);
    }
    scheduleOzonDeliveryAssistSync();
  });

  const showButton = pageButton(t("assistShowInPanel"), "secondary");
  bindGuardedPageAction(showButton, () => {
    requestPagePickupCandidates();
    renderLastPanel();
    document.getElementById(PANEL_ID)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  assist.append(status, refreshButton, showButton);
}

function ensureOzonDeliveryAssistStyles(): void {
  if (document.getElementById(MENU_ASSIST_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = MENU_ASSIST_STYLE_ID;
  style.textContent = `
    .markonverter-ozon-pvz-row {
      position: relative !important;
      box-sizing: border-box !important;
    }
    .markonverter-ozon-pvz-action {
      all: initial !important;
      appearance: none !important;
      -webkit-appearance: none !important;
      box-sizing: border-box !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: absolute !important;
      right: 12px !important;
      bottom: 12px !important;
      width: auto !important;
      min-width: 44px !important;
      max-width: min(84px, calc(100% - 24px)) !important;
      height: 24px !important;
      min-height: 24px !important;
      max-height: 24px !important;
      margin: 0 !important;
      padding: 0 8px !important;
      border: 1px solid #005BFF !important;
      border-radius: 8px !important;
      background: #005BFF !important;
      color: #ffffff !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
      letter-spacing: 0 !important;
      text-align: center !important;
      text-decoration: none !important;
      text-transform: none !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      z-index: 2147483647 !important;
      contain: layout style paint !important;
      transition: border-color 150ms ease, background 150ms ease !important;
    }
    .markonverter-ozon-pvz-action.is-saved {
      border-color: rgba(16, 163, 90, 0.36) !important;
      background: #EAF8F1 !important;
      color: #10A35A !important;
      cursor: default !important;
      pointer-events: auto !important;
    }
    .markonverter-ozon-pvz-action:hover:not(:disabled):not(.is-saved) {
      border-color: #004CE0 !important;
      background: #004CE0 !important;
    }
    .markonverter-assist-status {
      flex: 1 1 auto;
      min-width: 0;
      color: #53627A;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
  `;
  document.head.append(style);
}

function pageButton(text: string, variant: "primary" | "secondary" = "primary"): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  const isPrimary = variant === "primary";
  button.setAttribute(
    "style",
    [
      "min-height:32px",
      "box-sizing:border-box",
      "max-width:100%",
      "padding:0 10px",
      `border:1px solid ${isPrimary ? "#005BFF" : "#dce3ee"}`,
      "border-radius:8px",
      `background:${isPrimary ? "#005BFF" : "#ffffff"}`,
      `color:${isPrimary ? "#ffffff" : "#005BFF"}`,
      "cursor:pointer",
      "font:inherit",
      "font-weight:700",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis"
    ].join(";")
  );
  return button;
}

function bindGuardedPageAction(element: HTMLElement, handler: (event: Event) => void): void {
  ensurePageActionEventGuard();
  element.dataset.markonverterPageAction = "true";
  pageActionHandlers.set(element, handler);
}

function ensurePageActionEventGuard(): void {
  if (pageActionEventGuardInstalled) {
    return;
  }
  pageActionEventGuardInstalled = true;
  ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "keydown"].forEach((type) => {
    window.addEventListener(type, handleGuardedPageActionEvent, true);
  });
}

function handleGuardedPageActionEvent(event: Event): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>(PAGE_ACTION_SELECTOR) : null;
  if (!target) {
    return;
  }
  if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  if (event.type === "click" || event instanceof KeyboardEvent) {
    pageActionHandlers.get(target)?.(event);
  }
}
