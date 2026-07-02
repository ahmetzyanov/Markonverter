import { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import {
  CurrencyRateProvider,
  ExtensionSettings,
  PickupPoint,
  SUPPORTED_CURRENCY_RATE_PROVIDERS
} from "../shared/types";
import { normalizeSettings } from "../shared/validation";

const RATE_PROVIDER_LABELS: Record<CurrencyRateProvider, string> = {
  manual: "Manual",
  cbr: "CBR",
  nbk: "National Bank KZ",
  exchangeRateApi: "ExchangeRate-API"
};

let settings: ExtensionSettings;
let saveChain: Promise<void> = Promise.resolve();
let saveVersion = 0;

const elements = {
  rateProvider: mustGet<HTMLSelectElement>("rateProvider"),
  defaultCurrency: mustGet<HTMLSelectElement>("defaultCurrency"),
  rateRub: mustGet<HTMLInputElement>("rateRub"),
  rateKzt: mustGet<HTMLInputElement>("rateKzt"),
  saveCurrency: mustGet<HTMLButtonElement>("saveCurrency"),
  refreshCurrency: mustGet<HTMLButtonElement>("refreshCurrency"),
  currencyRateInfo: mustGet<HTMLSpanElement>("currencyRateInfo"),
  pointList: mustGet<HTMLDivElement>("pointList"),
  status: mustGet<HTMLDivElement>("status")
};

void init();

async function init(): Promise<void> {
  const response = await runtimeRequest({ type: "GET_SETTINGS" });
  if (!response.ok || !("settings" in response)) {
    setStatus(response.ok ? "Settings are unavailable" : response.error, true);
    settings = normalizeSettings(undefined);
  } else {
    settings = response.settings;
  }
  render();
  bindEvents();
}

function bindEvents(): void {
  elements.rateProvider.addEventListener("change", () => {
    updateRateControls();
  });

  elements.saveCurrency.addEventListener("click", () => {
    const provider = readRateProvider();
    settings = normalizeSettings({
      ...settings,
      currencyRateProvider: provider,
      currencyRateMeta:
        provider === "manual"
          ? { provider: "manual", updatedAt: new Date().toISOString() }
          : provider === settings.currencyRateProvider
            ? settings.currencyRateMeta
            : undefined,
      defaultCurrency: elements.defaultCurrency.value,
      ratesToRub: {
        RUB: Number(elements.rateRub.value),
        KZT: Number(elements.rateKzt.value)
      }
    });
    enqueueSaveSettings("Currency saved");
  });

  elements.refreshCurrency.addEventListener("click", () => {
    void refreshCurrencyRates();
  });

}

function render(): void {
  elements.rateProvider.value = settings.currencyRateProvider;
  elements.defaultCurrency.value = settings.defaultCurrency;
  elements.rateRub.value = String(settings.ratesToRub.RUB);
  elements.rateKzt.value = String(settings.ratesToRub.KZT);
  renderCurrencyRateInfo();
  updateRateControls();
  renderPointList();
}

async function refreshCurrencyRates(): Promise<void> {
  if (readRateProvider() === "manual") {
    setStatus("Manual rates are saved from the input fields");
    return;
  }
  setSaving(true);
  setStatus("Updating currency rates");
  try {
    const response = await runtimeRequest({ type: "REFRESH_CURRENCY_RATES", provider: readRateProvider() });
    if (!response.ok || !("settings" in response)) {
      setStatus(response.ok ? "Currency rates were not updated" : response.error, true);
      return;
    }
    settings = response.settings;
    render();
    setStatus(formatRateUpdateStatus(response.rateResult || settings.currencyRateMeta));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    setSaving(false);
  }
}

function renderCurrencyRateInfo(): void {
  if (settings.currencyRateProvider === "manual") {
    elements.currencyRateInfo.textContent = settings.currencyRateMeta?.updatedAt
      ? `Manual, ${formatDate(settings.currencyRateMeta.updatedAt)}`
      : "Manual rates";
    return;
  }

  const meta = settings.currencyRateMeta;
  if (!meta) {
    elements.currencyRateInfo.textContent = "Saved rates";
    return;
  }

  const date = formatDate(meta.updatedAt);
  const fallback = meta.fallbackUsed ? " fallback" : "";
  const effectiveDate = meta.effectiveDate ? `, ${meta.effectiveDate}` : "";
  elements.currencyRateInfo.textContent = `${RATE_PROVIDER_LABELS[meta.provider]}${fallback}, ${date}${effectiveDate}`;
}

function renderPointList(): void {
  elements.pointList.innerHTML = "";
  if (settings.pickupPoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "point";
    empty.innerHTML = "<strong>No pickup points configured.</strong><span>Add points from an Ozon delivery selector on a product page.</span>";
    elements.pointList.append(empty);
    return;
  }

  settings.pickupPoints.forEach((point, index) => {
    const row = document.createElement("div");
    row.className = "point";

    const meta = document.createElement("div");
    meta.innerHTML = `<strong>${escapeHtml(point.name)}</strong><span>${escapeHtml(point.marketplace)} / ${escapeHtml(point.country)} / ${escapeHtml(point.currency)} / ${escapeHtml(point.externalLocationId)}</span>`;

    const actions = document.createElement("div");
    actions.className = "actions";

    const compared = isPointCompared(point);
    const compare = button(
      compared ? "Compared" : "Skipped",
      compared ? "Exclude from product-page comparison" : "Include in product-page comparison",
      () => togglePointComparison(point.id),
      compared ? "compareState" : "compareState isSkipped"
    );
    const up = button("Up", "Move up", () => movePoint(index, -1));
    const down = button("Down", "Move down", () => movePoint(index, 1));
    const remove = button("Delete", "Delete", () => removePoint(point.id), "danger");
    up.disabled = index === 0;
    down.disabled = index === settings.pickupPoints.length - 1;
    actions.append(compare, up, down, remove);

    row.append(meta, actions);
    elements.pointList.append(row);
  });
}

function isPointCompared(point: PickupPoint): boolean {
  return point.marketplace !== "ozon" || settings.comparisonPickupPointIds === null || settings.comparisonPickupPointIds.includes(point.id);
}

function togglePointComparison(pointId: string): void {
  const ozonIds = settings.pickupPoints.filter((point) => point.marketplace === "ozon").map((point) => point.id);
  const selected = new Set(settings.comparisonPickupPointIds ?? ozonIds);
  const isSelected = selected.has(pointId);
  if (isSelected) {
    selected.delete(pointId);
  } else {
    selected.add(pointId);
  }

  const nextIds = ozonIds.filter((id) => selected.has(id));
  settings.comparisonPickupPointIds = nextIds.length === ozonIds.length ? null : nextIds;
  enqueueSaveSettings(isSelected ? "Pickup point skipped" : "Pickup point compared");
}

function movePoint(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= settings.pickupPoints.length) {
    return;
  }
  const next = [...settings.pickupPoints];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  settings.pickupPoints = next;
  enqueueSaveSettings("Order saved");
}

function removePoint(id: string): void {
  settings.pickupPoints = settings.pickupPoints.filter((point) => point.id !== id);
  enqueueSaveSettings("Pickup point deleted");
}

function readRateProvider(): CurrencyRateProvider {
  return SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(elements.rateProvider.value as never)
    ? (elements.rateProvider.value as CurrencyRateProvider)
    : "cbr";
}

function enqueueSaveSettings(message: string): void {
  const version = ++saveVersion;
  const snapshot = structuredClone(settings);
  setSaving(true);
  saveChain = saveChain
    .then(async () => {
      const response = await runtimeRequest({ type: "SAVE_SETTINGS", settings: snapshot });
      if (version !== saveVersion) {
        return;
      }
      if (!response.ok || !("settings" in response)) {
        setStatus(response.ok ? "Settings were not saved" : response.error, true);
        return;
      }
      settings = response.settings;
      render();
      setStatus(message);
    })
    .catch((error) => {
      if (version === saveVersion) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    })
    .finally(() => {
      if (version === saveVersion) {
        setSaving(false);
      }
    });
}

function button(text: string, title: string, onClick: () => void, className = ""): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.title = title;
  if (className) {
    node.className = className;
  }
  node.addEventListener("click", onClick);
  return node;
}

async function runtimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(request);
}

function setStatus(message: string, error = false): void {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

function setSaving(isSaving: boolean): void {
  elements.saveCurrency.disabled = isSaving;
  elements.refreshCurrency.disabled = isSaving || readRateProvider() === "manual";
  elements.pointList.querySelectorAll("button").forEach((button) => {
    button.disabled = isSaving;
  });
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function updateRateControls(): void {
  elements.refreshCurrency.disabled = readRateProvider() === "manual";
  elements.refreshCurrency.title =
    readRateProvider() === "manual" ? "Manual rates are saved from the input fields" : "Fetch the selected source now";
}

function formatRateUpdateStatus(meta: ExtensionSettings["currencyRateMeta"]): string {
  if (!meta) {
    return "Currency rates updated";
  }

  const fallback = meta.fallbackUsed ? " via fallback" : "";
  return `Currency rates updated from ${RATE_PROVIDER_LABELS[meta.provider]}${fallback}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
