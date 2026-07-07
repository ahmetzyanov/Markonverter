// Read-only DOM detection for Ozon's native delivery/pickup selector: finding
// the dialog and its opener, recognizing pickup rows, and extracting pickup
// candidates from them. No extension state here — known candidates are passed
// in by the caller.

import {
  extractOzonPickupCandidatesFromSources,
  OzonPickupCandidate
} from "../marketplaces/ozon/pickup-capture";
import {
  compactText,
  countPickupRowMarkers,
  isAddressLikePickupRowText,
  isOzonAddAddressControlText,
  matchDetectedPickupCandidateToRow,
  pickupRowName,
  rowMatchKey,
  stripOzonActionText
} from "../marketplaces/ozon/pickup-matching";
import { MENU_ASSIST_ID, PANEL_ID } from "./ids";

export function findOzonDeliveryContainer(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i], [data-widget*="addressbook" i]'
    )
  );
  return (
    candidates.find((element) => isLikelyOzonDeliverySelectorContainer(element)) || null
  );
}

export async function waitForOzonDeliveryContainer(timeoutMs = 3000): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const container = findOzonDeliveryContainer();
    if (container) {
      return container;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return findOzonDeliveryContainer();
}

export async function waitForOzonDeliveryContainerToClose(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && findOzonDeliveryContainer()) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function waitForOzonDeliverySelectorOpener(timeoutMs = 2500): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const opener = findOzonDeliverySelectorOpener();
    if (opener) {
      return opener;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return findOzonDeliverySelectorOpener();
}

function findOzonDeliverySelectorOpener(): HTMLElement | null {
  const directControls = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[data-widget*="delivery" i] button',
        '[data-widget*="delivery" i] a',
        '[data-widget*="delivery" i] [role="button"]',
        '[data-widget*="address" i] button',
        '[data-widget*="address" i] a',
        '[data-widget*="address" i] [role="button"]',
        '[href*="/modal/addressbook" i]',
        '[href*="/modal/delivery" i]'
      ].join(",")
    )
  );
  const directMatch = directControls.find((element) => isOzonDeliverySelectorOpener(element));
  if (directMatch) {
    return directMatch;
  }

  const clickableBlocks = Array.from(
    document.querySelectorAll<HTMLElement>('[data-widget*="delivery" i], [data-widget*="address" i], [data-widget*="geo" i]')
  );
  return clickableBlocks.find((element) => isOzonDeliverySelectorOpener(element, { allowBlock: true })) || null;
}

function isOzonDeliverySelectorOpener(element: HTMLElement, options: { allowBlock?: boolean } = {}): boolean {
  if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.id === MENU_ASSIST_ID || element.closest(`#${MENU_ASSIST_ID}`)) {
    return false;
  }
  if (element.closest('[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i]')) {
    return false;
  }
  if (!isClickableOzonOpenerVisible(element, options.allowBlock === true)) {
    return false;
  }

  const context = element.closest<HTMLElement>('[data-widget*="delivery" i], [data-widget*="address" i], [data-widget*="geo" i]');
  const text = compactText(
    [
      element.innerText || element.textContent || "",
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      element.getAttribute("href") || "",
      context && context !== element ? context.innerText || context.textContent || "" : ""
    ].join(" ")
  ).slice(0, 1000);
  if (!/(достав|адрес|пункт|пвз|получ|куда|delivery|address|pickup|addressbook|geo)/i.test(text)) {
    return false;
  }
  if (/(редакт|измен|выб|достав|адрес|пункт|куда|edit|change|select|delivery|address|pickup)/i.test(text)) {
    return true;
  }
  return options.allowBlock === true && /(button|link)/i.test(element.getAttribute("role") || "");
}

function isClickableOzonOpenerVisible(element: HTMLElement, allowBlock: boolean): boolean {
  const rect = element.getBoundingClientRect();
  const minWidth = allowBlock ? 120 : 16;
  const minHeight = allowBlock ? 40 : 12;
  return rect.width > minWidth && rect.height > minHeight && rect.bottom > 0 && rect.right > 0;
}

export function dispatchSyntheticClick(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 120 && rect.height > 40 && rect.bottom > 0 && rect.right > 0;
}

export function isVisibleDeliverySummaryElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 20 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
}

function isLikelyOzonDeliverySelectorContainer(element: HTMLElement): boolean {
  if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.id === MENU_ASSIST_ID) {
    return false;
  }
  if (!isVisible(element)) {
    return false;
  }

  const text = (element.innerText || element.textContent || "").slice(0, 3000);
  if (!/(пункт|пвз|получ|достав|адрес|город|pickup|delivery|address)/i.test(text)) {
    return false;
  }

  const role = (element.getAttribute("role") || "").toLowerCase();
  const modalEvidence = [
    role,
    element.getAttribute("aria-modal") || "",
    element.getAttribute("data-widget") || "",
    element.id,
    typeof element.className === "string" ? element.className : ""
  ].join(" ");
  const looksModal = role === "dialog" || /(true|modal|dialog|popup|drawer|overlay|addressbook|deliverydialog)/i.test(modalEvidence);
  if (!looksModal) {
    return false;
  }

  const hasSelectorCopy = /(выберите|выбор|адрес\s+доставки|пункт\s+выдач|пункты\s+выдачи|способ\s+получения|куда\s+доставить|pickup point|delivery selector|select address)/i.test(
    text
  );
  return hasSelectorCopy || countPickupRowMarkers(text) >= 2;
}

export function cleanOzonDeliverySummaryText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, [role='button']").forEach((node) => node.remove());
  return stripOzonActionText(compactText(clone.innerText || clone.textContent || ""));
}

export interface OzonPickupRowCandidate {
  row: HTMLElement;
  candidate: OzonPickupCandidate | null;
  rank: number;
  rowKey: string;
}

export function collectOzonDeliveryRowCandidates(
  container: HTMLElement,
  knownCandidates: OzonPickupCandidate[]
): OzonPickupRowCandidate[] {
  const byKey = new Map<string, OzonPickupRowCandidate>();
  const seenRows = new Set<HTMLElement>();
  const selectors = [
    "a",
    "button",
    "li",
    '[role="button"]',
    '[role="option"]',
    '[data-address-id]',
    '[data-address-oid]',
    '[data-delivery-address-id]',
    '[data-delivery-address-oid]',
    '[data-pickup-point-id]',
    '[data-pvz-id]',
    '[data-testid]',
    "div"
  ].join(",");

  for (const element of Array.from(container.querySelectorAll<HTMLElement>(selectors))) {
    const row = normalizeOzonPickupRow(element, container);
    if (!row || seenRows.has(row)) {
      continue;
    }
    seenRows.add(row);
    const candidate = extractOzonPickupCandidateFromRow(row, knownCandidates);
    const rowText = getOzonRowText(row);
    const rowKey = candidate?.externalLocationId || rowMatchKey(rowText);
    const rect = row.getBoundingClientRect();
    const rank =
      (candidate?.score || 1) +
      (row.matches('a, button, [role="button"], [role="option"], li') ? 18 : 0) -
      Math.min(50, Math.round((rect.width * rect.height) / 6000));
    const existing = byKey.get(rowKey);
    if (!existing || rank > existing.rank) {
      byKey.set(rowKey, { row, candidate, rank, rowKey });
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
  );
}

function normalizeOzonPickupRow(element: HTMLElement, container: HTMLElement): HTMLElement | null {
  if (element.id === MENU_ASSIST_ID || element.closest(`#${MENU_ASSIST_ID}`) || element.closest("[data-markonverter-pvz-action]")) {
    return null;
  }

  let current: HTMLElement | null = element;
  let best: HTMLElement | null = null;

  while (current && current !== container && current !== document.body) {
    if (isPotentialOzonPickupRow(current)) {
      best = current;
    }
    current = current.parentElement;
  }

  return best;
}

function isPotentialOzonPickupRow(element: HTMLElement): boolean {
  if (element.id === MENU_ASSIST_ID || element.closest(`#${MENU_ASSIST_ID}`) || element.closest("[data-markonverter-pvz-action]")) {
    return false;
  }
  if (!isVisible(element)) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  if (rect.height > Math.min(320, window.innerHeight * 0.45)) {
    return false;
  }

  const text = getOzonRowText(element);
  if (text.length < 8 || text.length > 420) {
    return false;
  }
  if (/выберите\s+адрес\s+доставки/i.test(text)) {
    return false;
  }
  if (isOzonAddAddressControlText(text)) {
    return false;
  }
  if (countPickupRowMarkers(text) > 1) {
    return false;
  }
  return /(пункт\s+ozon|пвз|pickup|выдач)/i.test(text) || (hasOzonPickupIdEvidence(element) && isAddressLikePickupRowText(text));
}

function hasOzonPickupIdEvidence(element: HTMLElement): boolean {
  const evidence = Object.entries(collectOzonRowEvidence(element))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return /(select_address|deliveryAddress|addressOid|addressId|addressUid|pickupPoint|pickPoint|pvz|data-address|href)/i.test(evidence);
}

function extractOzonPickupCandidateFromRow(element: HTMLElement, knownCandidates: OzonPickupCandidate[]): OzonPickupCandidate | null {
  const text = getOzonRowText(element);
  const name = pickupRowName(text);
  const evidence = collectOzonRowEvidence(element);
  const candidates = extractOzonPickupCandidatesFromSources([
    {
      source: "dom.ozon-delivery-row",
      urlHint: location.href,
      textHint: text,
      value: {
        name,
        address: name,
        ...evidence
      }
    }
  ]);
  const candidate = candidates[0];
  if (candidate) {
    return {
      ...candidate,
      name: name || candidate.name,
      score: candidate.score + 15,
      comment: "Captured from visible Ozon delivery row"
    };
  }

  const matched = matchDetectedPickupCandidateToRow(text, knownCandidates);
  if (!matched) {
    return null;
  }
  return {
    ...matched,
    name: name || matched.name,
    score: Math.max(1, matched.score - 1),
    comment: matched.comment || "Matched to visible Ozon delivery row"
  };
}

export function isSelectedOzonDeliveryRow(row: HTMLElement): boolean {
  const evidence = [
    row.getAttribute("aria-selected") || "",
    row.getAttribute("aria-checked") || "",
    row.getAttribute("data-selected") || "",
    row.getAttribute("data-checked") || "",
    row.getAttribute("data-active") || "",
    row.getAttribute("data-state") || "",
    row.getAttribute("data-testid") || "",
    typeof row.className === "string" ? row.className : "",
    getOzonRowText(row)
  ]
    .join(" ")
    .toLowerCase();
  return /(^|[\s_-])(?:true|selected|checked|active|current|chosen|выбрано|текущий)(?=$|[\s_-])/i.test(evidence);
}

function getOzonRowText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-markonverter-pvz-action]").forEach((node) => node.remove());
  return compactText(clone.innerText || clone.textContent || "");
}

export function collectOzonRowEvidence(element: HTMLElement): Record<string, string> {
  const evidence: Record<string, string> = {};
  const elements = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*")).slice(0, 80)];
  elements.forEach((item, elementIndex) => {
    Array.from(item.attributes).forEach((attribute, attributeIndex) => {
      if (!/(id|oid|uid|address|delivery|pickup|pick|pvz|location|href|title|aria-label|data)/i.test(attribute.name)) {
        return;
      }
      const value = attribute.value.trim();
      if (!value || value.length > 500) {
        return;
      }
      const key = evidence[attribute.name] === undefined ? attribute.name : `${attribute.name}_${elementIndex}_${attributeIndex}`;
      evidence[key] = value;
    });
  });
  return evidence;
}
