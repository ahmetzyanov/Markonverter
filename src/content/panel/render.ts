// The floating comparison panel: model + shell rendering, the in-panel
// confirmation dialog, and collapse/expand state with its animation. Row and
// candidate sections live in ./sections, fixture tools in ../fixtures, and app
// state/i18n comes from ../app — the import cycles are intentional and
// function-level only.

import { createTranslator, type Translator } from "../../shared/i18n";
import { ComparisonResult, ExtensionSettings, PickupPoint, ProductIdentity } from "../../shared/types";
import { isDebugModeEnabled, latestSettings, runIfProductPage, t } from "../app";
import { appendOzonFixtureTools } from "../fixtures";
import { PANEL_ID } from "../ids";
import { runtimeRequest } from "../runtime";
import { appendDetectedPickupCandidates, appendPickupRows } from "./sections";
import { panelCss } from "./styles";

const PANEL_CONFIRMATION_ID = "markonverter-panel-confirmation";
const PANEL_STATE_KEY = "markonverter.panelState";
const PANEL_COLLAPSE_DURATION_MS = 220;
const PANEL_EXPAND_DURATION_MS = 240;

export type PanelModel =
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

let lastPanelModel: PanelModel | null = null;
const CAPTURE_STATUS_AUTO_HIDE_MS = 3000;

let captureStatus: { tone: "normal" | "error"; message: string } | null = null;
let captureStatusHideTimer: ReturnType<typeof setTimeout> | null = null;
export let isPanelCollapsed = false;
let pendingPanelConfirmationCancel: (() => void) | null = null;
let panelRenderDeferredByConfirmation = false;
let panelTransitionVersion = 0;

export function setCaptureStatus(status: { tone: "normal" | "error"; message: string } | null): void {
  captureStatus = status;
  if (captureStatusHideTimer !== null) {
    clearTimeout(captureStatusHideTimer);
    captureStatusHideTimer = null;
  }
  if (status) {
    captureStatusHideTimer = setTimeout(() => {
      captureStatusHideTimer = null;
      captureStatus = null;
      renderLastPanel();
    }, CAPTURE_STATUS_AUTO_HIDE_MS);
  }
}

export function ensurePanel(): ShadowRoot {
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

export function removePanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

export function updateLastPanelSettings(settings: ExtensionSettings): void {
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

function panelI18n(model: PanelModel): Translator {
  const settings = "settings" in model ? model.settings : latestSettings;
  return createTranslator(settings?.language);
}

function panelDebugEnabled(model: PanelModel): boolean {
  return isDebugModeEnabled("settings" in model ? model.settings : latestSettings);
}

export function renderPanel(shadow: ShadowRoot, model: PanelModel): void {
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
  header.innerHTML = `<div class="headerTitle"><span class="eyebrow">Markonverter</span></div>`;

  const headerActions = document.createElement("div");
  headerActions.className = "headerActions";

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "iconButton settingsButton";
  settingsButton.setAttribute("aria-label", i18n.t("panelOpenSettings"));
  settingsButton.title = i18n.t("panelSettings");
  settingsButton.textContent = "⚙";
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
      root.append(messageNode(captureStatus.message, captureStatus.tone, true));
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

export function renderLastPanel(): void {
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

export async function requestPanelConfirmation(options: PanelConfirmationOptions): Promise<boolean> {
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

export async function loadPanelState(): Promise<void> {
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
    root.append(messageNode(captureStatus.message, captureStatus.tone, true));
  }
}

function messageNode(text: string, tone: "normal" | "error" = "normal", autoHide = false): HTMLElement {
  const node = document.createElement("p");
  node.className = `message ${tone}${autoHide ? " autoHide" : ""}`;
  node.textContent = text;
  return node;
}

function openOptionsPage(): void {
  // No window.open fallback: options.html is not web-accessible, so a page
  // context can never navigate to it — the fallback only opened a dead tab.
  void runtimeRequest({ type: "OPEN_OPTIONS" }).catch(() => undefined);
}

export function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
