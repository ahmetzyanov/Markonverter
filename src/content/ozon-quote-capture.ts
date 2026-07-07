// Visible-quote capture for Ozon pickup points: manual and automatic capture
// of the price shown for the currently active delivery location, saving
// detected candidates, and detecting which external location is active.
// Candidate collection lives in ./ozon-candidates; app state and panel glue
// are imported from ./app and ./panel/render — the import cycles are
// intentional and function-level only.

import { RuntimeResponse } from "../shared/messages";
import { manualQuoteKey } from "../shared/settings";
import { ExtensionSettings, ManualQuote, MAX_SAVED_OZON_PICKUP_POINTS, PickupPoint, PriceQuote, ProductIdentity } from "../shared/types";
import { extractOzonPickupCandidatesFromSources, OzonPickupCandidate } from "../marketplaces/ozon/pickup-capture";
import {
  compactText,
  findSavedPickupPointForVisibleDelivery,
  ozonCandidateDisplayName,
  ozonPickupDisplayName,
  scoreVisiblePickupMatch,
  uniqueOzonPickupCandidates
} from "../marketplaces/ozon/pickup-matching";
import { getCurrentProduct, getLatestSettings, runIfProductPage, saveManualQuoteForPoint, setLatestSettings, t } from "./app";
import { MENU_ASSIST_ID, PANEL_ID } from "./ids";
import {
  cleanOzonDeliverySummaryText,
  collectOzonDeliveryRowCandidates,
  findOzonDeliveryContainer,
  isSelectedOzonDeliveryRow,
  isVisibleDeliverySummaryElement
} from "./ozon-delivery-dom";
import { markSavedPickupCandidateInPage, scheduleOzonDeliveryAssistSync, syncCurrentOzonDeliveryMenuAssist } from "./ozon-delivery-assist";
import {
  collectCurrentDeliveryPickupSources,
  collectFallbackCaptureSources,
  getBestPickupCandidate,
  latestPickupCandidates,
  mergePickupCandidates,
  requestPagePickupCandidates
} from "./ozon-candidates";
import { isOzonSweepBusy } from "./ozon-sweep";
import { loadOzonSweepState } from "./ozon-sweep-session";
import { isPanelCollapsed, renderLastPanel, requestPanelConfirmation, setCaptureStatus } from "./panel/render";
import { extractVisibleOzonPrice } from "./page/visible-price";
import { runtimeRequest } from "./runtime";

let currentQuoteCaptureTimer: number | null = null;
let lastAutoCapturedCurrentLocation: { productId: string; externalLocationId: string } | null = null;
const autoCaptureInFlight = new Set<string>();

export function resetAutoCapturedCurrentLocation(): void {
  lastAutoCapturedCurrentLocation = null;
}

export function currentOzonExternalLocationId(product: ProductIdentity, settings: ExtensionSettings): string | null {
  if (lastAutoCapturedCurrentLocation?.productId === product.productId) {
    return lastAutoCapturedCurrentLocation.externalLocationId;
  }

  const currentCandidates = currentVisibleOzonPickupCandidates();
  const currentIds = [...new Set(currentCandidates.map((candidate) => candidate.externalLocationId).filter(Boolean))];
  if (currentIds.length === 1) {
    return currentIds[0];
  }

  const visibleDeliveryText = collectCurrentDeliverySummaryText();
  if (!visibleDeliveryText) {
    return null;
  }
  return (
    findSavedPickupPointForVisibleDelivery(settings, visibleDeliveryText, latestPickupCandidates, currentCandidates)
      ?.externalLocationId || null
  );
}

async function savePickupCandidate(candidate: OzonPickupCandidate, product: ProductIdentity): Promise<RuntimeResponse> {
  const name = ozonCandidateDisplayName(candidate);
  const pickupPoint: PickupPoint = {
    id: crypto.randomUUID(),
    name,
    marketplace: "ozon",
    country: candidate.country,
    currency: candidate.currency,
    externalLocationId: candidate.externalLocationId,
    comment: candidate.comment || `Captured from ${product.url}`
  };

  const response = await runtimeRequest({ type: "UPSERT_PICKUP_POINT", pickupPoint });
  if (response.ok && "settings" in response) {
    setLatestSettings(response.settings);
    if (
      response.settings.pickupPoints.some(
        (point) => point.marketplace === "ozon" && point.externalLocationId === candidate.externalLocationId
      )
    ) {
      markSavedPickupCandidateInPage(candidate);
    }
    scheduleOzonDeliveryAssistSync();
  }
  return response;
}

export async function captureCurrentPriceForPickupPoint(pickupPoint: PickupPoint, product: ProductIdentity): Promise<void> {
  const saved = await saveCurrentVisibleQuoteForPoint(pickupPoint, product, { requireConfirmation: true });
  if (saved) {
    setCaptureStatus({ tone: "normal", message: t("panelCapturedCurrentPrice", { name: ozonPickupDisplayName(pickupPoint) }) });
    await runIfProductPage();
  } else {
    renderLastPanel();
  }
}

async function saveCurrentVisibleQuoteForPoint(
  pickupPoint: PickupPoint,
  product: ProductIdentity,
  options: { requireConfirmation: boolean }
): Promise<boolean> {
  if (options.requireConfirmation) {
    const currentCandidate = await getBestPickupCandidate();
    const pickupPointName = ozonPickupDisplayName(pickupPoint);
    if (currentCandidate && currentCandidate.externalLocationId !== pickupPoint.externalLocationId) {
      const shouldContinue = await requestPanelConfirmation({
        title: t("panelCaptureVisibleTitle"),
        message: t("panelCaptureDifferentPointMessage", { current: ozonCandidateDisplayName(currentCandidate), target: pickupPointName }),
        confirmText: t("panelCapturePrice")
      });
      if (!shouldContinue) {
        setCaptureStatus({ tone: "normal", message: t("panelPriceCaptureCancelled") });
        return false;
      }
    } else if (!currentCandidate) {
      const shouldContinue = await requestPanelConfirmation({
        title: t("panelCaptureVisibleTitle"),
        message: t("panelCaptureUnverifiedMessage", { target: pickupPointName }),
        confirmText: t("panelCapturePrice")
      });
      if (!shouldContinue) {
        setCaptureStatus({ tone: "normal", message: t("panelPriceCaptureCancelled") });
        return false;
      }
    }
  }

  const quote = extractVisibleOzonPrice(pickupPoint.currency);
  if (!quote) {
    setCaptureStatus({ tone: "error", message: t("panelVisiblePriceNotFound") });
    return false;
  }

  const updatedSettings = await saveManualQuoteForPoint(pickupPoint, product, quote);
  return Boolean(updatedSettings);
}

export async function autoCaptureCurrentVisibleQuote(product: ProductIdentity, settings: ExtensionSettings): Promise<ExtensionSettings> {
  const visibleDeliveryText = collectCurrentDeliverySummaryText();
  if (!visibleDeliveryText) {
    return settings;
  }

  requestPagePickupCandidates();
  const currentCandidates = currentVisibleOzonPickupCandidates();
  mergePickupCandidates([...currentCandidates, ...extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources())]);
  const pickupPoint = findSavedPickupPointForVisibleDelivery(settings, visibleDeliveryText, latestPickupCandidates, currentCandidates);
  if (!pickupPoint) {
    return settings;
  }

  const quote = extractVisibleOzonPrice(pickupPoint.currency);
  if (!quote) {
    return settings;
  }

  const existing = settings.manualQuotes[manualQuoteKey(product.productId, pickupPoint.id)];
  if (existing && quoteMatchesManualQuote(existing, quote)) {
    lastAutoCapturedCurrentLocation = { productId: product.productId, externalLocationId: pickupPoint.externalLocationId };
    return settings;
  }

  const lockKey = `${product.productId}:${pickupPoint.id}:${quote.amount}:${quote.currency}:${quote.rawText || ""}`;
  if (autoCaptureInFlight.has(lockKey)) {
    return settings;
  }

  autoCaptureInFlight.add(lockKey);
  try {
    const updatedSettings = await saveManualQuoteForPoint(pickupPoint, product, quote);
    if (!updatedSettings) {
      return settings;
    }
    lastAutoCapturedCurrentLocation = { productId: product.productId, externalLocationId: pickupPoint.externalLocationId };
    setCaptureStatus({ tone: "normal", message: t("panelAutoCapturedCurrentPrice", { name: ozonPickupDisplayName(pickupPoint) }) });
    return updatedSettings;
  } finally {
    autoCaptureInFlight.delete(lockKey);
  }
}

export function scheduleCurrentVisibleQuoteCapture(): void {
  if (currentQuoteCaptureTimer !== null) {
    return;
  }
  currentQuoteCaptureTimer = window.setTimeout(() => {
    currentQuoteCaptureTimer = null;
    void captureCurrentVisibleQuoteFromLatestSettings();
  }, 600);
}

async function captureCurrentVisibleQuoteFromLatestSettings(): Promise<void> {
  const product = getCurrentProduct();
  if (!product || isPanelCollapsed) {
    return;
  }
  if (isOzonSweepBusy() || loadOzonSweepState()) {
    return;
  }

  const settings = await getLatestSettings();
  if (!settings) {
    return;
  }

  const updatedSettings = await autoCaptureCurrentVisibleQuote(product, settings);
  if (updatedSettings === settings) {
    return;
  }

  setLatestSettings(updatedSettings);
  await runIfProductPage();
}

function quoteMatchesManualQuote(manualQuote: ManualQuote, quote: PriceQuote): boolean {
  return (
    manualQuote.quote.amount === quote.amount &&
    manualQuote.quote.currency === quote.currency &&
    (manualQuote.quote.rawText || "") === (quote.rawText || "")
  );
}

export function collectCurrentDeliverySummaryText(): string {
  const chunks: string[] = [];
  document.querySelectorAll<HTMLElement>('[data-widget*="delivery" i], [data-widget*="address" i], [href*="/modal/addressbook" i]').forEach((element) => {
    if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`) || element.closest(`#${MENU_ASSIST_ID}`)) {
      return;
    }
    if (element.closest('[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i]')) {
      return;
    }
    if (!isVisibleDeliverySummaryElement(element)) {
      return;
    }
    const text = cleanOzonDeliverySummaryText(element);
    if (text && text.length <= 1200 && /(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address|\d)/i.test(text)) {
      chunks.push(text);
    }
  });
  return compactText(chunks.join(" | ")).slice(0, 2500);
}

function currentVisibleOzonPickupCandidates(): OzonPickupCandidate[] {
  return uniqueOzonPickupCandidates([
    ...extractOzonPickupCandidatesFromSources(collectCurrentDeliveryPickupSources(location.href)),
    ...collectSelectedOzonDeliveryRowCandidates()
  ]);
}

function collectSelectedOzonDeliveryRowCandidates(): OzonPickupCandidate[] {
  const container = findOzonDeliveryContainer();
  if (!container) {
    return [];
  }
  return collectOzonDeliveryRowCandidates(container, latestPickupCandidates)
    .filter((row) => row.candidate && isSelectedOzonDeliveryRow(row.row))
    .map((row) => row.candidate as OzonPickupCandidate);
}

export async function saveDetectedPickupCandidate(candidate: OzonPickupCandidate, product: ProductIdentity): Promise<void> {
  const candidateName = ozonCandidateDisplayName(candidate);
  setCaptureStatus({ tone: "normal", message: t("panelSaving", { name: candidateName }) });
  renderLastPanel();

  const response = await savePickupCandidate(candidate, product);
  if (!response.ok || !("settings" in response)) {
    setCaptureStatus({ tone: "error", message: pickupSaveErrorMessage(response) });
    renderLastPanel();
    if (!response.ok && response.reason === "limit") {
      await syncCurrentOzonDeliveryMenuAssist();
    }
    return;
  }

  const savedPoint = response.settings.pickupPoints.find(
    (point) => point.marketplace === "ozon" && point.externalLocationId === candidate.externalLocationId
  );
  if (!savedPoint) {
    setCaptureStatus({ tone: "error", message: t("panelPickupLimitReached", { count: MAX_SAVED_OZON_PICKUP_POINTS }) });
    renderLastPanel();
    await syncCurrentOzonDeliveryMenuAssist();
    return;
  }
  const quoteCaptured =
    isCurrentVisibleOzonPickupCandidate(candidate)
      ? await saveCurrentVisibleQuoteForPoint(savedPoint, product, { requireConfirmation: false })
      : false;
  setCaptureStatus({
    tone: "normal",
    message: quoteCaptured ? t("panelSavedAndCaptured", { name: candidateName }) : t("panelSaved", { name: candidateName })
  });
  await syncCurrentOzonDeliveryMenuAssist();
  await runIfProductPage();
  await syncCurrentOzonDeliveryMenuAssist();
}

function pickupSaveErrorMessage(response: RuntimeResponse): string {
  if (response.ok) {
    return t("panelPickupNotSaved");
  }
  if (response.reason === "limit") {
    return t("panelPickupLimitReached", { count: MAX_SAVED_OZON_PICKUP_POINTS });
  }
  return response.reason ? t("panelPickupNotSaved") : response.error;
}

function isCurrentVisibleOzonPickupCandidate(candidate: OzonPickupCandidate): boolean {
  if (currentVisibleOzonPickupCandidates().some((item) => item.externalLocationId === candidate.externalLocationId)) {
    return true;
  }
  const visibleDeliveryText = collectCurrentDeliverySummaryText();
  return visibleDeliveryText ? scoreVisiblePickupMatch(candidate.name, visibleDeliveryText, { allowSingleStrongToken: true }) >= 10 : false;
}
