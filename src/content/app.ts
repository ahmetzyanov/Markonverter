import { buildComparisonRows, makeErrorResult, makeSuccessResult } from "../shared/comparison";
import { formatCurrency } from "../shared/currency";
import { createTranslator, type I18nKey, type Translator } from "../shared/i18n";
import { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import {
  ComparisonResult,
  Currency,
  ExtensionSettings,
  ManualQuote,
  MAX_SAVED_OZON_PICKUP_POINTS,
  PickupPoint,
  PriceQuote,
  ProductIdentity
} from "../shared/types";
import { manualQuoteKey, SETTINGS_KEY } from "../shared/settings";
import { normalizeSettings } from "../shared/validation";
import {
  appendOzonFixtureRecords,
  emptyOzonFixtureStore,
  normalizeOzonFixtureStore,
  OzonFixtureStore,
  OzonNetworkFixtureInput,
  OZON_FIXTURE_STORE_KEY
} from "../shared/ozon-fixtures";
import { getOzonProductIdentity, isOzonProductPage } from "../marketplaces/ozon";
import {
  activateOzonPickupLocationForProduct,
  fetchOzonPrivatePrice,
  fetchOzonSelectedLocationId,
  isOzonProductUnavailableInRegion,
  OZON_PRODUCT_UNAVAILABLE_IN_REGION
} from "../marketplaces/ozon/private-api";
import { panelCss } from "./panel/styles";
import { extractVisibleOzonPrice } from "./page/visible-price";
import {
  extractOzonPickupCandidatesFromSources,
  isGenericOzonPickupName,
  OzonCaptureSource,
  OzonPickupCandidate,
  safeOzonPickupName,
  shouldReplaceOzonPickupCandidate,
  shouldUseOzonPickupName
} from "../marketplaces/ozon/pickup-capture";

const PANEL_ID = "markonverter-panel-root";
const PANEL_CONFIRMATION_ID = "markonverter-panel-confirmation";
const MENU_ASSIST_ID = "markonverter-ozon-delivery-assist";
const MENU_ASSIST_STYLE_ID = "markonverter-ozon-delivery-assist-style";
const PAGE_ACTION_SELECTOR = "[data-markonverter-page-action]";
const COLLECT_PICKUP_EVENT = "markonverter:collect-ozon-pickup";
const PICKUP_CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";
const NETWORK_FIXTURE_EVENT = "markonverter:ozon-network-fixture";
const PANEL_STATE_KEY = "markonverter.panelState";
const DETECTED_PICKUP_LIST_ID = "markonverter-detected-pickup-list";
const PANEL_COLLAPSE_DURATION_MS = 220;
const PANEL_EXPAND_DURATION_MS = 240;

let activeUrl = "";
let activeRun = 0;
let latestPickupCandidates: OzonPickupCandidate[] = [];
let latestSettings: ExtensionSettings | null = null;
let settingsLoadPromise: Promise<ExtensionSettings | null> | null = null;
let pickupApiDiscoveryKey = "";
let pickupApiDiscoveryPromise: Promise<OzonPickupCandidate[]> | null = null;
let lastPanelModel: PanelModel | null = null;
let captureStatus: { tone: "normal" | "error"; message: string } | null = null;
let fixtureStatus: { tone: "normal" | "error"; message: string } | null = null;
let ozonFixtureCount = 0;
let fixtureFlushTimer: number | null = null;
let pendingFixtureInputs: OzonNetworkFixtureInput[] = [];
let isPanelCollapsed = false;
let detectedPickupListCollapsedOverride: boolean | null = null;
let panelRecoveryTimer: number | null = null;
let currentQuoteCaptureTimer: number | null = null;
let assistSyncTimer: number | null = null;
let savedPickupNameSyncTimer: number | null = null;
let pendingPanelConfirmationCancel: (() => void) | null = null;
let suppressAssistObserverUntil = 0;
let panelTransitionVersion = 0;
let lastAutoCapturedCurrentLocation: { productId: string; externalLocationId: string } | null = null;
const targetedPickupDiscoveryIds = new Set<string>();
const autoPickupSelectorOpenKeys = new Set<string>();
const pageActionHandlers = new WeakMap<HTMLElement, (event: Event) => void>();
const autoCaptureInFlight = new Set<string>();
const autoPriceCaptureInFlight = new Map<string, Promise<PickupPointComparison>>();
let pageActionEventGuardInstalled = false;

export async function boot(): Promise<void> {
  document.addEventListener(PICKUP_CANDIDATES_EVENT, handlePickupCandidatesEvent);
  document.addEventListener(NETWORK_FIXTURE_EVENT, handleNetworkFixtureEvent);
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

async function runIfProductPage(): Promise<void> {
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
    targetedPickupDiscoveryIds.clear();
    autoPickupSelectorOpenKeys.clear();
    autoPriceCaptureInFlight.clear();
    detectedPickupListCollapsedOverride = null;
    lastAutoCapturedCurrentLocation = null;
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

function currentOzonExternalLocationId(product: ProductIdentity, settings: ExtensionSettings): string | null {
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
  return findSavedPickupPointForVisibleDelivery(settings, visibleDeliveryText, currentCandidates)?.externalLocationId || null;
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
// you switch your active delivery address, which the visible reload sweep now
// does explicitly. We never mutate the session in the background here — doing so
// silently changed the user's selected pickup point and broke Ozon's native
// selector (it appeared to jump to the next point instead of opening the menu).
// TODO(option 3): a guarded silent-activation path (mutate + resync the page +
// pause while Ozon's native menu is open) could refill non-active prices without
// reloads, if the reload sweep proves too disruptive.
async function fetchOzonPickupPointPrice(
  product: ProductIdentity,
  pickupPoint: PickupPoint,
  settings: ExtensionSettings
): Promise<PickupPointComparison> {
  try {
    const quote = await requestOzonPrice({
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

async function requestOzonPrice(request: {
  productId: string;
  productUrl: string;
  pickupExternalLocationId: string;
  currencyHint: "RUB" | "KZT";
  allowSessionMutatingLocationActivation?: boolean;
}): Promise<PriceQuote> {
  return fetchOzonPrivatePrice(request);
}

// ---- Visible Ozon price sweep (option 2) --------------------------------------
// To price a pickup point that is not currently selected, Ozon requires switching
// the active delivery address. Instead of doing that silently in the background
// (which desynced the page from the server and broke the native selector), the
// sweep switches the address and reloads the product page onto each saved pickup
// point in turn, records its confirmed price, then returns to the original point
// (or, if the original point cannot deliver the product, to an available one).
// State is kept in sessionStorage so it survives the reloads it triggers.

const OZON_SWEEP_STATE_KEY = "markonverter.ozonSweep.v1";
const OZON_SWEPT_SESSION_PREFIX = "markonverter.ozonSwept.v1:";
const OZON_UNAVAILABLE_SESSION_PREFIX = "markonverter.ozonUnavailable.v1:";
const OZON_SWEEP_PRICE_WAIT_MS = 6000;
let ozonSweepBusy = false;

interface OzonSweepState {
  productId: string;
  originalActive: string | null;
  originalHref: string;
  pending: string[];
  priced: string[];
  unavailable: string[];
  // 0 = still pricing; 1 = navigated back to the original page, need to reselect;
  // 2 = original pickup point reselected, ready to finish.
  returnStage: 0 | 1 | 2;
}

function loadOzonSweepState(): OzonSweepState | null {
  try {
    const raw = sessionStorage.getItem(OZON_SWEEP_STATE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OzonSweepState;
    if (!parsed || typeof parsed.productId !== "string" || !Array.isArray(parsed.pending)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function canPersistOzonSweepState(): boolean {
  const probeKey = OZON_SWEEP_STATE_KEY + ".probe";
  try {
    sessionStorage.setItem(probeKey, "1");
    const persisted = sessionStorage.getItem(probeKey) === "1";
    sessionStorage.removeItem(probeKey);
    return persisted;
  } catch {
    return false;
  }
}

function saveOzonSweepState(state: OzonSweepState): void {
  try {
    sessionStorage.setItem(OZON_SWEEP_STATE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage may be unavailable in some privacy modes; sweeping is best-effort.
  }
}

function clearOzonSweepState(): void {
  try {
    sessionStorage.removeItem(OZON_SWEEP_STATE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function markOzonProductSwept(productId: string): void {
  try {
    sessionStorage.setItem(OZON_SWEPT_SESSION_PREFIX + productId, "1");
  } catch {
    // Ignore storage failures.
  }
}

function isOzonProductSwept(productId: string): boolean {
  try {
    return sessionStorage.getItem(OZON_SWEPT_SESSION_PREFIX + productId) === "1";
  } catch {
    return false;
  }
}

function loadOzonSessionUnavailable(productId: string): string[] {
  try {
    const raw = sessionStorage.getItem(OZON_UNAVAILABLE_SESSION_PREFIX + productId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistOzonSessionUnavailable(productId: string, ids: string[]): void {
  try {
    const merged = [...new Set([...loadOzonSessionUnavailable(productId), ...ids.filter(Boolean)])];
    sessionStorage.setItem(OZON_UNAVAILABLE_SESSION_PREFIX + productId, JSON.stringify(merged));
  } catch {
    // Ignore storage failures.
  }
}

function isOzonPickupSessionUnavailable(productId: string, externalLocationId: string): boolean {
  return externalLocationId.trim() !== "" && loadOzonSessionUnavailable(productId).includes(externalLocationId);
}

function shouldStartOzonPriceSweep(
  product: ProductIdentity,
  settings: ExtensionSettings,
  comparisonPoints: PickupPoint[]
): boolean {
  if (isPanelCollapsed || ozonSweepBusy) {
    return false;
  }
  // The sweep survives reloads only through sessionStorage. If it cannot
  // persist state, every reload would look like a fresh start — an infinite
  // reload loop. Never start in that case.
  if (!canPersistOzonSweepState()) {
    return false;
  }
  if (isOzonProductSwept(product.productId) || loadOzonSweepState()) {
    return false;
  }
  // ponytail: refresh once per tab session; already-captured or known-unavailable
  // points do not trigger another multi-reload sweep.
  // TODO: add a freshness TTL so long-lived tabs re-sweep for updated prices.
  return comparisonPoints.some(
    (point) =>
      point.externalLocationId.trim() !== "" &&
      !settings.manualQuotes[manualQuoteKey(product.productId, point.id)] &&
      !isOzonPickupSessionUnavailable(product.productId, point.externalLocationId)
  );
}

async function startOzonPriceSweep(
  product: ProductIdentity,
  settings: ExtensionSettings,
  comparisonPoints: PickupPoint[]
): Promise<boolean> {
  if (ozonSweepBusy) {
    return true;
  }
  ozonSweepBusy = true;

  const pointByExternalId = new Map(
    comparisonPoints.filter((point) => point.externalLocationId.trim() !== "").map((point) => [point.externalLocationId, point])
  );
  const comparisonIds = [...pointByExternalId.keys()];
  // Prefer Ozon's own selected-address id so we can return to the exact pickup
  // point the user started on, even when it is not one of the compared points.
  const apiSelected = await fetchOzonSelectedLocationId(product.url).catch(() => null);
  const originalActive = apiSelected || currentOzonExternalLocationId(product, settings);
  const originalHref = location.href;
  const priced: string[] = [];
  const unavailable: string[] = [];

  // The currently shown point is priced from its visible page (reliable, and
  // usually already captured by autoCaptureCurrentVisibleQuote); only switched
  // points below need the confirmed private read. Detect an unavailable region
  // here so the finish step can land on an available point instead.
  const activePoint = originalActive ? pointByExternalId.get(originalActive) : undefined;
  if (activePoint) {
    if (isVisibleOzonRegionUnavailable()) {
      unavailable.push(activePoint.externalLocationId);
    } else if (settings.manualQuotes[manualQuoteKey(product.productId, activePoint.id)]) {
      priced.push(activePoint.externalLocationId);
    } else {
      const quote = extractVisibleOzonPrice(activePoint.currency);
      if (quote) {
        await saveManualQuoteForPoint(activePoint, product, quote);
        priced.push(activePoint.externalLocationId);
      }
    }
    persistOzonSessionUnavailable(product.productId, unavailable);
  }

  const pending = comparisonIds.filter((id) => id !== originalActive);
  const state: OzonSweepState = {
    productId: product.productId,
    originalActive,
    originalHref,
    pending,
    priced,
    unavailable,
    returnStage: 0
  };
  if (pending.length === 0) {
    saveOzonSweepState(state);
    return (await beginOzonSweepReturn(product, state, originalActive)) === "reloading";
  }

  saveOzonSweepState(state);
  await activateOzonAddressAndReload(product, pending[0]);
  return true;
}

async function continueOzonPriceSweep(product: ProductIdentity, settings: ExtensionSettings): Promise<"reloading" | "done"> {
  if (ozonSweepBusy) {
    return "reloading";
  }
  ozonSweepBusy = true;

  const state = loadOzonSweepState();
  if (!state || state.productId !== product.productId) {
    // The product changed — most likely Ozon redirected across domains while we
    // were returning. Nothing safe left to do; stop rather than reload again.
    clearOzonSweepState();
    ozonSweepBusy = false;
    return "done";
  }

  // We navigated back to the original page; now reselect the original pickup point.
  if (state.returnStage === 1) {
    if (state.originalActive) {
      state.returnStage = 2;
      saveOzonSweepState(state);
      await activateOzonAddressAndReload(product, state.originalActive);
      return "reloading";
    }
    finalizeOzonSweep(product, state);
    ozonSweepBusy = false;
    return "done";
  }
  if (state.returnStage === 2) {
    finalizeOzonSweep(product, state);
    ozonSweepBusy = false;
    return "done";
  }

  const captureTarget = state.pending[0];
  const point = captureTarget ? settings.pickupPoints.find((item) => item.externalLocationId === captureTarget) : undefined;
  if (point) {
    await captureOzonSweepStop(product, point, state.priced, state.unavailable);
    persistOzonSessionUnavailable(product.productId, state.unavailable);
  }

  state.pending = state.pending.slice(1);
  if (state.pending.length > 0) {
    saveOzonSweepState(state);
    await activateOzonAddressAndReload(product, state.pending[0]);
    return "reloading";
  }

  return beginOzonSweepReturn(product, state, captureTarget);
}

// Drive the page back to where the sweep started. When the original pickup point
// is still available we return to it (navigating back across an Ozon domain flip
// first if one happened, since the private API can only switch same-origin); when
// the original point cannot deliver the product we instead land on an available
// one so the product is shown as available.
async function beginOzonSweepReturn(
  product: ProductIdentity,
  state: OzonSweepState,
  currentActive: string | null
): Promise<"reloading" | "done"> {
  const finishTarget = chooseOzonSweepFinishTarget(state.originalActive, state.priced, state.unavailable);
  if (!finishTarget || finishTarget === currentActive) {
    finalizeOzonSweep(product, state);
    ozonSweepBusy = false;
    return "done";
  }

  const returningToOriginal = finishTarget === state.originalActive;
  if (returningToOriginal && state.originalHref && ozonHrefOrigin(location.href) !== ozonHrefOrigin(state.originalHref)) {
    state.returnStage = 1;
    saveOzonSweepState(state);
    location.href = state.originalHref;
    return "reloading";
  }

  state.returnStage = 2;
  saveOzonSweepState(state);
  await activateOzonAddressAndReload(product, finishTarget);
  return "reloading";
}

function ozonHrefOrigin(href: string): string {
  try {
    return new URL(href).origin;
  } catch {
    return "";
  }
}

function finalizeOzonSweep(product: ProductIdentity, state: OzonSweepState): void {
  persistOzonSessionUnavailable(product.productId, state.unavailable);
  markOzonProductSwept(product.productId);
  clearOzonSweepState();
}

function chooseOzonSweepFinishTarget(originalActive: string | null, priced: string[], unavailable: string[]): string | null {
  // Return to where the user was, unless that point cannot deliver the product —
  // then land on an available one so the product is actually shown as available.
  if (originalActive && !unavailable.includes(originalActive)) {
    return originalActive;
  }
  return priced[0] ?? originalActive ?? null;
}

async function captureOzonSweepStop(
  product: ProductIdentity,
  point: PickupPoint,
  priced: string[],
  unavailable: string[]
): Promise<void> {
  await waitForVisibleOzonPriceOrUnavailable(point.currency);

  if (isVisibleOzonRegionUnavailable()) {
    if (!unavailable.includes(point.externalLocationId)) {
      unavailable.push(point.externalLocationId);
    }
    return;
  }

  // Confirm the page actually switched to this point before recording a price:
  // the private read (no session mutation) only returns a confirmed price for the
  // currently active address, so a reused/ignored switch simply yields no capture.
  try {
    const quote = await requestOzonPrice({
      productId: product.productId,
      productUrl: product.url,
      pickupExternalLocationId: point.externalLocationId,
      currencyHint: point.currency
    });
    await saveManualQuoteForPoint(point, product, quote);
    if (!priced.includes(point.externalLocationId)) {
      priced.push(point.externalLocationId);
    }
    captureStatus = { tone: "normal", message: t("panelAutoCapturedCurrentPrice", { name: ozonPickupDisplayName(point) }) };
  } catch (error) {
    if (isOzonProductUnavailableInRegion(error) && !unavailable.includes(point.externalLocationId)) {
      unavailable.push(point.externalLocationId);
    }
    // Otherwise the switch likely did not take effect; leave this point uncaptured.
  }
}

async function waitForVisibleOzonPriceOrUnavailable(currency: Currency): Promise<void> {
  const deadline = Date.now() + OZON_SWEEP_PRICE_WAIT_MS;
  while (Date.now() < deadline) {
    if (isVisibleOzonRegionUnavailable() || extractVisibleOzonPrice(currency)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function isVisibleOzonRegionUnavailable(): boolean {
  const selectors = ['[data-widget="webPrice"]', '[data-widget*="webPrice" i]', '[data-widget*="price" i]'];
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const text = element.innerText || element.textContent || "";
      if (/товар\s+не\s+доставляется\s+в\s+ваш\s+регион/i.test(text)) {
        return true;
      }
    }
  }
  return false;
}

async function activateOzonAddressAndReload(product: ProductIdentity, externalLocationId: string): Promise<void> {
  try {
    await activateOzonPickupLocationForProduct(product.url, externalLocationId);
  } catch {
    // Reload regardless: a switch that did not take effect is caught when we try
    // to capture the (unconfirmed) price on the reloaded page.
  }
  location.reload();
}

function getCurrentProduct(): ProductIdentity | null {
  const url = new URL(location.href);
  return isOzonProductPage(url) ? getOzonProductIdentity(url, document) : null;
}

function handlePickupCandidatesEvent(event: Event): void {
  const detail = (event as CustomEvent<string>).detail;
  if (!detail) {
    return;
  }
  try {
    const candidates = JSON.parse(detail) as OzonPickupCandidate[];
    if (mergePickupCandidates(candidates)) {
      renderLastPanel();
      scheduleOzonDeliveryAssistSync();
      scheduleCurrentVisibleQuoteCapture();
    }
  } catch {
    // Ignore malformed events from the page world.
  }
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

function mergePickupCandidates(candidates: OzonPickupCandidate[]): boolean {
  const previousKey = pickupCandidateListKey(latestPickupCandidates);
  const byId = new Map(latestPickupCandidates.map((candidate) => [candidate.externalLocationId, candidate]));
  for (const candidate of candidates) {
    if (!candidate.externalLocationId || !candidate.name) {
      continue;
    }
    const existing = byId.get(candidate.externalLocationId);
    if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
      byId.set(candidate.externalLocationId, candidate);
    }
  }
  latestPickupCandidates = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 20);
  const changed = pickupCandidateListKey(latestPickupCandidates) !== previousKey;
  if (changed) {
    scheduleSavedPickupNameSync();
    scheduleGenericPickupNameDiscovery();
  }
  return changed;
}

function pickupCandidateListKey(candidates: OzonPickupCandidate[]): string {
  return candidates.map((candidate) => `${candidate.externalLocationId}:${candidate.name}:${candidate.score}`).join("|");
}

function requestPagePickupCandidates(): void {
  document.dispatchEvent(new CustomEvent(COLLECT_PICKUP_EVENT));
}

async function getBestPickupCandidate(): Promise<OzonPickupCandidate | null> {
  requestPagePickupCandidates();
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  await new Promise((resolve) => setTimeout(resolve, 250));
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  return latestPickupCandidates[0] || null;
}

function collectFallbackCaptureSources(): OzonCaptureSource[] {
  const sources: OzonCaptureSource[] = [];
  const urlHint = location.href;
  collectStorage("localStorage", localStorage, sources, urlHint);
  collectStorage("sessionStorage", sessionStorage, sources, urlHint);
  if (document.cookie) {
    sources.push({ source: "content.cookie", value: document.cookie, urlHint });
  }
  sources.push(...collectCurrentDeliveryPickupSources(urlHint));
  const deliveryText = collectDeliveryText();
  if (deliveryText) {
    sources.push({ source: "content.dom", value: deliveryText, textHint: deliveryText, urlHint });
  }
  return sources;
}

function discoverOzonPickupCandidatesFromApi(product: ProductIdentity): Promise<OzonPickupCandidate[]> {
  const key = `${location.origin}:${product.productId}:${location.pathname}`;
  if (pickupApiDiscoveryKey === key && pickupApiDiscoveryPromise) {
    return pickupApiDiscoveryPromise;
  }
  pickupApiDiscoveryKey = key;
  const discoveryPromise = fetchOzonPickupCandidatesFromApi(product)
    .then((candidates) => {
      if (candidates.length > 0 && mergePickupCandidates(candidates)) {
        renderLastPanel();
        scheduleOzonDeliveryAssistSync();
      }
      return candidates;
    })
    .catch(() => [])
    .finally(() => {
      if (pickupApiDiscoveryPromise === discoveryPromise) {
        pickupApiDiscoveryPromise = null;
      }
    });
  pickupApiDiscoveryPromise = discoveryPromise;
  return discoveryPromise;
}

async function fetchOzonPickupCandidatesFromApi(product: ProductIdentity): Promise<OzonPickupCandidate[]> {
  const sources: OzonCaptureSource[] = [];
  const textHint = collectDeliveryText();
  const endpoints = buildOzonPickupDiscoveryEndpoints(product);

  await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const response = await fetch(endpoint.url, {
          method: endpoint.method,
          credentials: "include",
          headers: endpoint.headers,
          body: endpoint.body
        });
        if (!response.ok) {
          return;
        }
        const text = await response.text();
        if (!text || text.length > 4_000_000) {
          return;
        }
        sources.push({
          source: `api.${endpoint.label}`,
          value: text,
          urlHint: location.href,
          textHint
        });
      } catch {
        // Ozon private endpoints are best-effort discovery only.
      }
    })
  );

  return extractOzonPickupCandidatesFromSources(sources);
}

export function buildOzonPickupDiscoveryEndpoints(product: ProductIdentity): Array<{
  label: string;
  url: string;
  method: "GET" | "POST";
  headers: HeadersInit;
  body?: string;
}> {
  const headers = {
    "content-type": "application/json",
    "x-o3-app-name": "dweb_client",
    "x-o3-app-version": "release"
  };
  const productUrl = new URL(product.url);
  const productPath = `${productUrl.pathname}${productUrl.search}`;
  const encodedProductPath = encodeURIComponent(productPath);
  const modalPaths = [
    "/modal/addressbook",
    "/modal/delivery",
    "/modal/geo"
  ];
  const endpoints: Array<{
    label: string;
    url: string;
    method: "GET" | "POST";
    headers: HeadersInit;
    body?: string;
  }> = [];

  const modalPathVariants = modalPaths.flatMap((modalPath) => [
    { label: modalPath, modalPath },
    ...(modalPath === "/modal/addressbook"
      ? [
          {
            label: `${modalPath}-set-sm`,
            modalPath: `${modalPath}?set_sm=1&page_changed=true`
          },
          {
            label: `${modalPath}-product-context`,
            modalPath: `${modalPath}?src_main=${encodedProductPath}&page_changed=true`
          }
        ]
      : [])
  ]);

  for (const { label, modalPath } of modalPathVariants) {
    const encodedModalPath = encodeURIComponent(modalPath);
    endpoints.push(
      {
        label: `composer-addressbook-${label}`,
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedModalPath}`,
        headers
      },
      {
        label: `entrypoint-addressbook-${label}`,
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedModalPath}`,
        headers
      },
      {
        label: `composer-post-addressbook-${label}`,
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers,
        body: JSON.stringify({
          url: modalPath,
          referer: productPath
        })
      }
    );
  }

  return endpoints;
}

async function refreshSavedOzonPickupNamesOnLoad(product: ProductIdentity, settings: ExtensionSettings): Promise<ExtensionSettings> {
  if (!shouldAutoRefreshSavedOzonPickupNames(settings)) {
    return settings;
  }

  requestPagePickupCandidates();
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  await discoverOzonPickupCandidatesFromApi(product);
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  let nextSettings = await repairUnsafeSavedPickupNames(settings);
  if (!shouldAutoRefreshSavedOzonPickupNames(nextSettings)) {
    return nextSettings;
  }

  await collectPickupNamesFromAutoOpenedSelector(product, nextSettings);
  nextSettings = await repairUnsafeSavedPickupNames(nextSettings);
  return nextSettings;
}

export function shouldAutoRefreshSavedOzonPickupNames(settings: ExtensionSettings): boolean {
  return settings.pickupPoints.some(
    (point) =>
      point.marketplace === "ozon" &&
      point.externalLocationId.trim() !== "" &&
      isGenericOzonPickupName(point.name, point.externalLocationId)
  );
}

async function collectPickupNamesFromAutoOpenedSelector(product: ProductIdentity, settings: ExtensionSettings): Promise<boolean> {
  const genericIds = settings.pickupPoints
    .filter(
      (point) =>
        point.marketplace === "ozon" &&
        point.externalLocationId.trim() !== "" &&
        isGenericOzonPickupName(point.name, point.externalLocationId)
    )
    .map((point) => point.externalLocationId)
    .sort();
  if (genericIds.length === 0) {
    return false;
  }

  const key = `${location.origin}:${product.productId}:${genericIds.join("|")}`;
  if (autoPickupSelectorOpenKeys.has(key)) {
    return false;
  }
  autoPickupSelectorOpenKeys.add(key);

  const existingContainer = findOzonDeliveryContainer();
  if (existingContainer) {
    const collectedFromRows = collectOzonPickupCandidatesFromDeliveryContainer(existingContainer);
    await discoverOzonPickupCandidatesFromApi(product);
    return collectOzonPickupCandidatesFromDeliveryContainer(existingContainer) || collectedFromRows;
  }

  const opener = await waitForOzonDeliverySelectorOpener();
  if (!opener) {
    return false;
  }

  dispatchSyntheticClick(opener);
  const container = await waitForOzonDeliveryContainer();
  if (!container) {
    return false;
  }

  const collectedFromRows = collectOzonPickupCandidatesFromDeliveryContainer(container);
  await discoverOzonPickupCandidatesFromApi(product);
  return collectOzonPickupCandidatesFromDeliveryContainer(container) || collectedFromRows;
}

function scheduleGenericPickupNameDiscovery(): void {
  const genericCandidateIds = latestPickupCandidates
    .filter(
      (candidate) =>
        isGenericOzonPickupName(candidate.name, candidate.externalLocationId) &&
        !targetedPickupDiscoveryIds.has(candidate.externalLocationId)
    )
    .map((candidate) => candidate.externalLocationId)
    .slice(0, 8);
  if (genericCandidateIds.length === 0) {
    return;
  }
  genericCandidateIds.forEach((externalLocationId) => targetedPickupDiscoveryIds.add(externalLocationId));
  const product = getCurrentProduct();
  if (product) {
    discoverOzonPickupCandidatesFromApi(product);
  }
}

function collectStorage(name: string, storage: Storage, sources: OzonCaptureSource[], urlHint: string): void {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !/(ozon|delivery|address|pickup|pvz|location|geo|city|region)/i.test(key)) {
        continue;
      }
      const value = storage.getItem(key);
      if (value) {
        sources.push({ source: `content.${name}.${key}`, value, urlHint });
      }
    }
  } catch {
    // Storage access may be unavailable in some browser/privacy modes.
  }
}

function collectDeliveryText(): string {
  const chunks: string[] = [];
  document
    .querySelectorAll<HTMLElement>(
      '[data-widget*="address" i], [data-widget*="delivery" i], [data-widget*="geo" i], [data-widget*="user" i], [href*="delivery" i], button, a'
    )
    .forEach((element) => {
      const text = element.innerText || element.textContent || "";
      if (/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address)/i.test(text)) {
        chunks.push(text);
      }
    });
  return chunks.slice(0, 30).join(" | ").slice(0, 8000);
}

function collectCurrentDeliveryPickupSources(urlHint: string): OzonCaptureSource[] {
  const sources: OzonCaptureSource[] = [];
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
    if (!text || !/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address|\d)/i.test(text)) {
      return;
    }

    const label = visibleDeliveryPickupLabel(text);
    sources.push({
      source: "content.current-delivery",
      value: {
        name: label || text,
        address: label || text,
        ...collectOzonRowEvidence(element)
      },
      textHint: text,
      urlHint
    });
  });
  return sources;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
    latestSettings = response.settings;
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

async function captureCurrentPriceForPickupPoint(pickupPoint: PickupPoint, product: ProductIdentity): Promise<void> {
  const saved = await saveCurrentVisibleQuoteForPoint(pickupPoint, product, { requireConfirmation: true });
  if (saved) {
    captureStatus = { tone: "normal", message: t("panelCapturedCurrentPrice", { name: ozonPickupDisplayName(pickupPoint) }) };
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
        captureStatus = { tone: "normal", message: t("panelPriceCaptureCancelled") };
        return false;
      }
    } else if (!currentCandidate) {
      const shouldContinue = await requestPanelConfirmation({
        title: t("panelCaptureVisibleTitle"),
        message: t("panelCaptureUnverifiedMessage", { target: pickupPointName }),
        confirmText: t("panelCapturePrice")
      });
      if (!shouldContinue) {
        captureStatus = { tone: "normal", message: t("panelPriceCaptureCancelled") };
        return false;
      }
    }
  }

  const quote = extractVisibleOzonPrice(pickupPoint.currency);
  if (!quote) {
    captureStatus = { tone: "error", message: t("panelVisiblePriceNotFound") };
    return false;
  }

  const updatedSettings = await saveManualQuoteForPoint(pickupPoint, product, quote);
  return Boolean(updatedSettings);
}

async function autoCaptureCurrentVisibleQuote(product: ProductIdentity, settings: ExtensionSettings): Promise<ExtensionSettings> {
  const visibleDeliveryText = collectCurrentDeliverySummaryText();
  if (!visibleDeliveryText) {
    return settings;
  }

  requestPagePickupCandidates();
  const currentCandidates = currentVisibleOzonPickupCandidates();
  mergePickupCandidates([...currentCandidates, ...extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources())]);
  const pickupPoint = findSavedPickupPointForVisibleDelivery(settings, visibleDeliveryText, currentCandidates);
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
    captureStatus = { tone: "normal", message: t("panelAutoCapturedCurrentPrice", { name: ozonPickupDisplayName(pickupPoint) }) };
    return updatedSettings;
  } finally {
    autoCaptureInFlight.delete(lockKey);
  }
}

function scheduleCurrentVisibleQuoteCapture(): void {
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
  if (ozonSweepBusy || loadOzonSweepState()) {
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

  latestSettings = updatedSettings;
  await runIfProductPage();
}

async function repairUnsafeSavedPickupNames(settings: ExtensionSettings): Promise<ExtensionSettings> {
  let nextSettings = settings;

  for (const pickupPoint of settings.pickupPoints) {
    if (pickupPoint.marketplace !== "ozon" || pickupPoint.externalLocationId.trim() === "") {
      continue;
    }

    const repairedName = bestAvailableOzonPickupName(pickupPoint, settings);
    if (repairedName === pickupPoint.name) {
      continue;
    }

    const response = await runtimeRequest({
      type: "UPSERT_PICKUP_POINT",
      pickupPoint: {
        ...pickupPoint,
        name: repairedName
      }
    });
    if (response.ok && "settings" in response) {
      nextSettings = response.settings;
      latestSettings = nextSettings;
    }
  }

  return nextSettings;
}

function bestAvailableOzonPickupName(pickupPoint: PickupPoint, settings: ExtensionSettings): string {
  const candidate = findSafeOzonNameCandidate(pickupPoint);
  const candidateName = candidate ? safeOzonPickupName(candidate.name, pickupPoint.externalLocationId) : "";
  if (candidateName && !isGenericOzonPickupName(candidateName, pickupPoint.externalLocationId)) {
    return candidateName;
  }

  const visibleName = visibleDeliveryPickupLabel(collectCurrentDeliverySummaryText());
  if (visibleName && canUseVisibleDeliveryNameForSavedPoint(settings, pickupPoint)) {
    return visibleName;
  }

  return safeOzonPickupName(candidateName || pickupPoint.name, pickupPoint.externalLocationId);
}

function findSafeOzonNameCandidate(pickupPoint: PickupPoint): OzonPickupCandidate | null {
  const candidate = latestPickupCandidates.find(
    (item) =>
      item.externalLocationId === pickupPoint.externalLocationId &&
      shouldUseOzonPickupName(pickupPoint.name, item.name, pickupPoint.externalLocationId)
  );
  if (!candidate || isCandidateNameSharedAcrossExternalIds(candidate)) {
    return null;
  }
  return candidate;
}

function isCandidateNameSharedAcrossExternalIds(candidate: OzonPickupCandidate): boolean {
  const name = normalizedCandidateDisplayName(candidate);
  if (!name || isGenericOzonPickupName(name, candidate.externalLocationId)) {
    return false;
  }
  const matchingExternalIds = new Set(
    latestPickupCandidates
      .filter((item) => normalizedCandidateDisplayName(item) === name)
      .map((item) => item.externalLocationId)
  );
  return matchingExternalIds.size > 1;
}

function normalizedCandidateDisplayName(candidate: OzonPickupCandidate): string {
  return compactText(safeOzonPickupName(candidate.name, candidate.externalLocationId)).toLowerCase();
}

function quoteMatchesManualQuote(manualQuote: ManualQuote, quote: PriceQuote): boolean {
  return (
    manualQuote.quote.amount === quote.amount &&
    manualQuote.quote.currency === quote.currency &&
    (manualQuote.quote.rawText || "") === (quote.rawText || "")
  );
}

function findSavedPickupPointForVisibleDelivery(
  settings: ExtensionSettings,
  visibleDeliveryText: string,
  currentCandidates: OzonPickupCandidate[] = []
): PickupPoint | null {
  const savedPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "");
  const byExternalId = new Map(savedPoints.map((point) => [point.externalLocationId, point]));
  const explicitCurrentMatches = currentCandidates
    .map((candidate) => byExternalId.get(candidate.externalLocationId))
    .filter((point): point is PickupPoint => Boolean(point));
  const explicitCurrentIds = new Set(explicitCurrentMatches.map((point) => point.id));
  if (explicitCurrentIds.size === 1) {
    const [pointId] = explicitCurrentIds;
    return explicitCurrentMatches.find((point) => point.id === pointId) || null;
  }

  const candidateMatches = latestPickupCandidates
    .map((candidate) => {
      const point = byExternalId.get(candidate.externalLocationId);
      return point
        ? {
            point,
            score: scoreVisiblePickupMatch(`${candidate.name} ${ozonPickupDisplayName(point)} ${point.comment || ""}`, visibleDeliveryText, {
              allowSingleStrongToken: true
            })
          }
        : null;
    })
    .filter((match): match is { point: PickupPoint; score: number } => match !== null && match.score >= 10);

  const directMatches = savedPoints
    .map((point) => ({
      point,
      score: scoreVisiblePickupMatch(`${ozonPickupDisplayName(point)} ${point.comment || ""}`, visibleDeliveryText)
    }))
    .filter((match) => match.score >= 14);

  const byPointId = new Map<string, { point: PickupPoint; score: number }>();
  for (const match of [...candidateMatches, ...directMatches]) {
    const existing = byPointId.get(match.point.id);
    if (!existing || match.score > existing.score) {
      byPointId.set(match.point.id, match);
    }
  }

  const matches = [...byPointId.values()].sort((a, b) => b.score - a.score);
  const [best, second] = matches;
  if (!best) {
    return null;
  }
  if (second && second.score >= best.score - 6) {
    return null;
  }
  return best.point;
}

function scoreVisiblePickupMatch(
  pickupText: string,
  visibleDeliveryText: string,
  options: { allowSingleStrongToken?: boolean } = {}
): number {
  const pickupTokens = pickupMatchTokens(pickupText);
  const visibleTokens = pickupMatchTokens(visibleDeliveryText);
  let score = 0;
  let matchedTokens = 0;
  let hasNumericMatch = false;
  let hasStrongTextMatch = false;

  for (const token of pickupTokens) {
    if (!visibleTokens.has(token)) {
      continue;
    }
    matchedTokens += 1;
    if (/\d/.test(token)) {
      hasNumericMatch = true;
    }
    if (token.length >= 5 && /\p{L}/u.test(token)) {
      hasStrongTextMatch = true;
    }
    score += token.length >= 5 ? 10 : 5;
  }

  if (matchedTokens < 2 && !hasNumericMatch && !(options.allowSingleStrongToken && hasStrongTextMatch)) {
    return 0;
  }
  return score;
}

function collectCurrentDeliverySummaryText(): string {
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
  return collectOzonDeliveryRowCandidates(container)
    .filter((row) => row.candidate && isSelectedOzonDeliveryRow(row.row))
    .map((row) => row.candidate as OzonPickupCandidate);
}

function uniqueOzonPickupCandidates(candidates: OzonPickupCandidate[]): OzonPickupCandidate[] {
  const byId = new Map<string, OzonPickupCandidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.externalLocationId);
    if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
      byId.set(candidate.externalLocationId, candidate);
    }
  }
  return [...byId.values()];
}

function cleanOzonDeliverySummaryText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, [role='button']").forEach((node) => node.remove());
  return stripOzonActionText(compactText(clone.innerText || clone.textContent || ""));
}

function visibleDeliveryPickupLabel(text: string): string {
  const cleaned = stripOzonActionText(text)
    .replace(/^(?:доставка\s+и\s+возврат|доставка|способ\s+получения|адрес\s+доставки)\s+/i, " ")
    .replace(/(?:пункты\s+выдачи\s+ozon|срок\s+хранения\s+заказа|со\s+склада\s+продавца|с\s+\d{1,2}\s+[а-я]+|сегодня|завтра).*$/i, " ");
  const ozonPoint = compactText(cleaned.match(/Пункт\s+Ozon\s*№\s*[\d-]+[^|<>{}\[\]\n\r]{0,140}/i)?.[0] || "");
  const label = compactText(ozonPoint || cleaned).replace(/^[,;|•·\s-]+/, "").replace(/[,;|•·\s-]+$/, "");
  if (!label || label.length < 8 || label.length > 180) {
    return "";
  }
  return /(?:пункт\s+ozon\s*№|пвз|pickup|выдач)/i.test(label) || isAddressLikePickupRowText(label) ? label : "";
}

function canUseVisibleDeliveryNameForSavedPoint(settings: ExtensionSettings, pickupPoint: PickupPoint): boolean {
  if (!isGenericOzonPickupName(pickupPoint.name, pickupPoint.externalLocationId)) {
    return false;
  }
  const genericSavedPoints = settings.pickupPoints.filter(
    (point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "" && isGenericOzonPickupName(point.name, point.externalLocationId)
  );
  return genericSavedPoints.length === 1 && genericSavedPoints[0]?.id === pickupPoint.id;
}

function stripOzonActionText(text: string): string {
  return compactText(
    text.replace(/(?:^|[\s,;|•·-])(?:Редактировать|Изменить|Удалить|Edit|Delete|Remove)(?=$|[\s,;|•·-])/giu, " ")
  );
}

async function saveManualQuoteForPoint(
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
    captureStatus = { tone: "error", message: response.ok ? t("panelCapturedPriceNotSaved") : response.error };
    return null;
  }
  latestSettings = response.settings;
  return response.settings;
}

async function deleteSavedPickupPoint(pickupPoint: PickupPoint, product: ProductIdentity): Promise<void> {
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

  captureStatus = { tone: "normal", message: t("panelDeleted", { name: pickupPointName }) };
  const response = await runtimeRequest({ type: "DELETE_PICKUP_POINT", pickupPointId: pickupPoint.id });
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? t("panelPickupNotDeleted") : response.error };
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

function ensurePanel(): ShadowRoot {
  const existing = document.getElementById(PANEL_ID);
  if (existing?.shadowRoot) {
    return existing.shadowRoot;
  }

  const host = document.createElement("aside");
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const anchor =
    document.querySelector('[data-widget="webPrice"]') ||
    document.querySelector('[data-widget*="price" i]') ||
    document.querySelector("h1")?.parentElement;

  if (anchor?.parentElement) {
    anchor.parentElement.insertBefore(host, anchor.nextSibling);
  } else {
    document.documentElement.append(host);
  }
  return shadow;
}

function removePanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

function installOzonDeliveryMenuAssist(): void {
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

function scheduleOzonDeliveryAssistSync(): void {
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

async function syncCurrentOzonDeliveryMenuAssist(): Promise<void> {
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

function findOzonDeliveryContainer(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], [aria-modal="true"], [data-widget*="dialog" i], [data-widget*="modal" i], [data-widget*="addressbook" i]'
    )
  );
  return (
    candidates.find((element) => isLikelyOzonDeliverySelectorContainer(element)) || null
  );
}

function collectOzonPickupCandidatesFromDeliveryContainer(target: HTMLElement): boolean {
  requestPagePickupCandidates();
  const rows = collectOzonDeliveryRowCandidates(target);
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

async function waitForOzonDeliveryContainer(timeoutMs = 3000): Promise<HTMLElement | null> {
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

async function waitForOzonDeliverySelectorOpener(timeoutMs = 2500): Promise<HTMLElement | null> {
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

function dispatchSyntheticClick(element: HTMLElement): void {
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 120 && rect.height > 40 && rect.bottom > 0 && rect.right > 0;
}

function isVisibleDeliverySummaryElement(element: HTMLElement): boolean {
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

interface OzonPickupRowCandidate {
  row: HTMLElement;
  candidate: OzonPickupCandidate | null;
  rank: number;
  rowKey: string;
}

async function syncOzonDeliveryMenuAssist(target: HTMLElement, assist: HTMLElement, product: ProductIdentity): Promise<void> {
  requestPagePickupCandidates();
  const rows = collectOzonDeliveryRowCandidates(target);
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
      latestSettings = settings;
      await runIfProductPage();
    }
  }
}

function suppressOzonAssistObserver(): void {
  suppressAssistObserverUntil = Date.now() + 300;
}

async function getLatestSettings(): Promise<ExtensionSettings | null> {
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

function scheduleSavedPickupNameSync(): void {
  if (savedPickupNameSyncTimer !== null) {
    return;
  }
  savedPickupNameSyncTimer = window.setTimeout(() => {
    savedPickupNameSyncTimer = null;
    void syncSavedPickupNamesFromCandidates();
  }, 250);
}

async function syncSavedPickupNamesFromCandidates(): Promise<void> {
  if (latestPickupCandidates.length === 0) {
    return;
  }

  let settings = await getLatestSettings();
  if (!settings) {
    return;
  }

  let didUpdate = false;
  for (const pickupPoint of settings.pickupPoints) {
    if (pickupPoint.marketplace !== "ozon" || pickupPoint.externalLocationId.trim() === "") {
      continue;
    }
    const candidate = findSafeOzonNameCandidate(pickupPoint);
    if (!candidate) {
      continue;
    }

    const response = await runtimeRequest({
      type: "UPSERT_PICKUP_POINT",
      pickupPoint: {
        ...pickupPoint,
        name: ozonCandidateDisplayName(candidate)
      }
    });
    if (!response.ok || !("settings" in response)) {
      continue;
    }
    settings = response.settings;
    latestSettings = settings;
    didUpdate = true;
  }

  if (didUpdate) {
    updateLastPanelSettings(settings);
    renderLastPanel();
    scheduleOzonDeliveryAssistSync();
  }
}

function updateLastPanelSettings(settings: ExtensionSettings): void {
  if (!lastPanelModel || !("settings" in lastPanelModel)) {
    return;
  }

  const ozonPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon");
  const byId = new Map(settings.pickupPoints.map((point) => [point.id, point]));
  const refreshPoint = (point: PickupPoint): PickupPoint => byId.get(point.id) || point;

  if (lastPanelModel.state === "loading") {
    lastPanelModel = {
      ...lastPanelModel,
      settings,
      pickupPoints: lastPanelModel.pickupPoints?.map(refreshPoint)
    };
    return;
  }
  if (lastPanelModel.state === "empty") {
    lastPanelModel = {
      ...lastPanelModel,
      settings
    };
    return;
  }
  if (lastPanelModel.state === "noSelection") {
    lastPanelModel = {
      ...lastPanelModel,
      settings,
      allPickupPoints: ozonPoints
    };
    return;
  }
  if (lastPanelModel.state === "results") {
    lastPanelModel = {
      ...lastPanelModel,
      settings,
      pickupPoints: lastPanelModel.pickupPoints.map(refreshPoint)
    };
  }
}

function collectOzonDeliveryRowCandidates(container: HTMLElement): OzonPickupRowCandidate[] {
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
    const candidate = extractOzonPickupCandidateFromRow(row);
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

function isOzonAddAddressControlText(text: string): boolean {
  return /(?:^|\s)(?:добавить|добавьте|add)(?:\s|$)/i.test(text) && /(адрес|пункт\s+выдач|постамат|delivery|pickup)/i.test(text);
}

function hasOzonPickupIdEvidence(element: HTMLElement): boolean {
  const evidence = Object.entries(collectOzonRowEvidence(element))
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return /(select_address|deliveryAddress|addressOid|addressId|addressUid|pickupPoint|pickPoint|pvz|data-address|href)/i.test(evidence);
}

function isAddressLikePickupRowText(text: string): boolean {
  return (
    /(ул\.?|улица|пр-кт|проспект|шоссе|пер\.?|переулок|мкр|микрорайон|дом|д\.|street|avenue|road)/i.test(text) ||
    /(?:^|[\s,])\d{1,4}[а-яa-z]?(?:[\s,]|$)/i.test(text)
  );
}

function extractOzonPickupCandidateFromRow(element: HTMLElement): OzonPickupCandidate | null {
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

  const matched = matchDetectedPickupCandidateToRow(text);
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

function countPickupRowMarkers(text: string): number {
  return (text.match(/(?:пункт\s+ozon|пвз|pickup|выдач)/gi) || []).length;
}

function matchDetectedPickupCandidateToRow(rowText: string): OzonPickupCandidate | null {
  const rowNumber = extractOzonVisiblePointNumber(rowText);
  const rowTokens = pickupMatchTokens(rowText);
  let best: { candidate: OzonPickupCandidate; score: number } | null = null;

  for (const candidate of latestPickupCandidates) {
    const candidateText = `${candidate.name} ${candidate.comment || ""}`;
    const candidateNumber = extractOzonVisiblePointNumber(candidateText);
    let score = 0;
    if (rowNumber && candidateNumber && rowNumber === candidateNumber) {
      score += 100;
    }
    const candidateTokens = pickupMatchTokens(candidateText);
    for (const token of rowTokens) {
      if (candidateTokens.has(token)) {
        score += token.length >= 5 ? 10 : 4;
      }
    }
    if (score < 14) {
      continue;
    }
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best?.candidate || null;
}

function extractOzonVisiblePointNumber(text: string): string {
  return compactText(text.match(/(?:№|N[°o.]?)\s*([\d-]{3,})/i)?.[1] || "");
}

function isSelectedOzonDeliveryRow(row: HTMLElement): boolean {
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

function rowMatchKey(text: string): string {
  return extractOzonVisiblePointNumber(text) || pickupMatchTokens(text).values().next().value || compactText(text).slice(0, 80);
}

function pickupMatchTokens(text: string): Set<string> {
  const lowerText = text.toLowerCase();
  const normalized = lowerText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        (token.length >= 4 || (token.length >= 2 && /\d/.test(token))) &&
        !/^(пункт|ozon|срок|хранения|заказа|дней|адрес|редактировать|изменить|удалить|delivery|pickup|edit|delete|remove)$/.test(
          token
        )
    );
  const numericAddressTokens = lowerText.match(/\d+[\p{L}]?/gu) || [];
  return new Set([...normalized, ...numericAddressTokens].slice(0, 50));
}

function getOzonRowText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-markonverter-pvz-action]").forEach((node) => node.remove());
  return compactText(clone.innerText || clone.textContent || "");
}

function pickupRowName(text: string): string {
  const cleaned = compactText(
    text.replace(
      /(?:^|[\s,;|•-])(?:Add|Saved|Refresh PVZ|Show in panel|Добавить|Сохранено|Обновить ПВЗ|Показать в панели|Удалить|Редактировать|Изменить|Edit|Delete|Remove)(?=$|[\s,;|•-])/giu,
      " "
    ).replace(/(?:срок\s+хранения\s+заказа|storage\s+period).*$/i, " ")
  );
  return cleaned.length > 170 ? `${cleaned.slice(0, 167)}...` : cleaned;
}

function collectOzonRowEvidence(element: HTMLElement): Record<string, string> {
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

function markSavedPickupCandidateInPage(candidate: OzonPickupCandidate): void {
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

type PanelModel =
  | { state: "loading"; product: ProductIdentity; settings?: ExtensionSettings; pickupPoints?: PickupPoint[] }
  | { state: "empty"; product: ProductIdentity; settings: ExtensionSettings }
  | { state: "noSelection"; product: ProductIdentity; settings: ExtensionSettings; allPickupPoints: PickupPoint[] }
  | { state: "fatal"; product: ProductIdentity; message: string }
  | {
      state: "results";
      product: ProductIdentity;
      settings: ExtensionSettings;
      pickupPoints: PickupPoint[];
      results: ComparisonResult[];
    };

interface PanelComparisonRow {
  pickupPoint: PickupPoint;
  result: ComparisonResult | null;
  deltaFromCheapest?: number;
  isCheapest: boolean;
  isSelected: boolean;
}

function currentI18n(settings: ExtensionSettings | null = latestSettings): Translator {
  return createTranslator(settings?.language);
}

function panelI18n(model: PanelModel): Translator {
  const settings = "settings" in model ? model.settings : latestSettings;
  return createTranslator(settings?.language);
}

function t(key: I18nKey, params?: Record<string, string | number>): string {
  return currentI18n().t(key, params);
}

function isDebugModeEnabled(settings: ExtensionSettings | null = latestSettings): boolean {
  return settings?.debug === true;
}

function panelDebugEnabled(model: PanelModel): boolean {
  return isDebugModeEnabled("settings" in model ? model.settings : latestSettings);
}

function renderPanel(shadow: ShadowRoot, model: PanelModel): void {
  const i18n = panelI18n(model);
  lastPanelModel = model;
  // Background re-renders (candidate events, name sync, storage changes) must
  // not wipe an open confirmation dialog mid-click; defer them until answered.
  if (pendingPanelConfirmationCancel) {
    panelRenderDeferredByConfirmation = true;
    return;
  }
  shadow.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = panelCss();
  shadow.append(style);

  const root = document.createElement("section");
  root.className = "panel";
  root.classList.toggle("collapsed", isPanelCollapsed);
  if (!document.body.contains(shadow.host)) {
    root.classList.add("floating");
  }

  const header = document.createElement("div");
  header.className = "header";
  header.innerHTML = `<div class="headerTitle"><span class="eyebrow">Markonverter</span><strong>${escapeHtml(
    i18n.t("panelPickupPrices")
  )}</strong><span>${escapeHtml(model.product.title || i18n.t("panelProductFallback"))}</span></div>`;

  const headerActions = document.createElement("div");
  headerActions.className = "headerActions";

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "iconButton settingsButton";
  settingsButton.setAttribute("aria-label", i18n.t("panelOpenSettings"));
  settingsButton.title = i18n.t("panelSettings");
  settingsButton.textContent = "\u2699";
  settingsButton.addEventListener("click", () => {
    openOptionsPage();
  });

  const collapseButton = document.createElement("button");
  collapseButton.type = "button";
  collapseButton.className = "iconButton collapseButton";
  const collapseButtonLabel = isPanelCollapsed ? i18n.t("panelExpand") : i18n.t("panelCollapse");
  collapseButton.setAttribute("aria-label", collapseButtonLabel);
  collapseButton.title = collapseButtonLabel;
  const collapseIcon = document.createElement("span");
  collapseIcon.className = isPanelCollapsed ? "chevronIcon chevronDown" : "chevronIcon chevronUp";
  collapseIcon.setAttribute("aria-hidden", "true");
  collapseButton.append(collapseIcon);
  collapseButton.addEventListener("click", () => {
    void setPanelCollapsed(!isPanelCollapsed);
  });

  headerActions.append(settingsButton, collapseButton);
  header.append(headerActions);
  root.append(header);

  if (isPanelCollapsed) {
    shadow.append(root);
    return;
  }

  if (model.state === "loading") {
    root.append(messageNode(i18n.t("panelCheckingPickupPoints", { count: model.pickupPoints?.length ?? i18n.t("panelConfiguredPickupPoints") })));
    if (captureStatus) {
      root.append(messageNode(captureStatus.message, captureStatus.tone));
    }
  } else if (model.state === "empty") {
    root.append(messageNode(i18n.t("panelNoOzonPickupPoints")));
    appendDetectedPickupCandidates(root, model.settings, model.product, true);
    appendCaptureStatus(root);
  } else if (model.state === "noSelection") {
    root.append(messageNode(i18n.t("panelNoSavedSelected")));
    appendPickupRows(root, model.settings, [], [], model.product);
    appendDetectedPickupCandidates(root, model.settings, model.product, false);
    appendCaptureStatus(root);
  } else if (model.state === "fatal") {
    root.append(messageNode(model.message, "error"));
  } else {
    appendPickupRows(root, model.settings, model.pickupPoints, model.results, model.product);
    appendDetectedPickupCandidates(root, model.settings, model.product, false);
    appendCaptureStatus(root);
  }

  if (panelDebugEnabled(model)) {
    appendOzonFixtureTools(root);
  }
  shadow.append(root);
}

function renderLastPanel(): void {
  if (lastPanelModel) {
    renderPanel(ensurePanel(), lastPanelModel);
  }
}

interface PanelConfirmationOptions {
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
}

let panelRenderDeferredByConfirmation = false;

function cancelPendingPanelConfirmation(): void {
  if (!pendingPanelConfirmationCancel) {
    return;
  }
  const cancel = pendingPanelConfirmationCancel;
  pendingPanelConfirmationCancel = null;
  cancel();
}

function flushDeferredPanelRender(): void {
  if (!panelRenderDeferredByConfirmation) {
    return;
  }
  panelRenderDeferredByConfirmation = false;
  renderLastPanel();
}

async function requestPanelConfirmation(options: PanelConfirmationOptions): Promise<boolean> {
  cancelPendingPanelConfirmation();
  const shadow = ensurePanel();
  const panel = shadow.querySelector<HTMLElement>(".panel");
  if (!panel || isPanelCollapsed) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    const existing = shadow.getElementById(PANEL_CONFIRMATION_ID);
    existing?.remove();

    const wrapper = document.createElement("div");
    wrapper.id = PANEL_CONFIRMATION_ID;
    wrapper.className = `panelConfirmation${options.danger ? " danger" : ""}`;
    wrapper.tabIndex = -1;

    const text = document.createElement("div");
    text.className = "panelConfirmationText";
    const title = document.createElement("strong");
    title.textContent = options.title;
    const message = document.createElement("span");
    message.textContent = options.message;
    text.append(title, message);

    const actions = document.createElement("div");
    actions.className = "panelConfirmationActions";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "confirmButton secondaryButton";
    cancelButton.textContent = options.cancelText || t("panelCancel");
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = `confirmButton${options.danger ? " danger" : ""}`;
    confirmButton.textContent = options.confirmText;
    actions.append(cancelButton, confirmButton);
    wrapper.append(text, actions);

    let resolved = false;
    const finish = (confirmed: boolean): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      wrapper.remove();
      if (pendingPanelConfirmationCancel === cancelCurrent) {
        pendingPanelConfirmationCancel = null;
      }
      flushDeferredPanelRender();
      resolve(confirmed);
    };
    const cancelCurrent = (): void => finish(false);
    pendingPanelConfirmationCancel = cancelCurrent;

    cancelButton.addEventListener("click", () => finish(false), { once: true });
    confirmButton.addEventListener("click", () => finish(true), { once: true });
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        finish(false);
      }
    });

    panel.append(wrapper);
    wrapper.scrollIntoView({ block: "nearest" });
    cancelButton.focus();
  });
}

async function loadPanelState(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(PANEL_STATE_KEY);
    isPanelCollapsed = normalizePanelState(stored[PANEL_STATE_KEY]).collapsed;
  } catch {
    isPanelCollapsed = false;
  }
}

function normalizePanelState(value: unknown): { collapsed: boolean } {
  const candidate = value as Partial<{ collapsed: boolean }> | undefined;
  return { collapsed: candidate?.collapsed === true };
}

async function setPanelCollapsed(collapsed: boolean): Promise<void> {
  if (collapsed === isPanelCollapsed) {
    return;
  }

  const transitionVersion = ++panelTransitionVersion;
  const currentPanel = currentPanelElement();
  const fromRect = currentPanel?.getBoundingClientRect();

  if (collapsed && currentPanel && fromRect) {
    const collapsedHeight = measureHeaderOnlyPanelHeight(currentPanel);
    await animatePanelBox(
      currentPanel,
      { width: fromRect.width, height: fromRect.height },
      { width: fromRect.width, height: collapsedHeight },
      PANEL_COLLAPSE_DURATION_MS,
      false
    );
    if (transitionVersion !== panelTransitionVersion) {
      return;
    }
  }

  isPanelCollapsed = collapsed;
  renderLastPanel();

  if (!collapsed && fromRect) {
    const expandedPanel = currentPanelElement();
    const toRect = expandedPanel?.getBoundingClientRect();
    if (expandedPanel && toRect) {
      await animatePanelBox(
        expandedPanel,
        { width: fromRect.width, height: fromRect.height },
        { width: toRect.width, height: toRect.height },
        PANEL_EXPAND_DURATION_MS
      );
    }
  }

  try {
    await chrome.storage.local.set({ [PANEL_STATE_KEY]: { collapsed } });
  } catch {
    // Keep the current page responsive even if extension storage is temporarily unavailable.
  }
  if (!collapsed) {
    await runIfProductPage();
  }
}

function currentPanelElement(): HTMLElement | null {
  const host = document.getElementById(PANEL_ID);
  return host?.shadowRoot?.querySelector<HTMLElement>(".panel") || null;
}

function measureHeaderOnlyPanelHeight(panel: HTMLElement): number {
  const panelRect = panel.getBoundingClientRect();
  const header = panel.querySelector<HTMLElement>(".header");
  if (!header) {
    return panelRect.height;
  }
  const borderHeight = Math.max(0, panelRect.height - panel.clientHeight);
  return header.getBoundingClientRect().height + borderHeight;
}

async function animatePanelBox(
  panel: HTMLElement,
  from: { width: number; height: number },
  to: { width: number; height: number },
  duration: number,
  cleanup = true
): Promise<void> {
  if (!Number.isFinite(from.width) || !Number.isFinite(from.height) || from.width <= 0 || from.height <= 0) {
    return;
  }

  const previous = {
    width: panel.style.width,
    height: panel.style.height,
    maxHeight: panel.style.maxHeight,
    overflow: panel.style.overflow,
    pointerEvents: panel.style.pointerEvents,
    willChange: panel.style.willChange
  };

  panel.style.width = `${from.width}px`;
  panel.style.height = `${from.height}px`;
  panel.style.maxHeight = `${from.height}px`;
  panel.style.overflow = "hidden";
  panel.style.pointerEvents = "none";
  panel.style.willChange = "width, height, max-height";

  const animation = panel.animate(
    [
      {
        width: `${from.width}px`,
        height: `${from.height}px`,
        maxHeight: `${from.height}px`
      },
      {
        width: `${to.width}px`,
        height: `${to.height}px`,
        maxHeight: `${to.height}px`
      }
    ],
    {
      duration,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards"
    }
  );

  await animation.finished.catch(() => undefined);
  if (!cleanup) {
    return;
  }
  panel.style.width = previous.width;
  panel.style.height = previous.height;
  panel.style.maxHeight = previous.maxHeight;
  panel.style.overflow = previous.overflow;
  panel.style.pointerEvents = previous.pointerEvents;
  panel.style.willChange = previous.willChange;
}

function appendCaptureStatus(root: HTMLElement): void {
  if (captureStatus) {
    root.append(messageNode(captureStatus.message, captureStatus.tone));
  }
}

function appendOzonFixtureTools(root: HTMLElement): void {
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

async function refreshOzonFixtureSummary(): Promise<void> {
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

function getSavedOzonExternalIds(settings: ExtensionSettings | null): Set<string> {
  return new Set(
    (settings?.pickupPoints || [])
      .filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "")
      .map((point) => point.externalLocationId)
  );
}

function ozonCandidateDisplayName(candidate: OzonPickupCandidate): string {
  return safeOzonPickupName(candidate.name, candidate.externalLocationId);
}

function ozonPickupDisplayName(pickupPoint: PickupPoint): string {
  if (pickupPoint.marketplace !== "ozon") {
    return pickupPoint.name;
  }
  return safeOzonPickupName(pickupPoint.name, pickupPoint.externalLocationId);
}

function appendPickupRows(
  root: HTMLElement,
  settings: ExtensionSettings,
  comparedPickupPoints: PickupPoint[],
  results: ComparisonResult[],
  product: ProductIdentity
): void {
  const rows = buildPanelComparisonRows(settings, comparedPickupPoints, results);
  if (rows.length > 0) {
    root.append(renderPickupRows(rows, product, settings));
  }
}

function buildPanelComparisonRows(
  settings: ExtensionSettings,
  comparedPickupPoints: PickupPoint[],
  results: ComparisonResult[]
): PanelComparisonRow[] {
  const comparedRows = buildComparisonRows(comparedPickupPoints, results);
  const comparedByPointId = new Map(comparedRows.map((row) => [row.pickupPoint.id, row]));
  return settings.pickupPoints
    .filter((point) => point.marketplace === "ozon")
    .map((pickupPoint) => {
      const compared = comparedByPointId.get(pickupPoint.id);
      if (compared) {
        return { ...compared, isSelected: true };
      }
      return {
        pickupPoint,
        result: null,
        isCheapest: false,
        isSelected: isComparisonPointSelected(pickupPoint, settings)
      };
    });
}

function isComparisonPointSelected(pickupPoint: PickupPoint, settings: ExtensionSettings): boolean {
  return settings.comparisonPickupPointIds ? settings.comparisonPickupPointIds.includes(pickupPoint.id) : true;
}

function renderPickupRows(rows: PanelComparisonRow[], product: ProductIdentity, settings: ExtensionSettings): HTMLElement {
  const i18n = currentI18n(settings);
  const list = document.createElement("div");
  list.className = "rows";

  for (const row of rows) {
    const item = document.createElement("div");
    const isRegionUnavailableWarning = row.result?.status === "error" && isOzonProductUnavailableInRegion(row.result.error);
    item.className = `row${row.isCheapest ? " cheapest" : ""}${
      row.result?.status === "error" ? (isRegionUnavailableWarning ? " warning" : " failed") : ""
    }${
      row.isSelected ? "" : " unselected"
    }`;

    const meta = document.createElement("div");
    meta.className = "meta";

    const metaHead = document.createElement("div");
    metaHead.className = "metaHead";

    const metaText = document.createElement("div");
    metaText.className = "metaText";
    metaText.innerHTML = `<strong>${escapeHtml(ozonPickupDisplayName(row.pickupPoint))}</strong>`;
    const rowActions = document.createElement("div");
    rowActions.className = "rowHoverActions";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "deleteButton rowDeleteButton";
    deleteButton.textContent = i18n.t("optionsDelete");
    deleteButton.title = i18n.t("panelDeletePickupTitle");
    deleteButton.addEventListener("click", () => {
      void deleteSavedPickupPoint(row.pickupPoint, product);
    });
    rowActions.append(deleteButton);
    metaHead.append(metaText, rowActions);
    meta.append(metaHead);

    const value = document.createElement("div");
    value.className = "value";
    if (!row.result) {
      const idle = document.createElement("strong");
      idle.textContent = row.isSelected ? i18n.t("panelWaiting") : i18n.t("panelNotCompared");
      const hint = document.createElement("span");
      hint.textContent = row.isSelected ? i18n.t("panelWaitingHint") : i18n.t("panelEnableInSettings");
      value.append(idle, hint);
    } else if (row.result.status === "success") {
      const original = formatCurrency(row.result.originalPrice.amount, row.result.originalPrice.currency, i18n.locale);
      const converted = formatCurrency(row.result.convertedAmount, row.result.convertedCurrency, i18n.locale);
      const capturedTitle =
        row.result.originalPrice.source === "manual"
          ? i18n.t("panelCapturedTitle", { time: formatCapturedAt(row.result.originalPrice.capturedAt, i18n) })
          : "";
      const delta =
        row.deltaFromCheapest && row.deltaFromCheapest > 0
          ? `+${formatCurrency(row.deltaFromCheapest, row.result.convertedCurrency, i18n.locale)}`
          : row.isCheapest
            ? i18n.t("panelBest")
            : "";
      const details = [
        row.result.originalPrice.currency === row.result.convertedCurrency ? "" : original,
        delta
      ].filter(Boolean);
      if (capturedTitle) {
        value.title = capturedTitle;
      }
      value.innerHTML = `<strong>${converted}</strong>${
        details.length > 0 ? `<span class="original">${escapeHtml(details.join(" "))}</span>` : ""
      }`;
    } else {
      const error = row.result.error;
      value.title = error;
      const unavailable = document.createElement("strong");
      unavailable.textContent = isRegionUnavailableWarning ? i18n.t("panelRegionUnavailable") : i18n.t("panelUnavailable");
      const reason = document.createElement("span");
      reason.textContent = readableResultError(error, i18n);
      const actions = document.createElement("div");
      actions.className = "failureActions";
      const detailsButton = document.createElement("button");
      detailsButton.type = "button";
      detailsButton.className = "detailsButton";
      detailsButton.textContent = i18n.t("panelCopyDetails");
      detailsButton.title = i18n.t("panelCopyDetailsTitle");
      detailsButton.addEventListener("click", () => {
        void copyFailureDiagnostics(row.pickupPoint, error, product);
      });
      if (!isRegionUnavailableWarning) {
        const captureButton = document.createElement("button");
        captureButton.type = "button";
        captureButton.className = "saveSmallButton";
        captureButton.textContent = i18n.t("panelCaptureCurrent");
        captureButton.title = i18n.t("panelCaptureCurrentTitle");
        captureButton.addEventListener("click", () => {
          void captureCurrentPriceForPickupPoint(row.pickupPoint, product);
        });
        actions.append(captureButton);
      }
      if (settings.debug) {
        actions.append(detailsButton);
      }
      value.append(unavailable, reason);
      if (actions.childNodes.length > 0) {
        value.append(actions);
      }
    }

    item.append(meta, value);
    list.append(item);
  }

  return list;
}

function appendDetectedPickupCandidates(
  root: HTMLElement,
  settings: ExtensionSettings,
  product: ProductIdentity,
  showEmptyHint: boolean
): void {
  const list = detectedPickupCandidateList(settings, product, showEmptyHint);
  if (list) {
    root.append(list);
  }
}

function detectedPickupCandidateList(settings: ExtensionSettings, product: ProductIdentity, showEmptyHint: boolean): HTMLElement | null {
  const i18n = currentI18n(settings);
  const savedExternalIds = getSavedOzonExternalIds(settings);
  const detected = latestPickupCandidates.filter((candidate) => !savedExternalIds.has(candidate.externalLocationId)).slice(0, 8);
  if (detected.length === 0 && !showEmptyHint) {
    return null;
  }

  const isCollapsed = detectedPickupListCollapsedOverride ?? savedExternalIds.size >= 2;
  const wrapper = document.createElement("div");
  wrapper.className = `detectedCandidates${isCollapsed ? " collapsed" : ""}`;

  const detectedHeader = document.createElement("div");
  detectedHeader.className = "detectedCandidatesTop";
  const headerText = document.createElement("div");
  headerText.innerHTML = `<span class="eyebrow">${escapeHtml(i18n.t("panelDetectedEyebrow"))}</span><strong>${escapeHtml(
    i18n.t("panelNewPickupPoints")
  )}</strong>`;

  const headerActions = document.createElement("div");
  headerActions.className = "detectedHeaderActions";
  const count = document.createElement("span");
  count.textContent = i18n.t("panelNewCount", { count: detected.length });
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "iconButton detectedToggleButton";
  const toggleLabel = i18n.t(isCollapsed ? "panelShowNewPickupPoints" : "panelHideNewPickupPoints");
  toggleButton.setAttribute("aria-controls", DETECTED_PICKUP_LIST_ID);
  toggleButton.setAttribute("aria-expanded", String(!isCollapsed));
  toggleButton.setAttribute("aria-label", toggleLabel);
  toggleButton.title = toggleLabel;
  const toggleIcon = document.createElement("span");
  toggleIcon.className = isCollapsed ? "chevronIcon chevronDown" : "chevronIcon chevronUp";
  toggleIcon.setAttribute("aria-hidden", "true");
  toggleButton.append(toggleIcon);
  toggleButton.addEventListener("click", () => {
    detectedPickupListCollapsedOverride = !isCollapsed;
    renderLastPanel();
  });
  headerActions.append(count, toggleButton);
  detectedHeader.append(headerText, headerActions);
  wrapper.append(detectedHeader);

  if (isCollapsed) {
    return wrapper;
  }

  const body = document.createElement("div");
  body.id = DETECTED_PICKUP_LIST_ID;
  body.className = "detectedCandidatesBody";

  if (detected.length === 0) {
    const hint = document.createElement("p");
    hint.className = "pointManagerHint";
    hint.textContent = i18n.t("panelDetectedHint");
    body.append(hint);
    wrapper.append(body);
    return wrapper;
  }

  for (const candidate of detected) {
    const row = document.createElement("div");
    row.className = "detectedCandidate";

    const text = document.createElement("span");
    text.className = "detectedCandidateText";
    text.innerHTML = `<strong>${escapeHtml(ozonCandidateDisplayName(candidate))}</strong><span>${escapeHtml(candidate.country)} / ${escapeHtml(
      candidate.currency
    )}</span>`;

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "saveSmallButton";
    saveButton.textContent = i18n.t("panelSave");
    saveButton.addEventListener("click", () => {
      void saveDetectedPickupCandidate(candidate, product);
    });

    row.append(text, saveButton);
    body.append(row);
  }

  wrapper.append(body);
  return wrapper;
}

async function saveDetectedPickupCandidate(candidate: OzonPickupCandidate, product: ProductIdentity): Promise<void> {
  const candidateName = ozonCandidateDisplayName(candidate);
  captureStatus = { tone: "normal", message: t("panelSaving", { name: candidateName }) };
  renderLastPanel();

  const response = await savePickupCandidate(candidate, product);
  if (!response.ok || !("settings" in response)) {
    captureStatus = { tone: "error", message: response.ok ? t("panelPickupNotSaved") : response.error };
    renderLastPanel();
    return;
  }

  const savedPoint = response.settings.pickupPoints.find(
    (point) => point.marketplace === "ozon" && point.externalLocationId === candidate.externalLocationId
  );
  if (!savedPoint) {
    captureStatus = { tone: "error", message: t("panelPickupLimitReached", { count: MAX_SAVED_OZON_PICKUP_POINTS }) };
    renderLastPanel();
    await syncCurrentOzonDeliveryMenuAssist();
    return;
  }
  const quoteCaptured =
    isCurrentVisibleOzonPickupCandidate(candidate)
      ? await saveCurrentVisibleQuoteForPoint(savedPoint, product, { requireConfirmation: false })
      : false;
  captureStatus = {
    tone: "normal",
    message: quoteCaptured ? t("panelSavedAndCaptured", { name: candidateName }) : t("panelSaved", { name: candidateName })
  };
  await syncCurrentOzonDeliveryMenuAssist();
  await runIfProductPage();
  await syncCurrentOzonDeliveryMenuAssist();
}

function isCurrentVisibleOzonPickupCandidate(candidate: OzonPickupCandidate): boolean {
  if (currentVisibleOzonPickupCandidates().some((item) => item.externalLocationId === candidate.externalLocationId)) {
    return true;
  }
  const visibleDeliveryText = collectCurrentDeliverySummaryText();
  return visibleDeliveryText ? scoreVisiblePickupMatch(candidate.name, visibleDeliveryText, { allowSingleStrongToken: true }) >= 10 : false;
}

function messageNode(text: string, tone: "normal" | "error" = "normal"): HTMLElement {
  const node = document.createElement("p");
  node.className = `message ${tone}`;
  node.textContent = text;
  return node;
}

function openOptionsPage(): void {
  // No window.open fallback: options.html is not web-accessible, so a page
  // context can never navigate to it — the fallback only opened a dead tab.
  void runtimeRequest({ type: "OPEN_OPTIONS" }).catch(() => undefined);
}

function readableResultError(error: string, i18n: Translator = currentI18n()): string {
  if (isOzonProductUnavailableInRegion(error)) {
    return i18n.t("panelRegionUnavailableHint");
  }
  if (error.includes("response did not confirm requested pickup point")) {
    return i18n.t("panelOzonDidNotConfirm");
  }
  return error.length > 150 ? `${error.slice(0, 147)}...` : error;
}

function formatCapturedAt(value: string | undefined, i18n: Translator = currentI18n()): string {
  if (!value) {
    return i18n.t("panelCapturedFromPage");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return i18n.t("panelCapturedFromPage");
  }
  return date.toLocaleString(i18n.locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function copyFailureDiagnostics(pickupPoint: PickupPoint, error: string, product: ProductIdentity): Promise<void> {
  const diagnostics = {
    product,
    pickupPoint: {
      id: pickupPoint.id,
      name: ozonPickupDisplayName(pickupPoint),
      country: pickupPoint.country,
      currency: pickupPoint.currency,
      externalLocationId: pickupPoint.externalLocationId,
      comment: pickupPoint.comment
    },
    error,
    detectedPickupCandidates: latestPickupCandidates.slice(0, 5).map((candidate) => ({
      externalLocationId: candidate.externalLocationId,
      name: ozonCandidateDisplayName(candidate),
      country: candidate.country,
      currency: candidate.currency,
      source: candidate.source,
      score: candidate.score,
      comment: candidate.comment
    })),
    pageUrl: location.href,
    copiedAt: new Date().toISOString()
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    captureStatus = { tone: "normal", message: t("panelCopiedDiagnostics") };
  } catch {
    captureStatus = { tone: "error", message: t("panelCopyDiagnosticsBlocked") };
  }
  renderLastPanel();
}

async function runtimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  try {
    return await chrome.runtime.sendMessage(request);
  } catch (error) {
    isExtensionContextGone();
    throw error;
  }
}

// After an extension reload/update, orphaned content scripts keep running but
// every runtime call throws. Latch the condition so timers/observers go quiet
// instead of spamming errors once per second in every open Ozon tab.
let extensionContextGone = false;

function isExtensionContextGone(): boolean {
  if (!extensionContextGone && !chrome.runtime?.id) {
    extensionContextGone = true;
  }
  return extensionContextGone;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
