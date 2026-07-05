export type SupportedLanguage = "ru" | "en";
export type LanguagePreference = "auto" | SupportedLanguage;

export const DEFAULT_LANGUAGE: SupportedLanguage = "ru";
export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "ru";
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["ru", "en"];
export const SUPPORTED_LANGUAGE_PREFERENCES: LanguagePreference[] = ["auto", ...SUPPORTED_LANGUAGES];

const RU_MESSAGES = {
  appName: "Markonverter",
  appShortName: "Markonverter",
  optionsDocumentTitle: "Настройки Markonverter",
  optionsTopEyebrow: "Консоль цен Ozon",
  optionsLede: "Сравнивайте сохраненные ПВЗ, настраивайте курсы валют и управляйте Ozon-точками, найденными на страницах товаров.",
  optionsLanguageEyebrow: "Интерфейс",
  optionsLanguageHeading: "Язык",
  optionsLanguageHint: "Применяется к панели на Ozon и странице настроек",
  optionsLanguageSelectLabel: "Язык интерфейса",
  optionsLanguageResolved: "Сейчас: {language}",
  optionsSaveLanguage: "Сохранить язык",
  optionsDebugLabel: "Debug режим",
  optionsDebugHint: "Показывает диагностические действия и запись фикстур Ozon.",
  optionsSaveDebug: "Сохранить debug",
  optionsDebugSaved: "Debug режим сохранен",
  optionsRatesEyebrow: "Курсы",
  optionsRatesHeading: "Валюта",
  optionsRatesHint: "Используется в панели сравнения на странице товара",
  optionsRateSource: "Источник курса",
  optionsDefaultComparison: "Валюта сравнения",
  optionsRateRub: "1 RUB в RUB",
  optionsRateKzt: "1 KZT в RUB",
  optionsSaveCurrency: "Сохранить валюту",
  optionsUpdateRates: "Обновить курсы",
  optionsSavedLocationsEyebrow: "Сохраненные точки",
  optionsConfiguredPickupPoints: "Настроенные ПВЗ",
  optionsNoPickupPointsTitle: "ПВЗ не настроены.",
  optionsNoPickupPointsHint: "Добавляйте точки из выбора доставки Ozon на странице товара.",
  optionsCompared: "Сравнивается",
  optionsSkipped: "Пропущен",
  optionsCompareTitleExclude: "Исключить из сравнения на странице товара",
  optionsCompareTitleInclude: "Включить в сравнение на странице товара",
  optionsUp: "Вверх",
  optionsDown: "Вниз",
  optionsMoveUp: "Переместить вверх",
  optionsMoveDown: "Переместить вниз",
  optionsDelete: "Удалить",
  optionsSettingsUnavailable: "Настройки недоступны",
  optionsLanguageSaved: "Язык сохранен",
  optionsCurrencySaved: "Валюта сохранена",
  optionsManualRatesSavedFromInputs: "Ручные курсы сохраняются из полей ввода",
  optionsUpdatingCurrencyRates: "Обновляю курсы валют",
  optionsCurrencyRatesNotUpdated: "Курсы валют не обновлены",
  optionsManualRates: "Ручные курсы",
  optionsSavedRates: "Сохраненные курсы",
  optionsCurrencyRatesUpdated: "Курсы валют обновлены",
  optionsCurrencyRatesUpdatedFrom: "Курсы валют обновлены из {provider}{fallback}",
  optionsFallback: " через резервный источник",
  optionsSettingsNotSaved: "Настройки не сохранены",
  optionsPickupSkipped: "ПВЗ пропущен",
  optionsPickupCompared: "ПВЗ добавлен в сравнение",
  optionsOrderSaved: "Порядок сохранен",
  optionsPickupDeleted: "ПВЗ удален",
  languageAuto: "Авто",
  languageRu: "Русский",
  languageEn: "English",
  rateProviderManual: "Вручную",
  rateProviderCbr: "ЦБ РФ",
  rateProviderNbk: "Нацбанк Казахстана",
  rateProviderExchangeRateApi: "ExchangeRate-API",
  panelCollapsedTag: "цены",
  panelPickupPrices: "Цены по ПВЗ",
  panelProductFallback: "Товар Ozon",
  panelOpenSettings: "Открыть настройки",
  panelSettings: "Настройки",
  panelExpand: "Развернуть панель Markonverter",
  panelCollapse: "Свернуть панель Markonverter",
  panelCheckingPickupPoints: "Проверяю {count} ПВЗ...",
  panelConfiguredPickupPoints: "сохраненные",
  panelNoOzonPickupPoints: "ПВЗ Ozon не настроены.",
  panelNoSavedSelected: "Нет сохраненных ПВЗ, выбранных для сравнения.",
  panelWaiting: "Ожидание",
  panelNotCompared: "Не сравнивается",
  panelWaitingHint: "Жду ответ Ozon",
  panelEnableInSettings: "Включите в настройках",
  panelCapturedTitle: "Записано {time}",
  panelBest: "лучшее",
  panelUnavailable: "Недоступно",
  panelRegionUnavailable: "Нет в регионе",
  panelRegionUnavailableHint: "Товар не доставляется в регион этого ПВЗ.",
  panelCaptureCurrent: "Записать текущую",
  panelCaptureCurrentTitle: "После выбора этого ПВЗ в Ozon запишите видимую цену страницы для этого товара.",
  panelCopyDetails: "Копировать детали",
  panelCopyDetailsTitle: "Копировать технические детали для диагностики этого ПВЗ.",
  panelDetectedEyebrow: "Страница Ozon",
  panelNewPickupPoints: "Не добавленные ПВЗ",
  panelNewCount: "{count} не добавлено",
  panelShowNewPickupPoints: "Показать не добавленные ПВЗ",
  panelHideNewPickupPoints: "Скрыть не добавленные ПВЗ",
  panelDetectedHint: "Откройте выбор доставки Ozon, затем выберите или просмотрите ПВЗ, чтобы Markonverter его обнаружил.",
  panelSave: "Сохранить",
  panelSaving: "Сохраняю: {name}",
  panelPickupNotSaved: "ПВЗ не сохранен",
  panelPickupLimitReached: "Можно сохранить не больше {count} ПВЗ Ozon. Удалите лишний ПВЗ, чтобы добавить новый.",
  panelSaved: "Сохранено: {name}",
  panelSavedAndCaptured: "Сохранено и записана текущая цена: {name}",
  panelCaptureVisibleTitle: "Записать видимую цену?",
  panelCaptureDifferentPointMessage: "Сейчас Ozon показывает точку \"{current}\", а не \"{target}\". Все равно записать видимую цену для \"{target}\"?",
  panelCaptureUnverifiedMessage: "Не удалось проверить выбранный ПВЗ Ozon. Все равно записать видимую цену для \"{target}\"?",
  panelCapturePrice: "Записать цену",
  panelCancel: "Отмена",
  panelPriceCaptureCancelled: "Запись цены отменена",
  panelVisiblePriceNotFound: "Не удалось найти видимую цену товара на текущей странице Ozon.",
  panelCapturedCurrentPrice: "Текущая цена страницы записана для {name}",
  panelAutoCapturedCurrentPrice: "Текущая цена автоматически записана для {name}",
  panelCapturedPriceNotSaved: "Записанная цена не сохранена",
  panelDeletePickupTitle: "Удалить ПВЗ?",
  panelDeletePickupMessage: "Удалить \"{name}\" из сохраненных ПВЗ?",
  panelDeletePickupConfirm: "Удалить ПВЗ",
  panelDeleted: "Удалено: {name}",
  panelPickupNotDeleted: "ПВЗ не удален",
  panelOriginalPickupRestoreFailed: "Не удалось вернуть исходный ПВЗ Ozon. Проверьте выбранную доставку на странице.",
  panelCurrentPriceNotCaptured: "Откройте или выберите этот ПВЗ в Ozon, дождитесь цены, затем используйте Записать текущую.",
  panelOzonDidNotConfirm: "Ozon не подтвердил этот ПВЗ, поэтому могла использоваться текущая точка доставки.",
  panelCapturedFromPage: "со страницы",
  panelCopiedDiagnostics: "Диагностика ПВЗ скопирована",
  panelCopyDiagnosticsBlocked: "Не удалось скопировать диагностику. Браузер заблокировал доступ к буферу обмена.",
  assistSaved: "Сохранено",
  assistAdd: "Добавить",
  assistAlreadySavedTitle: "Уже сохранено в Markonverter",
  assistAddTitle: "Добавить {name} в Markonverter",
  assistStatus: "{rows} ПВЗ видно / {saved} сохранено{loading}",
  assistStatusLoading: " / ID загружаются",
  assistListNotLoaded: "Список ПВЗ не загружен",
  assistRefreshPvz: "Обновить ПВЗ",
  assistShowInPanel: "Показать в панели",
  fixturesEyebrow: "Фикстуры Ozon",
  fixturesCaptured: "{count} записано",
  fixturesCopy: "Копировать",
  fixturesCopyTitle: "Копировать записанные фикстуры API Ozon",
  fixturesClear: "Очистить",
  fixturesClearTitle: "Очистить записанные фикстуры API Ozon",
  fixturesNone: "Фикстур пока нет",
  fixturesCopied: "Скопировано {count}",
  fixturesClipboardBlocked: "Буфер обмена заблокирован",
  fixturesClearTitleQuestion: "Очистить фикстуры Ozon?",
  fixturesClearMessage: "Очистить записанные фикстуры API Ozon из этого браузера?",
  fixturesClearConfirm: "Очистить фикстуры",
  fixturesCleared: "Очищено"
} as const;

export type I18nKey = keyof typeof RU_MESSAGES;

const EN_MESSAGES: Record<I18nKey, string> = {
  appName: "Markonverter",
  appShortName: "Markonverter",
  optionsDocumentTitle: "Markonverter settings",
  optionsTopEyebrow: "Ozon price console",
  optionsLede: "Compare saved pickup points, tune conversion rates, and manage Ozon locations captured from product pages.",
  optionsLanguageEyebrow: "Interface",
  optionsLanguageHeading: "Language",
  optionsLanguageHint: "Used by the Ozon panel and this settings page",
  optionsLanguageSelectLabel: "Interface language",
  optionsLanguageResolved: "Current: {language}",
  optionsSaveLanguage: "Save language",
  optionsDebugLabel: "Debug mode",
  optionsDebugHint: "Shows diagnostic actions and records Ozon fixtures.",
  optionsSaveDebug: "Save debug",
  optionsDebugSaved: "Debug mode saved",
  optionsRatesEyebrow: "Rates",
  optionsRatesHeading: "Currency",
  optionsRatesHint: "Used by the injected comparison panel",
  optionsRateSource: "Rate source",
  optionsDefaultComparison: "Default comparison",
  optionsRateRub: "1 RUB in RUB",
  optionsRateKzt: "1 KZT in RUB",
  optionsSaveCurrency: "Save currency",
  optionsUpdateRates: "Update rates",
  optionsSavedLocationsEyebrow: "Saved locations",
  optionsConfiguredPickupPoints: "Configured pickup points",
  optionsNoPickupPointsTitle: "No pickup points configured.",
  optionsNoPickupPointsHint: "Add points from an Ozon delivery selector on a product page.",
  optionsCompared: "Compared",
  optionsSkipped: "Skipped",
  optionsCompareTitleExclude: "Exclude from product-page comparison",
  optionsCompareTitleInclude: "Include in product-page comparison",
  optionsUp: "Up",
  optionsDown: "Down",
  optionsMoveUp: "Move up",
  optionsMoveDown: "Move down",
  optionsDelete: "Delete",
  optionsSettingsUnavailable: "Settings are unavailable",
  optionsLanguageSaved: "Language saved",
  optionsCurrencySaved: "Currency saved",
  optionsManualRatesSavedFromInputs: "Manual rates are saved from the input fields",
  optionsUpdatingCurrencyRates: "Updating currency rates",
  optionsCurrencyRatesNotUpdated: "Currency rates were not updated",
  optionsManualRates: "Manual rates",
  optionsSavedRates: "Saved rates",
  optionsCurrencyRatesUpdated: "Currency rates updated",
  optionsCurrencyRatesUpdatedFrom: "Currency rates updated from {provider}{fallback}",
  optionsFallback: " via fallback",
  optionsSettingsNotSaved: "Settings were not saved",
  optionsPickupSkipped: "Pickup point skipped",
  optionsPickupCompared: "Pickup point compared",
  optionsOrderSaved: "Order saved",
  optionsPickupDeleted: "Pickup point deleted",
  languageAuto: "Auto",
  languageRu: "Русский",
  languageEn: "English",
  rateProviderManual: "Manual",
  rateProviderCbr: "CBR",
  rateProviderNbk: "National Bank KZ",
  rateProviderExchangeRateApi: "ExchangeRate-API",
  panelCollapsedTag: "prices",
  panelPickupPrices: "Pickup prices",
  panelProductFallback: "Ozon product",
  panelOpenSettings: "Open settings",
  panelSettings: "Settings",
  panelExpand: "Expand Markonverter panel",
  panelCollapse: "Collapse Markonverter panel",
  panelCheckingPickupPoints: "Checking {count} pickup points...",
  panelConfiguredPickupPoints: "configured",
  panelNoOzonPickupPoints: "No Ozon pickup points configured.",
  panelNoSavedSelected: "No saved pickup points selected for comparison.",
  panelWaiting: "Waiting",
  panelNotCompared: "Not compared",
  panelWaitingHint: "Waiting for Ozon response",
  panelEnableInSettings: "Enable in Settings",
  panelCapturedTitle: "Captured {time}",
  panelBest: "best",
  panelUnavailable: "Unavailable",
  panelRegionUnavailable: "Not in region",
  panelRegionUnavailableHint: "This product is not delivered to this pickup point region.",
  panelCaptureCurrent: "Capture current",
  panelCaptureCurrentTitle: "After selecting this pickup point in Ozon, capture the visible page price for this product.",
  panelCopyDetails: "Copy details",
  panelCopyDetailsTitle: "Copy technical details for debugging this pickup point.",
  panelDetectedEyebrow: "Ozon page",
  panelNewPickupPoints: "Unsaved pickup points",
  panelNewCount: "{count} unsaved",
  panelShowNewPickupPoints: "Show unsaved pickup points",
  panelHideNewPickupPoints: "Hide unsaved pickup points",
  panelDetectedHint: "Open Ozon delivery selection, then choose or view a point so Markonverter can detect it.",
  panelSave: "Save",
  panelSaving: "Saving: {name}",
  panelPickupNotSaved: "Pickup point was not saved",
  panelPickupLimitReached: "You can save up to {count} Ozon pickup points. Delete one before adding another.",
  panelSaved: "Saved: {name}",
  panelSavedAndCaptured: "Saved and captured current price: {name}",
  panelCaptureVisibleTitle: "Capture visible price?",
  panelCaptureDifferentPointMessage: "The currently detected Ozon point looks like \"{current}\", not \"{target}\". Capture the visible page price for \"{target}\" anyway?",
  panelCaptureUnverifiedMessage: "I could not verify the selected Ozon point. Capture the visible page price for \"{target}\" anyway?",
  panelCapturePrice: "Capture price",
  panelCancel: "Cancel",
  panelPriceCaptureCancelled: "Price capture cancelled",
  panelVisiblePriceNotFound: "Could not find a visible product price on the current Ozon page.",
  panelCapturedCurrentPrice: "Captured current page price for {name}",
  panelAutoCapturedCurrentPrice: "Auto captured current price for {name}",
  panelCapturedPriceNotSaved: "Captured price was not saved",
  panelDeletePickupTitle: "Delete pickup point?",
  panelDeletePickupMessage: "Delete \"{name}\" from saved pickup points?",
  panelDeletePickupConfirm: "Delete point",
  panelDeleted: "Deleted: {name}",
  panelPickupNotDeleted: "Pickup point was not deleted",
  panelOriginalPickupRestoreFailed: "Could not restore the original Ozon pickup point. Check the selected delivery point on the page.",
  panelCurrentPriceNotCaptured: "Open or select this pickup point in Ozon, wait for the price, then use Capture current.",
  panelOzonDidNotConfirm: "Ozon did not confirm this pickup point, so the current address may have been reused.",
  panelCapturedFromPage: "from page",
  panelCopiedDiagnostics: "Copied pickup-point diagnostics",
  panelCopyDiagnosticsBlocked: "Could not copy diagnostics. Browser clipboard access is blocked.",
  assistSaved: "Saved",
  assistAdd: "Add",
  assistAlreadySavedTitle: "Already saved in Markonverter",
  assistAddTitle: "Add {name} to Markonverter",
  assistStatus: "{rows} PVZ visible / {saved} saved{loading}",
  assistStatusLoading: " / IDs loading",
  assistListNotLoaded: "PVZ list not loaded",
  assistRefreshPvz: "Refresh PVZ",
  assistShowInPanel: "Show in panel",
  fixturesEyebrow: "Ozon fixtures",
  fixturesCaptured: "{count} captured",
  fixturesCopy: "Copy",
  fixturesCopyTitle: "Copy recorded Ozon API fixtures",
  fixturesClear: "Clear",
  fixturesClearTitle: "Clear recorded Ozon API fixtures",
  fixturesNone: "No fixtures yet",
  fixturesCopied: "Copied {count}",
  fixturesClipboardBlocked: "Clipboard blocked",
  fixturesClearTitleQuestion: "Clear Ozon fixtures?",
  fixturesClearMessage: "Clear recorded Ozon API fixtures from this browser?",
  fixturesClearConfirm: "Clear fixtures",
  fixturesCleared: "Cleared"
};

const MESSAGES: Record<SupportedLanguage, Record<I18nKey, string>> = {
  ru: RU_MESSAGES,
  en: EN_MESSAGES
};

export interface Translator {
  language: SupportedLanguage;
  locale: string;
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return SUPPORTED_LANGUAGE_PREFERENCES.includes(value as LanguagePreference)
    ? (value as LanguagePreference)
    : DEFAULT_LANGUAGE_PREFERENCE;
}

export function resolveLanguage(preference: LanguagePreference, uiLanguage = browserUiLanguage()): SupportedLanguage {
  if (preference !== "auto") {
    return preference;
  }
  const normalized = uiLanguage.toLowerCase();
  const detected = SUPPORTED_LANGUAGES.find((language) => normalized === language || normalized.startsWith(`${language}-`));
  return detected || DEFAULT_LANGUAGE;
}

export function languageLabel(language: SupportedLanguage): string {
  return MESSAGES[language][language === "ru" ? "languageRu" : "languageEn"];
}

export function languageLocale(language: SupportedLanguage): string {
  return language === "ru" ? "ru-RU" : "en-US";
}

export function createTranslator(preference: LanguagePreference = DEFAULT_LANGUAGE_PREFERENCE): Translator {
  const language = resolveLanguage(preference);
  const messages = MESSAGES[language];
  return {
    language,
    locale: languageLocale(language),
    t: (key, params) => formatMessage(messages[key] || MESSAGES[DEFAULT_LANGUAGE][key], params)
  };
}

function formatMessage(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (params[key] === undefined ? match : String(params[key])));
}

function browserUiLanguage(): string {
  try {
    return chrome.i18n?.getUILanguage?.() || navigator.language || DEFAULT_LANGUAGE;
  } catch {
    return typeof navigator === "undefined" ? DEFAULT_LANGUAGE : navigator.language || DEFAULT_LANGUAGE;
  }
}
