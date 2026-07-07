// Panel body sections: saved pickup-point comparison rows, the detected
// pickup-candidate list, and failure diagnostics. The panel shell lives in
// ./render; app state and row actions are imported from ../app — the import
// cycles are intentional and function-level only.

import { buildComparisonRows } from "../../shared/comparison";
import { formatCurrency } from "../../shared/currency";
import { type Translator } from "../../shared/i18n";
import { ComparisonResult, ExtensionSettings, PickupPoint, ProductIdentity } from "../../shared/types";
import { OzonPickupCandidate } from "../../marketplaces/ozon/pickup-capture";
import { ozonCandidateDisplayName, ozonPickupDisplayName } from "../../marketplaces/ozon/pickup-matching";
import { isOzonProductUnavailableInRegion } from "../../marketplaces/ozon/private-api";
import { currentI18n, deleteSavedPickupPoint, t } from "../app";
import { latestPickupCandidates } from "../ozon-candidates";
import { captureCurrentPriceForPickupPoint, saveDetectedPickupCandidate } from "../ozon-quote-capture";
import { escapeHtml, renderLastPanel, setCaptureStatus } from "./render";

const DETECTED_PICKUP_LIST_ID = "markonverter-detected-pickup-list";

let detectedPickupListCollapsedOverride: boolean | null = null;

export function resetDetectedPickupListCollapse(): void {
  detectedPickupListCollapsedOverride = null;
}

interface PanelComparisonRow {
  pickupPoint: PickupPoint;
  result: ComparisonResult | null;
  deltaFromCheapest?: number;
  isCheapest: boolean;
  isSelected: boolean;
}

export function getSavedOzonExternalIds(settings: ExtensionSettings | null): Set<string> {
  return new Set(
    (settings?.pickupPoints || [])
      .filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "")
      .map((point) => point.externalLocationId)
  );
}

export function appendPickupRows(
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
    deleteButton.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M6 1.5a1 1 0 0 0-1 1V3H2.5a.75.75 0 0 0 0 1.5h.55l.64 9.14A1.5 1.5 0 0 0 5.19 15h5.62a1.5 1.5 0 0 0 1.5-1.36l.64-9.14h.55a.75.75 0 0 0 0-1.5H11v-.5a1 1 0 0 0-1-1H6Zm0 1.5v-.5h4V3H6Zm-1.44 1.5h6.88l-.63 9H5.19l-.63-9ZM6.5 6.75a.75.75 0 0 1 1.5 0v5.5a.75.75 0 0 1-1.5 0v-5.5Zm2.5 0a.75.75 0 0 1 1.5 0v5.5a.75.75 0 0 1-1.5 0v-5.5Z"/>' +
      "</svg>";
    deleteButton.setAttribute("aria-label", i18n.t("optionsDelete"));
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

export function appendDetectedPickupCandidates(
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
    detectedPickupCandidates: latestPickupCandidates.slice(0, 5).map((candidate: OzonPickupCandidate) => ({
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
    setCaptureStatus({ tone: "normal", message: t("panelCopiedDiagnostics") });
  } catch {
    setCaptureStatus({ tone: "error", message: t("panelCopyDiagnosticsBlocked") });
  }
  renderLastPanel();
}
