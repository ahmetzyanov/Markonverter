// Inline "~converted price" badges next to any Ozon price whose explicit
// currency marker differs from settings.defaultCurrency. Runs on every Ozon
// page (product page price widgets and tile prices in grids/search), not
// only product pages. Idempotency and loop-safety are handled through
// data-mkv-approx (host marker, stores the source text it was built from)
// and data-mkv-approx-badge (the injected span itself).

import { convertAmount, formatCurrency } from "../../shared/currency";
import { Currency, ExtensionSettings } from "../../shared/types";
import { getLatestSettings } from "../app";
import { MENU_ASSIST_ID, PANEL_ID } from "../ids";

const HOST_ATTR = "data-mkv-approx";
// Kept in sync with the duplicated literal in ./visible-price.ts: that module
// strips this same attribute before parsing prices from a widget this badge
// may have been injected into.
const BADGE_ATTR = "data-mkv-approx-badge";
const SCAN_DEBOUNCE_MS = 250;
const MAX_HOST_TEXT_LENGTH = 80;

const PRODUCT_PRICE_WIDGET_SELECTOR = '[data-widget="webPrice"], [data-widget*="webPrice" i], [data-widget*="price" i]';
const TILE_PRICE_SELECTOR = 'a[href*="/product/"] span';

// Mirrors the currency-marker patterns in ./visible-price.ts; the marker is
// mandatory here (no currencyHint fallback) so a bare number is never
// annotated with a guessed currency.
const PRICE_WITH_MARKER_PATTERN = /(\d[\d\s\u00a0]{1,14}(?:[,.]\d{1,2})?)\s*(₽|руб\.?|рублей|RUB|₸|тг|тенге|KZT)/i;

export function buildApproxPriceLabel(
  text: string,
  defaultCurrency: Currency,
  ratesToRub: ExtensionSettings["ratesToRub"]
): string | null {
  const match = PRICE_WITH_MARKER_PATTERN.exec(text);
  if (!match) {
    return null;
  }
  const amount = Number.parseFloat(match[1].replace(/[\s\u00a0]/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const currency = parseCurrencyMarker(match[2]);
  if (!currency || currency === defaultCurrency) {
    return null;
  }
  try {
    // Whole units only: this is an approximate price, kopecks/tiyn are noise.
    const converted = Math.round(convertAmount(amount, currency, defaultCurrency, ratesToRub));
    return `~${formatCurrency(converted, defaultCurrency)}`;
  } catch {
    return null;
  }
}

function parseCurrencyMarker(marker: string): Currency | null {
  if (/₽|руб|RUB/i.test(marker)) {
    return "RUB";
  }
  if (/₸|тг|тенге|KZT/i.test(marker)) {
    return "KZT";
  }
  return null;
}

let scanTimer: number | null = null;
let observerInstalled = false;

export function installInlineConvertedPrices(): void {
  if (observerInstalled) {
    return;
  }
  observerInstalled = true;
  scheduleInlineConvertedPriceSync();
  const observer = new MutationObserver((mutations) => {
    if (mutations.every(isBadgeOnlyMutation)) {
      return;
    }
    scheduleInlineConvertedPriceSync();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function scheduleInlineConvertedPriceSync(): void {
  if (scanTimer !== null) {
    return;
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void runInlineConvertedPriceScan();
  }, SCAN_DEBOUNCE_MS);
}

async function runInlineConvertedPriceScan(): Promise<void> {
  const settings = await getLatestSettings();
  if (!settings || !settings.inlineConvertedPrices) {
    removeAllBadges();
    return;
  }

  const activeHosts = scanAndSyncPriceElements(settings);
  document.querySelectorAll<HTMLElement>(`[${HOST_ATTR}]`).forEach((host) => {
    if (!activeHosts.has(host)) {
      removeBadgeFrom(host);
    }
  });
}

function scanAndSyncPriceElements(settings: ExtensionSettings): Set<HTMLElement> {
  const activeHosts = new Set<HTMLElement>();
  const visit = (el: HTMLElement): void => {
    if (isExcludedSubtree(el) || !isPriceLeafCandidate(el)) {
      return;
    }
    const text = readHostSourceText(el);
    if (!text || text.length > MAX_HOST_TEXT_LENGTH) {
      return;
    }
    const label = buildApproxPriceLabel(text, settings.defaultCurrency, settings.ratesToRub);
    if (!label) {
      removeBadgeFrom(el);
      return;
    }
    activeHosts.add(el);
    applyBadge(el, text, label);
  };

  document.querySelectorAll<HTMLElement>(PRODUCT_PRICE_WIDGET_SELECTOR).forEach((widget) => {
    if (isExcludedSubtree(widget)) {
      return;
    }
    widget.querySelectorAll<HTMLElement>("span, div").forEach(visit);
    visit(widget);
  });
  document.querySelectorAll<HTMLElement>(TILE_PRICE_SELECTOR).forEach(visit);
  return activeHosts;
}

// Leaf-ish: no element children other than a badge we may have already
// injected. Anything with other element children is a container, not a
// price text node, and is skipped to stay conservative.
function isPriceLeafCandidate(el: HTMLElement): boolean {
  return Array.from(el.children).every((child) => child.hasAttribute(BADGE_ATTR));
}

function isExcludedSubtree(el: HTMLElement): boolean {
  return Boolean(el.closest(`#${PANEL_ID}, #${MENU_ASSIST_ID}, [${BADGE_ATTR}]`));
}

function readHostSourceText(el: HTMLElement): string {
  const badge = el.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  if (!badge) {
    return compactText(el.textContent || "");
  }
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelector<HTMLElement>(`[${BADGE_ATTR}]`)?.remove();
  return compactText(clone.textContent || "");
}

function applyBadge(host: HTMLElement, sourceText: string, label: string): void {
  const existingMarker = host.getAttribute(HOST_ATTR);
  const badge = host.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  if (existingMarker === sourceText && badge && badge.textContent === label) {
    return;
  }
  host.setAttribute(HOST_ATTR, sourceText);
  const nextBadge = badge ?? createBadgeElement();
  nextBadge.textContent = label;
  if (!badge) {
    host.append(nextBadge);
  }
}

function removeBadgeFrom(host: HTMLElement): void {
  if (!host.hasAttribute(HOST_ATTR)) {
    return;
  }
  host.removeAttribute(HOST_ATTR);
  host.querySelector<HTMLElement>(`[${BADGE_ATTR}]`)?.remove();
}

function removeAllBadges(): void {
  document.querySelectorAll<HTMLElement>(`[${BADGE_ATTR}]`).forEach((badge) => badge.remove());
  document.querySelectorAll<HTMLElement>(`[${HOST_ATTR}]`).forEach((host) => host.removeAttribute(HOST_ATTR));
}

function createBadgeElement(): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.setAttribute(BADGE_ATTR, "1");
  badge.className = "markonverter-approx-price";
  badge.setAttribute(
    "style",
    [
      "display:inline",
      "margin-left:4px",
      "color:#7B8798",
      "font-size:0.85em",
      "font-weight:500",
      "white-space:nowrap"
    ].join(";")
  );
  return badge;
}

function isBadgeOnlyMutation(mutation: MutationRecord): boolean {
  const nodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
  return nodes.length > 0 && nodes.every((node) => node instanceof Element && node.hasAttribute(BADGE_ATTR));
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
