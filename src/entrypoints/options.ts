import { RuntimeRequest, RuntimeResponse } from "../shared/messages";
import {
  CurrencyRateProvider,
  ExtensionSettings,
  PickupPoint,
  SUPPORTED_CURRENCY_RATE_PROVIDERS
} from "../shared/types";
import { normalizeSettings } from "../shared/validation";
import {
  createTranslator,
  type I18nKey,
  languageLabel,
  type LanguagePreference,
  normalizeLanguagePreference,
  type Translator
} from "../shared/i18n";

let settings: ExtensionSettings = normalizeSettings(undefined);
let saveChain: Promise<void> = Promise.resolve();
let saveVersion = 0;

const elements = {
  language: mustGet<HTMLSelectElement>("language"),
  saveLanguage: mustGet<HTMLButtonElement>("saveLanguage"),
  languageResolved: mustGet<HTMLSpanElement>("languageResolved"),
  debug: mustGet<HTMLInputElement>("debug"),
  saveDebug: mustGet<HTMLButtonElement>("saveDebug"),
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
    settings = normalizeSettings(undefined);
    setStatus(response.ok ? currentI18n().t("optionsSettingsUnavailable") : response.error, true);
  } else {
    settings = response.settings;
  }
  render();
  bindEvents();
}

function bindEvents(): void {
  elements.saveLanguage.addEventListener("click", () => {
    settings = normalizeSettings({
      ...settings,
      language: readLanguagePreference()
    });
    enqueueSaveSettings("optionsLanguageSaved");
  });

  elements.saveDebug.addEventListener("click", () => {
    settings = normalizeSettings({
      ...settings,
      debug: elements.debug.checked
    });
    enqueueSaveSettings("optionsDebugSaved");
  });

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
    enqueueSaveSettings("optionsCurrencySaved");
  });

  elements.refreshCurrency.addEventListener("click", () => {
    void refreshCurrencyRates();
  });

}

function render(): void {
  const i18n = currentI18n();
  applyPageTranslations(i18n);
  renderLanguageOptions(i18n);
  renderRateProviderOptions(i18n);
  elements.language.value = settings.language;
  elements.debug.checked = settings.debug;
  elements.rateProvider.value = settings.currencyRateProvider;
  elements.defaultCurrency.value = settings.defaultCurrency;
  elements.rateRub.value = String(settings.ratesToRub.RUB);
  elements.rateKzt.value = String(settings.ratesToRub.KZT);
  renderCurrencyRateInfo();
  updateRateControls();
  renderPointList();
}

async function refreshCurrencyRates(): Promise<void> {
  const i18n = currentI18n();
  if (readRateProvider() === "manual") {
    setStatus(i18n.t("optionsManualRatesSavedFromInputs"));
    return;
  }
  setSaving(true);
  setStatus(i18n.t("optionsUpdatingCurrencyRates"));
  try {
    const response = await runtimeRequest({ type: "REFRESH_CURRENCY_RATES", provider: readRateProvider() });
    if (!response.ok || !("settings" in response)) {
      setStatus(response.ok ? i18n.t("optionsCurrencyRatesNotUpdated") : response.error, true);
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
  const i18n = currentI18n();
  if (settings.currencyRateProvider === "manual") {
    elements.currencyRateInfo.textContent = settings.currencyRateMeta?.updatedAt
      ? `${i18n.t("rateProviderManual")}, ${formatDate(settings.currencyRateMeta.updatedAt)}`
      : i18n.t("optionsManualRates");
    return;
  }

  const meta = settings.currencyRateMeta;
  if (!meta) {
    elements.currencyRateInfo.textContent = i18n.t("optionsSavedRates");
    return;
  }

  const date = formatDate(meta.updatedAt);
  const fallback = meta.fallbackUsed ? i18n.t("optionsFallback") : "";
  const effectiveDate = meta.effectiveDate ? `, ${meta.effectiveDate}` : "";
  elements.currencyRateInfo.textContent = `${rateProviderLabel(meta.provider)}${fallback}, ${date}${effectiveDate}`;
}

function renderPointList(): void {
  const i18n = currentI18n();
  elements.pointList.innerHTML = "";
  if (settings.pickupPoints.length === 0) {
    const empty = document.createElement("div");
    empty.className = "point";
    empty.innerHTML = `<strong>${escapeHtml(i18n.t("optionsNoPickupPointsTitle"))}</strong><span>${escapeHtml(
      i18n.t("optionsNoPickupPointsHint")
    )}</span>`;
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
      compared ? i18n.t("optionsCompared") : i18n.t("optionsSkipped"),
      compared ? i18n.t("optionsCompareTitleExclude") : i18n.t("optionsCompareTitleInclude"),
      () => togglePointComparison(point.id),
      compared ? "compareState" : "compareState isSkipped"
    );
    const up = button(i18n.t("optionsUp"), i18n.t("optionsMoveUp"), () => movePoint(index, -1));
    const down = button(i18n.t("optionsDown"), i18n.t("optionsMoveDown"), () => movePoint(index, 1));
    const remove = button(i18n.t("optionsDelete"), i18n.t("optionsDelete"), () => removePoint(point.id), "danger");
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
  enqueueSaveSettings(isSelected ? "optionsPickupSkipped" : "optionsPickupCompared");
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
  enqueueSaveSettings("optionsOrderSaved");
}

function removePoint(id: string): void {
  settings.pickupPoints = settings.pickupPoints.filter((point) => point.id !== id);
  enqueueSaveSettings("optionsPickupDeleted");
}

function readRateProvider(): CurrencyRateProvider {
  return SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(elements.rateProvider.value as never)
    ? (elements.rateProvider.value as CurrencyRateProvider)
    : "cbr";
}

function enqueueSaveSettings(messageKey: I18nKey): void {
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
        setStatus(response.ok ? currentI18n().t("optionsSettingsNotSaved") : response.error, true);
        return;
      }
      settings = response.settings;
      render();
      setStatus(currentI18n().t(messageKey));
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
  elements.language.disabled = isSaving;
  elements.saveLanguage.disabled = isSaving;
  elements.debug.disabled = isSaving;
  elements.saveDebug.disabled = isSaving;
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
    readRateProvider() === "manual" ? currentI18n().t("optionsManualRatesSavedFromInputs") : currentI18n().t("optionsUpdateRates");
}

function formatRateUpdateStatus(meta: ExtensionSettings["currencyRateMeta"]): string {
  const i18n = currentI18n();
  if (!meta) {
    return i18n.t("optionsCurrencyRatesUpdated");
  }

  const fallback = meta.fallbackUsed ? i18n.t("optionsFallback") : "";
  return i18n.t("optionsCurrencyRatesUpdatedFrom", { provider: rateProviderLabel(meta.provider), fallback });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(currentI18n().locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function currentI18n(): Translator {
  return createTranslator(settings?.language);
}

function applyPageTranslations(i18n: Translator): void {
  document.documentElement.lang = i18n.language;
  document.title = i18n.t("optionsDocumentTitle");
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n as I18nKey | undefined;
    if (key) {
      node.textContent = i18n.t(key);
    }
  });
  elements.languageResolved.textContent = i18n.t("optionsLanguageResolved", { language: languageLabel(i18n.language) });
}

function renderLanguageOptions(i18n: Translator): void {
  const labels: Record<LanguagePreference, string> = {
    ru: i18n.t("languageRu"),
    en: i18n.t("languageEn"),
    auto: i18n.t("languageAuto")
  };
  for (const option of Array.from(elements.language.options)) {
    option.textContent = labels[normalizeLanguagePreference(option.value)];
  }
}

function renderRateProviderOptions(i18n: Translator): void {
  const labels: Record<CurrencyRateProvider, string> = {
    manual: i18n.t("rateProviderManual"),
    cbr: i18n.t("rateProviderCbr"),
    nbk: i18n.t("rateProviderNbk"),
    exchangeRateApi: i18n.t("rateProviderExchangeRateApi")
  };
  for (const option of Array.from(elements.rateProvider.options)) {
    const provider = option.value as CurrencyRateProvider;
    if (SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(provider)) {
      option.textContent = labels[provider];
    }
  }
}

function rateProviderLabel(provider: CurrencyRateProvider): string {
  const i18n = currentI18n();
  const labels: Record<CurrencyRateProvider, I18nKey> = {
    manual: "rateProviderManual",
    cbr: "rateProviderCbr",
    nbk: "rateProviderNbk",
    exchangeRateApi: "rateProviderExchangeRateApi"
  };
  return i18n.t(labels[provider]);
}

function readLanguagePreference(): LanguagePreference {
  return normalizeLanguagePreference(elements.language.value);
}
