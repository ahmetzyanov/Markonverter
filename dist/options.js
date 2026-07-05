"use strict";
(() => {
  // src/shared/i18n.ts
  var DEFAULT_LANGUAGE = "ru";
  var DEFAULT_LANGUAGE_PREFERENCE = "ru";
  var SUPPORTED_LANGUAGES = ["ru", "en"];
  var SUPPORTED_LANGUAGE_PREFERENCES = ["auto", ...SUPPORTED_LANGUAGES];
  var RU_MESSAGES = {
    appName: "Markonverter",
    appShortName: "Markonverter",
    optionsDocumentTitle: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 Markonverter",
    optionsTopEyebrow: "\u041A\u043E\u043D\u0441\u043E\u043B\u044C \u0446\u0435\u043D Ozon",
    optionsLede: "\u0421\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0439\u0442\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0435 \u041F\u0412\u0417, \u043D\u0430\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u0439\u0442\u0435 \u043A\u0443\u0440\u0441\u044B \u0432\u0430\u043B\u044E\u0442 \u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u044F\u0439\u0442\u0435 Ozon-\u0442\u043E\u0447\u043A\u0430\u043C\u0438, \u043D\u0430\u0439\u0434\u0435\u043D\u043D\u044B\u043C\u0438 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430\u0445 \u0442\u043E\u0432\u0430\u0440\u043E\u0432.",
    optionsLanguageEyebrow: "\u0418\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441",
    optionsLanguageHeading: "\u042F\u0437\u044B\u043A",
    optionsLanguageHint: "\u041F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F \u043A \u043F\u0430\u043D\u0435\u043B\u0438 \u043D\u0430 Ozon \u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A",
    optionsLanguageSelectLabel: "\u042F\u0437\u044B\u043A \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0430",
    optionsLanguageResolved: "\u0421\u0435\u0439\u0447\u0430\u0441: {language}",
    optionsSaveLanguage: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u044F\u0437\u044B\u043A",
    optionsDebugLabel: "Debug \u0440\u0435\u0436\u0438\u043C",
    optionsDebugHint: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F \u0438 \u0437\u0430\u043F\u0438\u0441\u044C \u0444\u0438\u043A\u0441\u0442\u0443\u0440 Ozon.",
    optionsSaveDebug: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C debug",
    optionsDebugSaved: "Debug \u0440\u0435\u0436\u0438\u043C \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D",
    optionsRatesEyebrow: "\u041A\u0443\u0440\u0441\u044B",
    optionsRatesHeading: "\u0412\u0430\u043B\u044E\u0442\u0430",
    optionsRatesHint: "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0432 \u043F\u0430\u043D\u0435\u043B\u0438 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u044F \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0442\u043E\u0432\u0430\u0440\u0430",
    optionsRateSource: "\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043A\u0443\u0440\u0441\u0430",
    optionsDefaultComparison: "\u0412\u0430\u043B\u044E\u0442\u0430 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u044F",
    optionsRateRub: "1 RUB \u0432 RUB",
    optionsRateKzt: "1 KZT \u0432 RUB",
    optionsSaveCurrency: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0432\u0430\u043B\u044E\u0442\u0443",
    optionsUpdateRates: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u043A\u0443\u0440\u0441\u044B",
    optionsSavedLocationsEyebrow: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0435 \u0442\u043E\u0447\u043A\u0438",
    optionsConfiguredPickupPoints: "\u041D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0435 \u041F\u0412\u0417",
    optionsNoPickupPointsTitle: "\u041F\u0412\u0417 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u044B.",
    optionsNoPickupPointsHint: "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0439\u0442\u0435 \u0442\u043E\u0447\u043A\u0438 \u0438\u0437 \u0432\u044B\u0431\u043E\u0440\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 Ozon \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0442\u043E\u0432\u0430\u0440\u0430.",
    optionsCompared: "\u0421\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0435\u0442\u0441\u044F",
    optionsSkipped: "\u041F\u0440\u043E\u043F\u0443\u0449\u0435\u043D",
    optionsCompareTitleExclude: "\u0418\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0438\u0437 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u044F \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0442\u043E\u0432\u0430\u0440\u0430",
    optionsCompareTitleInclude: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0432 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0435 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0442\u043E\u0432\u0430\u0440\u0430",
    optionsUp: "\u0412\u0432\u0435\u0440\u0445",
    optionsDown: "\u0412\u043D\u0438\u0437",
    optionsMoveUp: "\u041F\u0435\u0440\u0435\u043C\u0435\u0441\u0442\u0438\u0442\u044C \u0432\u0432\u0435\u0440\u0445",
    optionsMoveDown: "\u041F\u0435\u0440\u0435\u043C\u0435\u0441\u0442\u0438\u0442\u044C \u0432\u043D\u0438\u0437",
    optionsDelete: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
    optionsSettingsUnavailable: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B",
    optionsLanguageSaved: "\u042F\u0437\u044B\u043A \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D",
    optionsCurrencySaved: "\u0412\u0430\u043B\u044E\u0442\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0430",
    optionsManualRatesSavedFromInputs: "\u0420\u0443\u0447\u043D\u044B\u0435 \u043A\u0443\u0440\u0441\u044B \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u044E\u0442\u0441\u044F \u0438\u0437 \u043F\u043E\u043B\u0435\u0439 \u0432\u0432\u043E\u0434\u0430",
    optionsUpdatingCurrencyRates: "\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u044E \u043A\u0443\u0440\u0441\u044B \u0432\u0430\u043B\u044E\u0442",
    optionsCurrencyRatesNotUpdated: "\u041A\u0443\u0440\u0441\u044B \u0432\u0430\u043B\u044E\u0442 \u043D\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
    optionsManualRates: "\u0420\u0443\u0447\u043D\u044B\u0435 \u043A\u0443\u0440\u0441\u044B",
    optionsSavedRates: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0435 \u043A\u0443\u0440\u0441\u044B",
    optionsCurrencyRatesUpdated: "\u041A\u0443\u0440\u0441\u044B \u0432\u0430\u043B\u044E\u0442 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B",
    optionsCurrencyRatesUpdatedFrom: "\u041A\u0443\u0440\u0441\u044B \u0432\u0430\u043B\u044E\u0442 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u044B \u0438\u0437 {provider}{fallback}",
    optionsFallback: " \u0447\u0435\u0440\u0435\u0437 \u0440\u0435\u0437\u0435\u0440\u0432\u043D\u044B\u0439 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A",
    optionsSettingsNotSaved: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B",
    optionsPickupSkipped: "\u041F\u0412\u0417 \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D",
    optionsPickupCompared: "\u041F\u0412\u0417 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D \u0432 \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0435",
    optionsOrderSaved: "\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D",
    optionsPickupDeleted: "\u041F\u0412\u0417 \u0443\u0434\u0430\u043B\u0435\u043D",
    languageAuto: "\u0410\u0432\u0442\u043E",
    languageRu: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
    languageEn: "English",
    rateProviderManual: "\u0412\u0440\u0443\u0447\u043D\u0443\u044E",
    rateProviderCbr: "\u0426\u0411 \u0420\u0424",
    rateProviderNbk: "\u041D\u0430\u0446\u0431\u0430\u043D\u043A \u041A\u0430\u0437\u0430\u0445\u0441\u0442\u0430\u043D\u0430",
    rateProviderExchangeRateApi: "ExchangeRate-API",
    panelCollapsedTag: "\u0446\u0435\u043D\u044B",
    panelPickupPrices: "\u0426\u0435\u043D\u044B \u043F\u043E \u041F\u0412\u0417",
    panelProductFallback: "\u0422\u043E\u0432\u0430\u0440 Ozon",
    panelOpenSettings: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    panelSettings: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    panelExpand: "\u0420\u0430\u0437\u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C Markonverter",
    panelCollapse: "\u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C Markonverter",
    panelCheckingPickupPoints: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u044E {count} \u041F\u0412\u0417...",
    panelConfiguredPickupPoints: "\u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0435",
    panelNoOzonPickupPoints: "\u041F\u0412\u0417 Ozon \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u044B.",
    panelNoSavedSelected: "\u041D\u0435\u0442 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0445 \u041F\u0412\u0417, \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0445 \u0434\u043B\u044F \u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u044F.",
    panelWaiting: "\u041E\u0436\u0438\u0434\u0430\u043D\u0438\u0435",
    panelNotCompared: "\u041D\u0435 \u0441\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u0435\u0442\u0441\u044F",
    panelWaitingHint: "\u0416\u0434\u0443 \u043E\u0442\u0432\u0435\u0442 Ozon",
    panelEnableInSettings: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u0435 \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445",
    panelCapturedTitle: "\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043E {time}",
    panelBest: "\u043B\u0443\u0447\u0448\u0435\u0435",
    panelUnavailable: "\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E",
    panelRegionUnavailable: "\u041D\u0435\u0442 \u0432 \u0440\u0435\u0433\u0438\u043E\u043D\u0435",
    panelRegionUnavailableHint: "\u0422\u043E\u0432\u0430\u0440 \u043D\u0435 \u0434\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u0440\u0435\u0433\u0438\u043E\u043D \u044D\u0442\u043E\u0433\u043E \u041F\u0412\u0417.",
    panelCaptureCurrent: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0443\u044E",
    panelCaptureCurrentTitle: "\u041F\u043E\u0441\u043B\u0435 \u0432\u044B\u0431\u043E\u0440\u0430 \u044D\u0442\u043E\u0433\u043E \u041F\u0412\u0417 \u0432 Ozon \u0437\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u0432\u0438\u0434\u0438\u043C\u0443\u044E \u0446\u0435\u043D\u0443 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u0430.",
    panelCopyDetails: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0434\u0435\u0442\u0430\u043B\u0438",
    panelCopyDetailsTitle: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0434\u0435\u0442\u0430\u043B\u0438 \u0434\u043B\u044F \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0438 \u044D\u0442\u043E\u0433\u043E \u041F\u0412\u0417.",
    panelDetectedEyebrow: "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 Ozon",
    panelNewPickupPoints: "\u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u041F\u0412\u0417",
    panelNewCount: "{count} \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E",
    panelShowNewPickupPoints: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u041F\u0412\u0417",
    panelHideNewPickupPoints: "\u0421\u043A\u0440\u044B\u0442\u044C \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u041F\u0412\u0417",
    panelDetectedHint: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0432\u044B\u0431\u043E\u0440 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438 Ozon, \u0437\u0430\u0442\u0435\u043C \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0438\u043B\u0438 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0438\u0442\u0435 \u041F\u0412\u0417, \u0447\u0442\u043E\u0431\u044B Markonverter \u0435\u0433\u043E \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0438\u043B.",
    panelSave: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    panelSaving: "\u0421\u043E\u0445\u0440\u0430\u043D\u044F\u044E: {name}",
    panelPickupNotSaved: "\u041F\u0412\u0417 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D",
    panelPickupLimitReached: "\u041C\u043E\u0436\u043D\u043E \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 {count} \u041F\u0412\u0417 Ozon. \u0423\u0434\u0430\u043B\u0438\u0442\u0435 \u043B\u0438\u0448\u043D\u0438\u0439 \u041F\u0412\u0417, \u0447\u0442\u043E\u0431\u044B \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043D\u043E\u0432\u044B\u0439.",
    panelSaved: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E: {name}",
    panelSavedAndCaptured: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \u0438 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0430 \u0442\u0435\u043A\u0443\u0449\u0430\u044F \u0446\u0435\u043D\u0430: {name}",
    panelCaptureVisibleTitle: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432\u0438\u0434\u0438\u043C\u0443\u044E \u0446\u0435\u043D\u0443?",
    panelCaptureDifferentPointMessage: '\u0421\u0435\u0439\u0447\u0430\u0441 Ozon \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0442\u043E\u0447\u043A\u0443 "{current}", \u0430 \u043D\u0435 "{target}". \u0412\u0441\u0435 \u0440\u0430\u0432\u043D\u043E \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432\u0438\u0434\u0438\u043C\u0443\u044E \u0446\u0435\u043D\u0443 \u0434\u043B\u044F "{target}"?',
    panelCaptureUnverifiedMessage: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u041F\u0412\u0417 Ozon. \u0412\u0441\u0435 \u0440\u0430\u0432\u043D\u043E \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0432\u0438\u0434\u0438\u043C\u0443\u044E \u0446\u0435\u043D\u0443 \u0434\u043B\u044F "{target}"?',
    panelCapturePrice: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0446\u0435\u043D\u0443",
    panelCancel: "\u041E\u0442\u043C\u0435\u043D\u0430",
    panelPriceCaptureCancelled: "\u0417\u0430\u043F\u0438\u0441\u044C \u0446\u0435\u043D\u044B \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u0430",
    panelVisiblePriceNotFound: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043D\u0430\u0439\u0442\u0438 \u0432\u0438\u0434\u0438\u043C\u0443\u044E \u0446\u0435\u043D\u0443 \u0442\u043E\u0432\u0430\u0440\u0430 \u043D\u0430 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 Ozon.",
    panelCapturedCurrentPrice: "\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0446\u0435\u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0430 \u0434\u043B\u044F {name}",
    panelAutoCapturedCurrentPrice: "\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0446\u0435\u043D\u0430 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u0430 \u0434\u043B\u044F {name}",
    panelCapturedPriceNotSaved: "\u0417\u0430\u043F\u0438\u0441\u0430\u043D\u043D\u0430\u044F \u0446\u0435\u043D\u0430 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0430",
    panelDeletePickupTitle: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u041F\u0412\u0417?",
    panelDeletePickupMessage: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C "{name}" \u0438\u0437 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043D\u044B\u0445 \u041F\u0412\u0417?',
    panelDeletePickupConfirm: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u041F\u0412\u0417",
    panelDeleted: "\u0423\u0434\u0430\u043B\u0435\u043D\u043E: {name}",
    panelPickupNotDeleted: "\u041F\u0412\u0417 \u043D\u0435 \u0443\u0434\u0430\u043B\u0435\u043D",
    panelOriginalPickupRestoreFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u0435\u0440\u043D\u0443\u0442\u044C \u0438\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u041F\u0412\u0417 Ozon. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u0443\u044E \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0443 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435.",
    panelCurrentPriceNotCaptured: "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0438\u043B\u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u044D\u0442\u043E\u0442 \u041F\u0412\u0417 \u0432 Ozon, \u0434\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u0446\u0435\u043D\u044B, \u0437\u0430\u0442\u0435\u043C \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0442\u0435\u043A\u0443\u0449\u0443\u044E.",
    panelOzonDidNotConfirm: "Ozon \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043B \u044D\u0442\u043E\u0442 \u041F\u0412\u0417, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043C\u043E\u0433\u043B\u0430 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F \u0442\u0435\u043A\u0443\u0449\u0430\u044F \u0442\u043E\u0447\u043A\u0430 \u0434\u043E\u0441\u0442\u0430\u0432\u043A\u0438.",
    panelCapturedFromPage: "\u0441\u043E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B",
    panelCopiedDiagnostics: "\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430 \u041F\u0412\u0417 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430",
    panelCopyDiagnosticsBlocked: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0443. \u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043B \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0431\u0443\u0444\u0435\u0440\u0443 \u043E\u0431\u043C\u0435\u043D\u0430.",
    assistSaved: "\u0421\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E",
    assistAdd: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C",
    assistAlreadySavedTitle: "\u0423\u0436\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \u0432 Markonverter",
    assistAddTitle: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C {name} \u0432 Markonverter",
    assistStatus: "{rows} \u041F\u0412\u0417 \u0432\u0438\u0434\u043D\u043E / {saved} \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E{loading}",
    assistStatusLoading: " / ID \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E\u0442\u0441\u044F",
    assistListNotLoaded: "\u0421\u043F\u0438\u0441\u043E\u043A \u041F\u0412\u0417 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D",
    assistRefreshPvz: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u041F\u0412\u0417",
    assistShowInPanel: "\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0432 \u043F\u0430\u043D\u0435\u043B\u0438",
    fixturesEyebrow: "\u0424\u0438\u043A\u0441\u0442\u0443\u0440\u044B Ozon",
    fixturesCaptured: "{count} \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E",
    fixturesCopy: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
    fixturesCopyTitle: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0435 \u0444\u0438\u043A\u0441\u0442\u0443\u0440\u044B API Ozon",
    fixturesClear: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C",
    fixturesClearTitle: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0435 \u0444\u0438\u043A\u0441\u0442\u0443\u0440\u044B API Ozon",
    fixturesNone: "\u0424\u0438\u043A\u0441\u0442\u0443\u0440 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442",
    fixturesCopied: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E {count}",
    fixturesClipboardBlocked: "\u0411\u0443\u0444\u0435\u0440 \u043E\u0431\u043C\u0435\u043D\u0430 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D",
    fixturesClearTitleQuestion: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0444\u0438\u043A\u0441\u0442\u0443\u0440\u044B Ozon?",
    fixturesClearMessage: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0435 \u0444\u0438\u043A\u0441\u0442\u0443\u0440\u044B API Ozon \u0438\u0437 \u044D\u0442\u043E\u0433\u043E \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430?",
    fixturesClearConfirm: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C \u0444\u0438\u043A\u0441\u0442\u0443\u0440\u044B",
    fixturesCleared: "\u041E\u0447\u0438\u0449\u0435\u043D\u043E"
  };
  var EN_MESSAGES = {
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
    languageRu: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",
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
    panelCaptureDifferentPointMessage: 'The currently detected Ozon point looks like "{current}", not "{target}". Capture the visible page price for "{target}" anyway?',
    panelCaptureUnverifiedMessage: 'I could not verify the selected Ozon point. Capture the visible page price for "{target}" anyway?',
    panelCapturePrice: "Capture price",
    panelCancel: "Cancel",
    panelPriceCaptureCancelled: "Price capture cancelled",
    panelVisiblePriceNotFound: "Could not find a visible product price on the current Ozon page.",
    panelCapturedCurrentPrice: "Captured current page price for {name}",
    panelAutoCapturedCurrentPrice: "Auto captured current price for {name}",
    panelCapturedPriceNotSaved: "Captured price was not saved",
    panelDeletePickupTitle: "Delete pickup point?",
    panelDeletePickupMessage: 'Delete "{name}" from saved pickup points?',
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
  var MESSAGES = {
    ru: RU_MESSAGES,
    en: EN_MESSAGES
  };
  function normalizeLanguagePreference(value) {
    return SUPPORTED_LANGUAGE_PREFERENCES.includes(value) ? value : DEFAULT_LANGUAGE_PREFERENCE;
  }
  function resolveLanguage(preference, uiLanguage = browserUiLanguage()) {
    if (preference !== "auto") {
      return preference;
    }
    const normalized = uiLanguage.toLowerCase();
    const detected = SUPPORTED_LANGUAGES.find((language) => normalized === language || normalized.startsWith(`${language}-`));
    return detected || DEFAULT_LANGUAGE;
  }
  function languageLabel(language) {
    return MESSAGES[language][language === "ru" ? "languageRu" : "languageEn"];
  }
  function languageLocale(language) {
    return language === "ru" ? "ru-RU" : "en-US";
  }
  function createTranslator(preference = DEFAULT_LANGUAGE_PREFERENCE) {
    const language = resolveLanguage(preference);
    const messages = MESSAGES[language];
    return {
      language,
      locale: languageLocale(language),
      t: (key, params) => formatMessage(messages[key] || MESSAGES[DEFAULT_LANGUAGE][key], params)
    };
  }
  function formatMessage(template, params = {}) {
    return template.replace(/\{(\w+)\}/g, (match, key) => params[key] === void 0 ? match : String(params[key]));
  }
  function browserUiLanguage() {
    try {
      return chrome.i18n?.getUILanguage?.() || navigator.language || DEFAULT_LANGUAGE;
    } catch {
      return typeof navigator === "undefined" ? DEFAULT_LANGUAGE : navigator.language || DEFAULT_LANGUAGE;
    }
  }

  // src/shared/types.ts
  var SUPPORTED_CURRENCIES = ["RUB", "KZT"];
  var SUPPORTED_CURRENCY_RATE_PROVIDERS = ["manual", "cbr", "nbk", "exchangeRateApi"];
  var MAX_SAVED_OZON_PICKUP_POINTS = 4;
  var DEFAULT_SETTINGS = {
    language: DEFAULT_LANGUAGE_PREFERENCE,
    debug: false,
    defaultCurrency: "RUB",
    currencyRateProvider: "cbr",
    ratesToRub: {
      RUB: 1,
      KZT: 0.17
    },
    pickupPoints: [],
    comparisonPickupPointIds: null,
    manualQuotes: {}
  };

  // src/shared/validation.ts
  var MAX_REASONABLE_KZT_TO_RUB_RATE = 1;
  function normalizeSettings(value) {
    const candidate = value;
    const pickupPoints = Array.isArray(candidate?.pickupPoints) ? limitOzonPickupPoints(candidate.pickupPoints.filter(isPickupPointLike).map(normalizePickupPoint)) : [];
    return {
      language: normalizeLanguagePreference(candidate?.language),
      debug: candidate?.debug === true,
      defaultCurrency: candidate?.defaultCurrency && SUPPORTED_CURRENCIES.includes(candidate.defaultCurrency) ? candidate.defaultCurrency : DEFAULT_SETTINGS.defaultCurrency,
      currencyRateProvider: SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate?.currencyRateProvider) ? candidate?.currencyRateProvider : DEFAULT_SETTINGS.currencyRateProvider,
      currencyRateMeta: normalizeCurrencyRateMeta(candidate?.currencyRateMeta),
      ratesToRub: {
        RUB: sanitizeRate(candidate?.ratesToRub?.RUB, DEFAULT_SETTINGS.ratesToRub.RUB),
        KZT: sanitizeRate(candidate?.ratesToRub?.KZT, DEFAULT_SETTINGS.ratesToRub.KZT, MAX_REASONABLE_KZT_TO_RUB_RATE)
      },
      pickupPoints,
      comparisonPickupPointIds: normalizeComparisonPickupPointIds(candidate?.comparisonPickupPointIds, pickupPoints),
      manualQuotes: normalizeManualQuotes(candidate?.manualQuotes, pickupPoints)
    };
  }
  function sanitizeRate(value, fallback, max = Number.POSITIVE_INFINITY) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
  }
  function normalizeCurrencyRateMeta(value) {
    const candidate = value;
    if (!candidate || !SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate.provider) || typeof candidate.updatedAt !== "string" || Number.isNaN(Date.parse(candidate.updatedAt))) {
      return void 0;
    }
    return {
      provider: candidate.provider,
      updatedAt: new Date(candidate.updatedAt).toISOString(),
      effectiveDate: typeof candidate.effectiveDate === "string" ? candidate.effectiveDate : void 0,
      fallbackUsed: candidate.fallbackUsed === true
    };
  }
  function isPickupPointLike(value) {
    const candidate = value;
    return typeof candidate?.id === "string" && typeof candidate.name === "string";
  }
  function normalizePickupPoint(pickupPoint) {
    return {
      id: pickupPoint.id,
      name: pickupPoint.name,
      marketplace: pickupPoint.marketplace === "wildberries" ? "wildberries" : "ozon",
      country: pickupPoint.country || "RU",
      currency: SUPPORTED_CURRENCIES.includes(pickupPoint.currency) ? pickupPoint.currency : "RUB",
      externalLocationId: pickupPoint.externalLocationId || "",
      comment: pickupPoint.comment || ""
    };
  }
  function limitOzonPickupPoints(pickupPoints) {
    let ozonCount = 0;
    return pickupPoints.filter((point) => {
      if (point.marketplace !== "ozon") {
        return true;
      }
      ozonCount += 1;
      return ozonCount <= MAX_SAVED_OZON_PICKUP_POINTS;
    });
  }
  function normalizeComparisonPickupPointIds(value, pickupPoints) {
    if (!Array.isArray(value)) {
      return null;
    }
    const knownIds = new Set(pickupPoints.map((point) => point.id));
    return [...new Set(value.filter((id) => typeof id === "string" && knownIds.has(id)))];
  }
  function normalizeManualQuotes(value, pickupPoints) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const knownIds = new Set(pickupPoints.map((point) => point.id));
    const quotes = {};
    for (const rawQuote of Object.values(value)) {
      const quote = normalizeManualQuote(rawQuote, knownIds);
      if (quote) {
        quotes[`${quote.productId}:${quote.pickupPointId}`] = quote;
      }
    }
    return quotes;
  }
  function normalizeManualQuote(value, knownPickupPointIds) {
    const candidate = value;
    if (!candidate || typeof candidate.productId !== "string" || typeof candidate.productUrl !== "string" || typeof candidate.pickupPointId !== "string" || typeof candidate.capturedAt !== "string" || !knownPickupPointIds.has(candidate.pickupPointId)) {
      return null;
    }
    const quote = normalizePriceQuote(candidate.quote);
    if (!quote) {
      return null;
    }
    return {
      productId: candidate.productId,
      productUrl: candidate.productUrl,
      pickupPointId: candidate.pickupPointId,
      quote: {
        ...quote,
        source: "manual",
        capturedAt: candidate.capturedAt
      },
      capturedAt: candidate.capturedAt
    };
  }
  function normalizePriceQuote(value) {
    const candidate = value;
    const currency = typeof candidate?.currency === "string" && SUPPORTED_CURRENCIES.includes(candidate.currency) ? candidate.currency : null;
    if (!candidate || typeof candidate.amount !== "number" || !Number.isFinite(candidate.amount) || candidate.amount <= 0 || !currency) {
      return null;
    }
    return {
      amount: candidate.amount,
      currency,
      rawText: typeof candidate.rawText === "string" ? candidate.rawText : void 0,
      deliveryText: typeof candidate.deliveryText === "string" ? candidate.deliveryText : void 0
    };
  }

  // src/entrypoints/options.ts
  var settings = normalizeSettings(void 0);
  var saveChain = Promise.resolve();
  var saveVersion = 0;
  var elements = {
    language: mustGet("language"),
    saveLanguage: mustGet("saveLanguage"),
    languageResolved: mustGet("languageResolved"),
    debug: mustGet("debug"),
    saveDebug: mustGet("saveDebug"),
    rateProvider: mustGet("rateProvider"),
    defaultCurrency: mustGet("defaultCurrency"),
    rateRub: mustGet("rateRub"),
    rateKzt: mustGet("rateKzt"),
    saveCurrency: mustGet("saveCurrency"),
    refreshCurrency: mustGet("refreshCurrency"),
    currencyRateInfo: mustGet("currencyRateInfo"),
    pointList: mustGet("pointList"),
    status: mustGet("status")
  };
  void init();
  async function init() {
    const response = await runtimeRequest({ type: "GET_SETTINGS" });
    if (!response.ok || !("settings" in response)) {
      settings = normalizeSettings(void 0);
      setStatus(response.ok ? currentI18n().t("optionsSettingsUnavailable") : response.error, true);
    } else {
      settings = response.settings;
    }
    render();
    bindEvents();
  }
  function bindEvents() {
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
        currencyRateMeta: provider === "manual" ? { provider: "manual", updatedAt: (/* @__PURE__ */ new Date()).toISOString() } : provider === settings.currencyRateProvider ? settings.currencyRateMeta : void 0,
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
  function render() {
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
  async function refreshCurrencyRates() {
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
  function renderCurrencyRateInfo() {
    const i18n = currentI18n();
    if (settings.currencyRateProvider === "manual") {
      elements.currencyRateInfo.textContent = settings.currencyRateMeta?.updatedAt ? `${i18n.t("rateProviderManual")}, ${formatDate(settings.currencyRateMeta.updatedAt)}` : i18n.t("optionsManualRates");
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
  function renderPointList() {
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
  function isPointCompared(point) {
    return point.marketplace !== "ozon" || settings.comparisonPickupPointIds === null || settings.comparisonPickupPointIds.includes(point.id);
  }
  function togglePointComparison(pointId) {
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
  function movePoint(index, direction) {
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
  function removePoint(id) {
    settings.pickupPoints = settings.pickupPoints.filter((point) => point.id !== id);
    enqueueSaveSettings("optionsPickupDeleted");
  }
  function readRateProvider() {
    return SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(elements.rateProvider.value) ? elements.rateProvider.value : "cbr";
  }
  function enqueueSaveSettings(messageKey) {
    const version = ++saveVersion;
    const snapshot = structuredClone(settings);
    setSaving(true);
    saveChain = saveChain.then(async () => {
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
    }).catch((error) => {
      if (version === saveVersion) {
        setStatus(error instanceof Error ? error.message : String(error), true);
      }
    }).finally(() => {
      if (version === saveVersion) {
        setSaving(false);
      }
    });
  }
  function button(text, title, onClick, className = "") {
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
  async function runtimeRequest(request) {
    return chrome.runtime.sendMessage(request);
  }
  function setStatus(message, error = false) {
    elements.status.textContent = message;
    elements.status.classList.toggle("error", error);
  }
  function setSaving(isSaving) {
    elements.language.disabled = isSaving;
    elements.saveLanguage.disabled = isSaving;
    elements.debug.disabled = isSaving;
    elements.saveDebug.disabled = isSaving;
    elements.saveCurrency.disabled = isSaving;
    elements.refreshCurrency.disabled = isSaving || readRateProvider() === "manual";
    elements.pointList.querySelectorAll("button").forEach((button2) => {
      button2.disabled = isSaving;
    });
  }
  function mustGet(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element;
  }
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }
  function updateRateControls() {
    elements.refreshCurrency.disabled = readRateProvider() === "manual";
    elements.refreshCurrency.title = readRateProvider() === "manual" ? currentI18n().t("optionsManualRatesSavedFromInputs") : currentI18n().t("optionsUpdateRates");
  }
  function formatRateUpdateStatus(meta) {
    const i18n = currentI18n();
    if (!meta) {
      return i18n.t("optionsCurrencyRatesUpdated");
    }
    const fallback = meta.fallbackUsed ? i18n.t("optionsFallback") : "";
    return i18n.t("optionsCurrencyRatesUpdatedFrom", { provider: rateProviderLabel(meta.provider), fallback });
  }
  function formatDate(value) {
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
  function currentI18n() {
    return createTranslator(settings?.language);
  }
  function applyPageTranslations(i18n) {
    document.documentElement.lang = i18n.language;
    document.title = i18n.t("optionsDocumentTitle");
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const key = node.dataset.i18n;
      if (key) {
        node.textContent = i18n.t(key);
      }
    });
    elements.languageResolved.textContent = i18n.t("optionsLanguageResolved", { language: languageLabel(i18n.language) });
  }
  function renderLanguageOptions(i18n) {
    const labels = {
      ru: i18n.t("languageRu"),
      en: i18n.t("languageEn"),
      auto: i18n.t("languageAuto")
    };
    for (const option of Array.from(elements.language.options)) {
      option.textContent = labels[normalizeLanguagePreference(option.value)];
    }
  }
  function renderRateProviderOptions(i18n) {
    const labels = {
      manual: i18n.t("rateProviderManual"),
      cbr: i18n.t("rateProviderCbr"),
      nbk: i18n.t("rateProviderNbk"),
      exchangeRateApi: i18n.t("rateProviderExchangeRateApi")
    };
    for (const option of Array.from(elements.rateProvider.options)) {
      const provider = option.value;
      if (SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(provider)) {
        option.textContent = labels[provider];
      }
    }
  }
  function rateProviderLabel(provider) {
    const i18n = currentI18n();
    const labels = {
      manual: "rateProviderManual",
      cbr: "rateProviderCbr",
      nbk: "rateProviderNbk",
      exchangeRateApi: "rateProviderExchangeRateApi"
    };
    return i18n.t(labels[provider]);
  }
  function readLanguagePreference() {
    return normalizeLanguagePreference(elements.language.value);
  }
})();
//# sourceMappingURL=options.js.map
