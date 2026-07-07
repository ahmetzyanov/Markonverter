// The two Ozon price sweeps. Session persistence lives in ozon-sweep-session.ts;
// panel/state glue (saveManualQuoteForPoint, capture status, i18n) is imported
// from app.ts — the import cycle is intentional and function-level only.

import {
  activateOzonPickupLocationForProduct,
  fetchOzonPrivatePrice,
  fetchOzonSelectedLocationId,
  isOzonPickupNotConfirmed,
  isOzonProductUnavailableInRegion,
  isOzonRequestsThrottled
} from "../marketplaces/ozon/private-api";
import { ozonPickupDisplayName } from "../marketplaces/ozon/pickup-matching";
import { manualQuoteKey } from "../shared/settings";
import { Currency, ExtensionSettings, PickupPoint, ProductIdentity } from "../shared/types";
import {
  activeRun,
  latestSettings,
  saveManualQuoteForPoint,
  t
} from "./app";
import { currentOzonExternalLocationId } from "./ozon-quote-capture";
import { isPanelCollapsed, setCaptureStatus } from "./panel/render";
import { findOzonDeliveryContainer, waitForOzonDeliveryContainerToClose } from "./ozon-delivery-dom";
import {
  canPersistOzonSweepState,
  clearOzonSweepState,
  isOzonPickupActivationDoomed,
  isOzonPickupSessionUnavailable,
  isOzonProductSilentSwept,
  isOzonProductSwept,
  isOzonSweepThrottled,
  loadOzonSweepState,
  markOzonPickupActivationDoomed,
  markOzonProductSilentSwept,
  markOzonProductSwept,
  markOzonSweepThrottled,
  OzonSweepState,
  persistOzonSessionUnavailable,
  saveOzonSweepState
} from "./ozon-sweep-session";
import { extractVisibleOzonPrice } from "./page/visible-price";

const OZON_SWEEP_PRICE_WAIT_MS = 6000;
let ozonSweepBusy = false;

export function isOzonSweepBusy(): boolean {
  return ozonSweepBusy;
}

// ---- Silent Ozon price sweep (option 3) ----------------------------------------
// Prices non-active saved points without page reloads: activates each point
// through the private API (select_address), takes the confirmed price read, then
// restores the originally selected point and confirms the restore. The page DOM
// stays on the original point the whole time, so the session is desynced only
// inside this window: the sweep refuses to start (and stops mid-run) while
// Ozon's native delivery selector is open, and never leaves the page silently
// desynced — the bug that reverted the first silent-activation attempt
// (41f123a). When the restore cannot be confirmed it hands off to the visible
// reload sweep's state machine (below), seeded with the true original point, so
// the return still happens through navigation that can cross an ozon.ru/ozon.kz
// domain flip. Runs once per product per tab session; whatever it leaves
// unpriced (including cross-country points it must not touch) falls through to
// that reload sweep too.

// Pricing a point from the other Ozon country needs the other domain: the
// same-origin private API can switch the session to it, but then both the
// price read and the restore come back as redirects/challenges. Only the
// reload sweep's navigation machinery handles that, so the silent sweep is
// limited to points matching the page's domain currency.
function ozonHostCurrency(hostname: string): Currency | null {
  if (hostname === "ozon.kz" || hostname.endsWith(".ozon.kz")) {
    return "KZT";
  }
  if (hostname === "ozon.ru" || hostname.endsWith(".ozon.ru")) {
    return "RUB";
  }
  return null;
}

function ozonSilentSweepPendingPoints(
  product: ProductIdentity,
  settings: ExtensionSettings,
  comparisonPoints: PickupPoint[]
): PickupPoint[] {
  const pageCurrency = ozonHostCurrency(location.hostname);
  return comparisonPoints.filter(
    (point) =>
      point.externalLocationId.trim() !== "" &&
      point.currency === pageCurrency &&
      !settings.manualQuotes[manualQuoteKey(product.productId, point.id)] &&
      !isOzonPickupSessionUnavailable(product.productId, point.externalLocationId) &&
      !isOzonPickupActivationDoomed(point.externalLocationId)
  );
}

export function shouldStartOzonSilentPriceSweep(
  product: ProductIdentity,
  settings: ExtensionSettings,
  comparisonPoints: PickupPoint[]
): boolean {
  if (isPanelCollapsed || ozonSweepBusy) {
    return false;
  }
  // The once-per-session mark and the reload-sweep handoff both live in
  // sessionStorage; without persistence a failed-restore reload would re-run
  // the sweep forever, so never start.
  if (!canPersistOzonSweepState()) {
    return false;
  }
  // Ozon's antibot is already engaged for this session; starting another
  // multi-request sweep now only deepens the block.
  if (isOzonSweepThrottled()) {
    return false;
  }
  if (isOzonProductSilentSwept(product.productId) || isOzonProductSwept(product.productId) || loadOzonSweepState()) {
    return false;
  }
  // While the native delivery selector is open, switching the session address
  // underneath it desyncs what the user is looking at.
  if (findOzonDeliveryContainer()) {
    return false;
  }
  return ozonSilentSweepPendingPoints(product, settings, comparisonPoints).length > 0;
}

export async function runOzonSilentPriceSweep(
  product: ProductIdentity,
  settings: ExtensionSettings,
  comparisonPoints: PickupPoint[],
  runId: number
): Promise<"reloading" | "done"> {
  ozonSweepBusy = true;
  markOzonProductSilentSwept(product.productId);
  // Once a handoff state is saved and the page is reloading, the busy flag
  // must stay set so nothing advances the seeded state machine against the
  // dying page's DOM (same pattern as the reload sweep).
  let outcome: "reloading" | "done" = "done";
  try {
    // Ozon's own selected-address id is the restore target; without it a
    // restore cannot be verified, so leave the work to the reload sweep.
    const originalActive = await fetchOzonSelectedLocationId(product.url).catch(() => null);
    if (!originalActive) {
      return "done";
    }

    const pending = ozonSilentSweepPendingPoints(product, settings, comparisonPoints).filter(
      (point) => point.externalLocationId !== originalActive
    );
    if (pending.length === 0) {
      return "done";
    }
    const originalHref = location.href;
    const priced: string[] = [];
    const unavailable: string[] = [];
    let touchedSession = false;

    for (const point of pending) {
      // Stop pricing when the run went stale (SPA navigation), the user
      // opened the native selector, or Ozon is already blocking this session
      // (hammering the remaining points would only deepen the block); fall
      // through to the restore below so the session is put back where it
      // started.
      if (runId !== activeRun || findOzonDeliveryContainer() || isOzonSweepThrottled()) {
        break;
      }
      touchedSession = true;
      try {
        const quote = await fetchOzonPrivatePrice({
          productId: product.productId,
          productUrl: product.url,
          pickupExternalLocationId: point.externalLocationId,
          currencyHint: point.currency,
          allowSessionMutatingLocationActivation: true
        });
        await saveManualQuoteForPoint(point, product, quote);
        priced.push(point.externalLocationId);
        setCaptureStatus({ tone: "normal", message: t("panelAutoCapturedCurrentPrice", { name: ozonPickupDisplayName(point) }) });
      } catch (error) {
        if (isOzonProductUnavailableInRegion(error)) {
          unavailable.push(point.externalLocationId);
        } else if (isOzonRequestsThrottled(error)) {
          markOzonSweepThrottled();
        } else if (isOzonPickupNotConfirmed(error)) {
          // Confirmation failed after the full candidate escalation: this is a
          // structural id-space mismatch, not a transient miss, so no later
          // product page should retry it this session either.
          markOzonPickupActivationDoomed(point.externalLocationId);
        }
        // Any other failure (network hiccup, ambiguous price, ...) is
        // transient: leave the point unpriced for the reload sweep to retry
        // rather than doom it.
      }
    }
    persistOzonSessionUnavailable(product.productId, unavailable);

    if (!touchedSession) {
      return "done";
    }

    // Restoring (or reloading) underneath an open native selector recreates
    // the 41f123a interaction bug, so wait for it to close first. On timeout
    // proceed anyway: an unrestored session is worse, and if the user is mid
    // selection their own pick will set the session explicitly.
    await waitForOzonDeliveryContainerToClose(30_000);

    const restoreConfirmed = await activateOzonPickupLocationForProduct(product.url, originalActive).catch(() => false);
    if (restoreConfirmed) {
      return "done";
    }
    // The activation response did not confirm; ask Ozon which point is
    // actually selected before concluding the restore failed.
    const selectedNow = await fetchOzonSelectedLocationId(product.url).catch(() => null);
    if (selectedNow === originalActive) {
      return "done";
    }
    if (runId !== activeRun || findOzonDeliveryContainer()) {
      // An SPA navigation replaced the page (it already reflects the mutated
      // session) or the user is inside the native selector (their own pick
      // sets the session explicitly); yanking the page around now is worse.
      // ponytail: known ceiling — in these two rare exits a failed restore
      // leaves the switched pickup point in place.
      return "done";
    }
    // Restore unconfirmed: hand off to the reload-sweep state machine instead
    // of a bare resync reload. Seeded with the true origin it re-prices what
    // is still missing (including points this sweep is not allowed to touch),
    // returns to the original point via the navigation-based machinery that
    // handles domain flips, and finalizes on the next load(s) — nothing
    // lingers that could later fight a manual pickup change by the user.
    const latest = latestSettings || settings;
    const handoffPending = comparisonPoints
      .filter(
        (point) =>
          point.externalLocationId.trim() !== "" &&
          point.externalLocationId !== originalActive &&
          !priced.includes(point.externalLocationId) &&
          !latest.manualQuotes[manualQuoteKey(product.productId, point.id)] &&
          !isOzonPickupSessionUnavailable(product.productId, point.externalLocationId) &&
          !isOzonPickupActivationDoomed(point.externalLocationId)
      )
      .map((point) => point.externalLocationId);
    const state: OzonSweepState = {
      productId: product.productId,
      originalActive,
      originalHref,
      pending: handoffPending,
      priced,
      unavailable,
      returnStage: 0
    };
    saveOzonSweepState(state);
    if (handoffPending.length === 0) {
      // Either reloads toward the origin or finalizes in place.
      outcome = await beginOzonSweepReturn(product, state, selectedNow);
      return outcome;
    }
    await activateOzonAddressAndReload(product, handoffPending[0]);
    outcome = "reloading";
    return outcome;
  } finally {
    if (outcome !== "reloading") {
      ozonSweepBusy = false;
    }
  }
}

// ---- Visible Ozon price sweep (option 2) --------------------------------------
// To price a pickup point that is not currently selected, Ozon requires switching
// the active delivery address. Instead of doing that silently in the background
// (which desynced the page from the server and broke the native selector), the
// sweep switches the address and reloads the product page onto each saved pickup
// point in turn, records its confirmed price, then returns to the original point
// (or, if the original point cannot deliver the product, to an available one).
// State survives the reloads via ozon-sweep-session.ts.

export function shouldStartOzonPriceSweep(
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
  // Ozon's antibot is already engaged for this session; starting another
  // multi-request sweep now only deepens the block.
  if (isOzonSweepThrottled()) {
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
      !isOzonPickupSessionUnavailable(product.productId, point.externalLocationId) &&
      !isOzonPickupActivationDoomed(point.externalLocationId)
  );
}

export async function startOzonPriceSweep(
  product: ProductIdentity,
  settings: ExtensionSettings,
  comparisonPoints: PickupPoint[]
): Promise<boolean> {
  if (ozonSweepBusy) {
    return true;
  }
  ozonSweepBusy = true;

  const pointByExternalId = new Map(
    comparisonPoints
      .filter((point) => point.externalLocationId.trim() !== "" && !isOzonPickupActivationDoomed(point.externalLocationId))
      .map((point) => [point.externalLocationId, point])
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

export async function continueOzonPriceSweep(product: ProductIdentity, settings: ExtensionSettings): Promise<"reloading" | "done"> {
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
      // The pre-navigation switch usually already took; skip the extra reload.
      const selected = await fetchOzonSelectedLocationId(product.url).catch(() => null);
      if (selected === state.originalActive) {
        finalizeOzonSweep(product, state);
        ozonSweepBusy = false;
        return "done";
      }
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
  // Ozon is already blocking this session: skip the capture attempt (it would
  // just 403 again) and give up on every remaining pending point rather than
  // reloading through each one while blocked.
  if (point && isOzonSweepThrottled()) {
    state.pending = [];
  } else if (point) {
    const stop = await captureOzonSweepStop(product, point, state.priced, state.unavailable);
    persistOzonSessionUnavailable(product.productId, state.unavailable);
    // Unresolved means the address switch likely did not take (Ozon kept the
    // previous point). Retry the switch once before giving the point up —
    // otherwise it surfaces as "Ozon did not confirm this pickup point".
    if (!stop.resolved && !state.retriedHead) {
      state.retriedHead = true;
      saveOzonSweepState(state);
      await activateOzonAddressAndReload(product, captureTarget);
      return "reloading";
    }
    if (!stop.resolved && state.retriedHead && stop.confirmationFailed) {
      // Second consecutive confirmation failure for the same target: this is
      // a structural id-space mismatch, not a transient miss, so no later
      // product page should retry it this session either.
      markOzonPickupActivationDoomed(captureTarget);
    }
  }

  state.retriedHead = false;
  state.pending = state.pending.slice(1);
  if (state.pending.length > 0 && !isOzonSweepThrottled()) {
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
    // Switch the session back before navigating: the original domain redirects
    // straight back here while the session still points at the other country's
    // address. Best effort — stage 1 verifies and reselects if it did not take.
    await activateOzonPickupLocationForProduct(product.url, finishTarget).catch(() => false);
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

interface OzonSweepStopResult {
  // False means the address switch likely did not take effect (or Ozon is
  // throttling): the point is left uncaptured.
  resolved: boolean;
  // True only when the failure was specifically Ozon never confirming the
  // switched pickup point, as opposed to a network hiccup or other transient
  // miss. Only this failure kind justifies remembering the point as doomed.
  confirmationFailed?: boolean;
}

async function captureOzonSweepStop(
  product: ProductIdentity,
  point: PickupPoint,
  priced: string[],
  unavailable: string[]
): Promise<OzonSweepStopResult> {
  await waitForVisibleOzonPriceOrUnavailable(point.currency);

  if (isVisibleOzonRegionUnavailable()) {
    if (!unavailable.includes(point.externalLocationId)) {
      unavailable.push(point.externalLocationId);
    }
    return { resolved: true };
  }

  // Confirm the page actually switched to this point before recording a price:
  // the private read (no session mutation) only returns a confirmed price for the
  // currently active address, so a reused/ignored switch simply yields no capture.
  try {
    const quote = await fetchOzonPrivatePrice({
      productId: product.productId,
      productUrl: product.url,
      pickupExternalLocationId: point.externalLocationId,
      currencyHint: point.currency
    });
    await saveManualQuoteForPoint(point, product, quote);
    if (!priced.includes(point.externalLocationId)) {
      priced.push(point.externalLocationId);
    }
    setCaptureStatus({ tone: "normal", message: t("panelAutoCapturedCurrentPrice", { name: ozonPickupDisplayName(point) }) });
    return { resolved: true };
  } catch (error) {
    if (isOzonProductUnavailableInRegion(error)) {
      if (!unavailable.includes(point.externalLocationId)) {
        unavailable.push(point.externalLocationId);
      }
      return { resolved: true };
    }
    if (isOzonRequestsThrottled(error)) {
      // Ozon is already blocking this session; retrying this same stop would
      // just trigger another 403, so treat it as resolved (uncaptured) rather
      // than burning a retry-then-reload on it.
      markOzonSweepThrottled();
      return { resolved: true };
    }
    // The switch likely did not take effect; leave this point uncaptured.
    // Only flag it as a confirmation failure (candidate for doom-marking) when
    // that's precisely what happened — a network hiccup or ambiguous price
    // should just be retried, never doomed.
    return { resolved: false, confirmationFailed: isOzonPickupNotConfirmed(error) };
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
