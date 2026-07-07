import { makeErrorResult, makeSuccessResult } from "../shared/comparison";
import { createTranslator, type I18nKey, type Translator } from "../shared/i18n";
import {
  ComparisonResult,
  ExtensionSettings,
  ManualQuote,
  PickupPoint,
  PriceQuote,
  ProductIdentity
} from "../shared/types";
import { manualQuoteKey, SETTINGS_KEY } from "../shared/settings";
import { normalizeSettings } from "../shared/validation";
import { getOzonProductIdentity, isOzonProductPage } from "../marketplaces/ozon";
import { fetchOzonPrivatePrice, OZON_PRODUCT_UNAVAILABLE_IN_REGION } from "../marketplaces/ozon/private-api";
import { PANEL_ID } from "./ids";
import {
  clearOzonSweepState,
  hydrateOzonSweepSession,
  isOzonPickupSessionUnavailable,
  loadOzonSweepState
} from "./ozon-sweep-session";
import {
  continueOzonPriceSweep,
  runOzonSilentPriceSweep,
  shouldStartOzonPriceSweep,
  shouldStartOzonSilentPriceSweep,
  startOzonPriceSweep
} from "./ozon-sweep";
import { installOzonDeliveryMenuAssist, scheduleOzonDeliveryAssistSync } from "./ozon-delivery-assist";
import {
  collectFallbackCaptureSources,
  discoverOzonPickupCandidatesFromApi,
  installPickupCandidateCapture,
  mergePickupCandidates,
  refreshSavedOzonPickupNamesOnLoad,
  repairUnsafeSavedPickupNames,
  requestPagePickupCandidates,
  resetPickupDiscoverySession
} from "./ozon-candidates";
import {
  autoCaptureCurrentVisibleQuote,
  resetAutoCapturedCurrentLocation,
  scheduleCurrentVisibleQuoteCapture
} from "./ozon-quote-capture";
import { isExtensionContextGone, runtimeRequest } from "./runtime";
import { installOzonFixtureCapture, refreshOzonFixtureSummary } from "./fixtures";
import {
  ensurePanel,
  isPanelCollapsed,
  loadPanelState,
  removePanel,
  renderLastPanel,
  renderPanel,
  requestPanelConfirmation,
  setCaptureStatus,
  updateLastPanelSettings
} from "./panel/render";
import { resetDetectedPickupListCollapse } from "./panel/sections";
import { extractOzonPickupCandidatesFromSources } from "../marketplaces/ozon/pickup-capture";
import { ozonPickupDisplayName } from "../marketplaces/ozon/pickup-matching";

let activeUrl = "";
// Mutable state below is exported read-only (ESM live bindings) for the sweep,
// assist, candidate, and capture modules; cross-module writes go through
// setLatestSettings.
export let activeRun = 0;
export let latestSettings: ExtensionSettings | null = null;
let settingsLoadPromise: Promise<ExtensionSettings | null> | null = null;
export function setLatestSettings(settings: ExtensionSettings | null): void {
  latestSettings = settings;
}
let panelRecoveryTimer: number | null = null;
const autoPriceCaptureInFlight = new Map<string, Promise<PickupPointComparison>>();

export async function boot(): Promise<void> {
  installPickupCandidateCapture();
  installOzonFixtureCapture();
  installSettingsChangeListener();
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  }
  await loadPanelState();
  await refreshOzonFixtureSummary();
  installOzonDeliveryMenuAssist();
  installPanelRecovery();
  await runIfProductPage();
  const recheckTimer = setInterval(() => {
    if (isExtensionContextGone()) {
      clearInterval(recheckTimer);
      return;
    }
    if (location.href !== activeUrl || shouldRestoreProductPanel()) {
      void runIfProductPage();
    }
  }, 1000);
}

function installSettingsChangeListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[SETTINGS_KEY]) {
      return;
    }
    latestSettings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    updateLastPanelSettings(latestSettings);
    renderLastPanel();
    scheduleOzonDeliveryAssistSync();
  });
}

function installPanelRecovery(): void {
  const observer = new MutationObserver(schedulePanelRecovery);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function schedulePanelRecovery(): void {
  scheduleCurrentVisibleQuoteCapture();
  if (panelRecoveryTimer !== null) {
    return;
  }
  panelRecoveryTimer = window.setTimeout(() => {
    panelRecoveryTimer = null;
    if (shouldRestoreProductPanel()) {
      void runIfProductPage();
    }
  }, 100);
}

function shouldRestoreProductPanel(): boolean {
  if (document.getElementById(PANEL_ID)) {
    return false;
  }
  try {
    return isOzonProductPage(new URL(location.href));
  } catch {
    return false;
  }
}

export async function runIfProductPage(): Promise<void> {
  if (isExtensionContextGone()) {
    return;
  }
  const currentUrl = location.href;
  const pageChanged = currentUrl !== activeUrl;
  const runId = ++activeRun;
  const url = new URL(currentUrl);

  if (!isOzonProductPage(url)) {
    activeUrl = currentUrl;
    removePanel();
    return;
  }

  const product = getOzonProductIdentity(url, document);
  if (!product) {
    activeUrl = "";
    removePanel();
    return;
  }

  if (pageChanged) {
    resetPickupDiscoverySession();
    autoPriceCaptureInFlight.clear();
    resetDetectedPickupListCollapse();
    resetAutoCapturedCurrentLocation();
  }
  activeUrl = currentUrl;
  const panel = ensurePanel();
  renderPanel(panel, { state: "loading", product });
  requestPagePickupCandidates();
  discoverOzonPickupCandidatesFromApi(product);
  if (isPanelCollapsed) {
    return;
  }

  const settingsResponse = await runtimeRequest({ type: "GET_SETTINGS" });
  if (!settingsResponse.ok || !("settings" in settingsResponse)) {
    renderPanel(panel, { state: "fatal", product, message: settingsResponse.ok ? t("optionsSettingsUnavailable") : settingsResponse.error });
    return;
  }

  let settings = settingsResponse.settings;
  latestSettings = settings;
  discoverOzonPickupCandidatesFromApi(product);
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));

  // Sweep state and swept marks live in per-origin sessionStorage; hydrate them
  // from the per-tab background mirror first so a sweep interrupted by an
  // ozon.ru<->ozon.kz domain flip resumes instead of being forgotten.
  await hydrateOzonSweepSession();

  // A visible price sweep resumes across page reloads; drive it before the normal
  // render so each pickup point is priced while its own page is actually shown.
  const activeSweep = loadOzonSweepState();
  if (activeSweep && activeSweep.productId !== product.productId) {
    clearOzonSweepState();
  } else if (activeSweep) {
    renderPanel(panel, { state: "loading", product, settings });
    if ((await continueOzonPriceSweep(product, settings)) === "reloading") {
      return;
    }
    settings = (await getLatestSettings()) || settings;
    latestSettings = settings;
  }

  settings = await refreshSavedOzonPickupNamesOnLoad(product, settings);
  if (runId !== activeRun) {
    return;
  }
  settings = await repairUnsafeSavedPickupNames(settings);
  settings = await autoCaptureCurrentVisibleQuote(product, settings);
  latestSettings = settings;
  const allPickupPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
  if (allPickupPoints.length === 0) {
    renderPanel(panel, { state: "empty", product, settings });
    return;
  }

  const pickupPoints = getComparisonPickupPoints(settings, allPickupPoints);
  if (pickupPoints.length === 0) {
    renderPanel(panel, { state: "noSelection", product, settings, allPickupPoints });
    return;
  }

  if (shouldStartOzonSilentPriceSweep(product, settings, pickupPoints)) {
    renderPanel(panel, { state: "loading", product, settings, pickupPoints });
    if ((await runOzonSilentPriceSweep(product, settings, pickupPoints, runId)) === "reloading") {
      return;
    }
    settings = (await getLatestSettings()) || settings;
    latestSettings = settings;
    if (runId !== activeRun) {
      return;
    }
  }

  if (shouldStartOzonPriceSweep(product, settings, pickupPoints)) {
    renderPanel(panel, { state: "loading", product, settings, pickupPoints });
    if (await startOzonPriceSweep(product, settings, pickupPoints)) {
      return;
    }
    settings = (await getLatestSettings()) || settings;
    latestSettings = settings;
    if (runId !== activeRun) {
      return;
    }
  }

  renderPanel(panel, { state: "loading", product, settings, pickupPoints });
  const results: ComparisonResult[] = [];
  for (const pickupPoint of pickupPoints) {
    if (runId !== activeRun) {
      return;
    }
    const comparison = await compareOzonPickupPoint(product, pickupPoint, settings);
    results.push(comparison.result);
    settings = comparison.settings;
    latestSettings = settings;
  }

  if (runId !== activeRun) {
    return;
  }

  renderPanel(panel, {
    state: "results",
    product,
    settings,
    pickupPoints,
    results
  });
}

function getComparisonPickupPoints(settings: ExtensionSettings, allPickupPoints: PickupPoint[]): PickupPoint[] {
  if (!settings.comparisonPickupPointIds) {
    return allPickupPoints;
  }
  const selectedIds = new Set(settings.comparisonPickupPointIds);
  return allPickupPoints.filter((point) => selectedIds.has(point.id));
}

interface PickupPointComparison {
  result: ComparisonResult;
  settings: ExtensionSettings;
}

async function compareOzonPickupPoint(
  product: ProductIdentity,
  pickupPoint: PickupPoint,
  settings: ExtensionSettings
): Promise<PickupPointComparison> {
  const manualQuote = settings.manualQuotes[manualQuoteKey(product.productId, pickupPoint.id)];
  if (manualQuote) {
    return { result: makeManualQuoteResult(pickupPoint.id, manualQuote, settings), settings };
  }

  // A sweep already visited this pickup point and confirmed the product is not
  // delivered to its region; surface the warning without re-pricing it.
  if (isOzonPickupSessionUnavailable(product.productId, pickupPoint.externalLocationId)) {
    return { result: makeErrorResult(pickupPoint.id, new Error(OZON_PRODUCT_UNAVAILABLE_IN_REGION)), settings };
  }

  const lockKey = `${product.url}:${pickupPoint.id}`;
  const inFlight = autoPriceCaptureInFlight.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const comparisonPromise = fetchOzonPickupPointPrice(product, pickupPoint, settings);
  autoPriceCaptureInFlight.set(lockKey, comparisonPromise);
  try {
    return await comparisonPromise;
  } finally {
    if (autoPriceCaptureInFlight.get(lockKey) === comparisonPromise) {
      autoPriceCaptureInFlight.delete(lockKey);
    }
  }
}

// ponytail: read-only price only. Ozon prices a non-active pickup point only if
// you switch your active delivery address (verified 2026-07-06: deliveryAddressOid
// as a bare GET/POST param is ignored or 404s — see wiki/log.md). Session-mutating
// pricing lives in the silent sweep (option 3) and the reload sweep (option 2),
// which own activation guards and restore; the per-row compare stays non-mutating.
async function fetchOzonPickupPointPrice(
  product: ProductIdentity,
  pickupPoint: PickupPoint,
  settings: ExtensionSettings
): Promise<PickupPointComparison> {
  try {
    const quote = await fetchOzonPrivatePrice({
      productId: product.productId,
      productUrl: product.url,
      pickupExternalLocationId: pickupPoint.externalLocationId,
      currencyHint: pickupPoint.currency
    });
    return saveFetchedQuoteResult(pickupPoint, product, quote, settings);
  } catch (error) {
    return { result: makeErrorResult(pickupPoint.id, error), settings };
  }
}

function makeManualQuoteResult(pickupPointId: string, manualQuote: ManualQuote, settings: ExtensionSettings): ComparisonResult {
  return makeSuccessResult(
    pickupPointId,
    {
      ...manualQuote.quote,
      source: "manual",
      capturedAt: manualQuote.capturedAt
    },
    settings.defaultCurrency,
    settings
  );
}

async function saveFetchedQuoteResult(
  pickupPoint: PickupPoint,
  product: ProductIdentity,
  quote: PriceQuote,
  settings: ExtensionSettings
): Promise<{ result: ComparisonResult; settings: ExtensionSettings }> {
  const updatedSettings = await saveManualQuoteForPoint(pickupPoint, product, quote);
  if (!updatedSettings) {
    return {
      result: makeSuccessResult(pickupPoint.id, quote, settings.defaultCurrency, settings),
      settings
    };
  }

  const manualQuote = updatedSettings.manualQuotes[manualQuoteKey(product.productId, pickupPoint.id)];
  return {
    result: manualQuote ? makeManualQuoteResult(pickupPoint.id, manualQuote, updatedSettings) : makeSuccessResult(pickupPoint.id, quote, updatedSettings.defaultCurrency, updatedSettings),
    settings: updatedSettings
  };
}

export function getCurrentProduct(): ProductIdentity | null {
  const url = new URL(location.href);
  return isOzonProductPage(url) ? getOzonProductIdentity(url, document) : null;
}

export async function saveManualQuoteForPoint(
  pickupPoint: PickupPoint,
  product: ProductIdentity,
  quote: PriceQuote
): Promise<ExtensionSettings | null> {
  const capturedAt = new Date().toISOString();
  const manualQuote: ManualQuote = {
    productId: product.productId,
    productUrl: product.url,
    pickupPointId: pickupPoint.id,
    quote: {
      ...quote,
      source: "manual",
      capturedAt
    },
    capturedAt
  };
  const response = await runtimeRequest({ type: "SAVE_MANUAL_QUOTE", manualQuote });
  if (!response.ok || !("settings" in response)) {
    setCaptureStatus({
      tone: "error",
      message: response.ok || response.reason ? t("panelCapturedPriceNotSaved") : response.error
    });
    return null;
  }
  latestSettings = response.settings;
  return response.settings;
}

export async function deleteSavedPickupPoint(pickupPoint: PickupPoint, product: ProductIdentity): Promise<void> {
  const pickupPointName = ozonPickupDisplayName(pickupPoint);
  const shouldDelete = await requestPanelConfirmation({
    title: t("panelDeletePickupTitle"),
    message: t("panelDeletePickupMessage", { name: pickupPointName }),
    confirmText: t("panelDeletePickupConfirm"),
    danger: true
  });
  if (!shouldDelete) {
    return;
  }

  setCaptureStatus({ tone: "normal", message: t("panelDeleted", { name: pickupPointName }) });
  const response = await runtimeRequest({ type: "DELETE_PICKUP_POINT", pickupPointId: pickupPoint.id });
  if (!response.ok || !("settings" in response)) {
    setCaptureStatus({ tone: "error", message: response.ok ? t("panelPickupNotDeleted") : response.error });
    renderLastPanel();
    return;
  }
  latestSettings = response.settings;
  scheduleOzonDeliveryAssistSync();
  await runIfProductPage();
  if (getCurrentProduct()?.productId === product.productId) {
    renderLastPanel();
  }
}

export async function getLatestSettings(): Promise<ExtensionSettings | null> {
  if (latestSettings) {
    return latestSettings;
  }
  if (!settingsLoadPromise) {
    settingsLoadPromise = runtimeRequest({ type: "GET_SETTINGS" })
      .then((response) => {
        if (response.ok && "settings" in response) {
          latestSettings = response.settings;
          return response.settings;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        settingsLoadPromise = null;
      });
  }
  return settingsLoadPromise;
}

export function currentI18n(settings: ExtensionSettings | null = latestSettings): Translator {
  return createTranslator(settings?.language);
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  return currentI18n().t(key, params);
}

export function isDebugModeEnabled(settings: ExtensionSettings | null = latestSettings): boolean {
  return settings?.debug === true;
}

