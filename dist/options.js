"use strict";
(() => {
  // src/shared/types.ts
  var SUPPORTED_CURRENCIES = ["RUB", "KZT"];
  var SUPPORTED_CURRENCY_RATE_PROVIDERS = ["manual", "cbr", "nbk", "exchangeRateApi"];
  var DEFAULT_SETTINGS = {
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
  function normalizeSettings(value) {
    const candidate = value;
    const pickupPoints = Array.isArray(candidate?.pickupPoints) ? candidate.pickupPoints.filter(isPickupPointLike).map(normalizePickupPoint) : [];
    return {
      defaultCurrency: candidate?.defaultCurrency && SUPPORTED_CURRENCIES.includes(candidate.defaultCurrency) ? candidate.defaultCurrency : DEFAULT_SETTINGS.defaultCurrency,
      currencyRateProvider: SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(candidate?.currencyRateProvider) ? candidate?.currencyRateProvider : DEFAULT_SETTINGS.currencyRateProvider,
      currencyRateMeta: normalizeCurrencyRateMeta(candidate?.currencyRateMeta),
      ratesToRub: {
        RUB: sanitizeRate(candidate?.ratesToRub?.RUB, DEFAULT_SETTINGS.ratesToRub.RUB),
        KZT: sanitizeRate(candidate?.ratesToRub?.KZT, DEFAULT_SETTINGS.ratesToRub.KZT)
      },
      pickupPoints,
      comparisonPickupPointIds: normalizeComparisonPickupPointIds(candidate?.comparisonPickupPointIds, pickupPoints),
      manualQuotes: normalizeManualQuotes(candidate?.manualQuotes, pickupPoints)
    };
  }
  function validatePickupPoint(pickupPoint) {
    const errors = [];
    if (!pickupPoint.name.trim()) {
      errors.push("Name is required");
    }
    if (pickupPoint.marketplace !== "ozon" && pickupPoint.marketplace !== "wildberries") {
      errors.push("Marketplace is unsupported");
    }
    if (pickupPoint.marketplace === "ozon" && !pickupPoint.externalLocationId.trim()) {
      errors.push("Ozon location id is required");
    }
    if (!SUPPORTED_CURRENCIES.includes(pickupPoint.currency)) {
      errors.push("Currency is unsupported");
    }
    if (!pickupPoint.country.trim()) {
      errors.push("Country is required");
    }
    return errors;
  }
  function sanitizeRate(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
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

  // src/options.ts
  var RATE_PROVIDER_LABELS = {
    manual: "Manual",
    cbr: "CBR",
    nbk: "National Bank KZ",
    exchangeRateApi: "ExchangeRate-API"
  };
  var settings;
  var saveChain = Promise.resolve();
  var saveVersion = 0;
  var elements = {
    rateProvider: mustGet("rateProvider"),
    defaultCurrency: mustGet("defaultCurrency"),
    rateRub: mustGet("rateRub"),
    rateKzt: mustGet("rateKzt"),
    saveCurrency: mustGet("saveCurrency"),
    refreshCurrency: mustGet("refreshCurrency"),
    currencyRateInfo: mustGet("currencyRateInfo"),
    pointForm: mustGet("pointForm"),
    pointId: mustGet("pointId"),
    pointName: mustGet("pointName"),
    pointMarketplace: mustGet("pointMarketplace"),
    pointCountry: mustGet("pointCountry"),
    pointCurrency: mustGet("pointCurrency"),
    pointExternalId: mustGet("pointExternalId"),
    pointComment: mustGet("pointComment"),
    savePoint: mustGet("savePoint"),
    resetPoint: mustGet("resetPoint"),
    pointList: mustGet("pointList"),
    status: mustGet("status")
  };
  void init();
  async function init() {
    const response = await runtimeRequest({ type: "GET_SETTINGS" });
    if (!response.ok || !("settings" in response)) {
      setStatus(response.ok ? "Settings are unavailable" : response.error, true);
      settings = normalizeSettings(void 0);
    } else {
      settings = response.settings;
    }
    render();
    bindEvents();
  }
  function bindEvents() {
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
      enqueueSaveSettings("Currency saved");
    });
    elements.refreshCurrency.addEventListener("click", () => {
      void refreshCurrencyRates();
    });
    elements.pointForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const point = readPointForm();
      const errors = validatePickupPoint(point);
      if (errors.length > 0) {
        setStatus(errors.join(". "), true);
        return;
      }
      const index = settings.pickupPoints.findIndex((existing) => existing.id === point.id);
      if (index >= 0) {
        settings.pickupPoints[index] = point;
      } else {
        settings.pickupPoints.push(point);
      }
      clearPointForm();
      enqueueSaveSettings("Pickup point saved");
    });
    elements.resetPoint.addEventListener("click", clearPointForm);
  }
  function render() {
    elements.rateProvider.value = settings.currencyRateProvider;
    elements.defaultCurrency.value = settings.defaultCurrency;
    elements.rateRub.value = String(settings.ratesToRub.RUB);
    elements.rateKzt.value = String(settings.ratesToRub.KZT);
    renderCurrencyRateInfo();
    updateRateControls();
    renderPointList();
  }
  async function refreshCurrencyRates() {
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
  function renderCurrencyRateInfo() {
    if (settings.currencyRateProvider === "manual") {
      elements.currencyRateInfo.textContent = settings.currencyRateMeta?.updatedAt ? `Manual, ${formatDate(settings.currencyRateMeta.updatedAt)}` : "Manual rates";
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
  function renderPointList() {
    elements.pointList.innerHTML = "";
    if (settings.pickupPoints.length === 0) {
      const empty = document.createElement("div");
      empty.className = "point";
      empty.innerHTML = "<strong>No pickup points configured.</strong><span>Add points from an Ozon delivery selector or add one manually.</span>";
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
      const up = button("Up", "Move up", () => movePoint(index, -1));
      const down = button("Down", "Move down", () => movePoint(index, 1));
      const edit = button("Edit", "Edit", () => fillPointForm(point));
      const remove = button("Delete", "Delete", () => removePoint(point.id), "danger");
      up.disabled = index === 0;
      down.disabled = index === settings.pickupPoints.length - 1;
      actions.append(up, down, edit, remove);
      row.append(meta, actions);
      elements.pointList.append(row);
    });
  }
  function readPointForm() {
    return {
      id: elements.pointId.value || crypto.randomUUID(),
      name: elements.pointName.value.trim(),
      marketplace: elements.pointMarketplace.value,
      country: elements.pointCountry.value,
      currency: SUPPORTED_CURRENCIES.includes(elements.pointCurrency.value) ? elements.pointCurrency.value : "RUB",
      externalLocationId: elements.pointExternalId.value.trim(),
      comment: elements.pointComment.value.trim()
    };
  }
  function fillPointForm(point) {
    elements.pointId.value = point.id;
    elements.pointName.value = point.name;
    elements.pointMarketplace.value = point.marketplace;
    elements.pointCountry.value = point.country;
    elements.pointCurrency.value = point.currency;
    elements.pointExternalId.value = point.externalLocationId;
    elements.pointComment.value = point.comment || "";
  }
  function clearPointForm() {
    elements.pointId.value = "";
    elements.pointName.value = "";
    elements.pointMarketplace.value = "ozon";
    elements.pointCountry.value = "RU";
    elements.pointCurrency.value = "RUB";
    elements.pointExternalId.value = "";
    elements.pointComment.value = "";
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
    enqueueSaveSettings("Order saved");
  }
  function removePoint(id) {
    settings.pickupPoints = settings.pickupPoints.filter((point) => point.id !== id);
    enqueueSaveSettings("Pickup point deleted");
  }
  function readRateProvider() {
    return SUPPORTED_CURRENCY_RATE_PROVIDERS.includes(elements.rateProvider.value) ? elements.rateProvider.value : "cbr";
  }
  function enqueueSaveSettings(message) {
    const version = ++saveVersion;
    const snapshot = structuredClone(settings);
    setSaving(true);
    saveChain = saveChain.then(async () => {
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
    elements.saveCurrency.disabled = isSaving;
    elements.refreshCurrency.disabled = isSaving || readRateProvider() === "manual";
    elements.savePoint.disabled = isSaving;
    elements.resetPoint.disabled = isSaving;
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
    elements.refreshCurrency.title = readRateProvider() === "manual" ? "Manual rates are saved from the input fields" : "Fetch the selected source now";
  }
  function formatRateUpdateStatus(meta) {
    if (!meta) {
      return "Currency rates updated";
    }
    const fallback = meta.fallbackUsed ? " via fallback" : "";
    return `Currency rates updated from ${RATE_PROVIDER_LABELS[meta.provider]}${fallback}`;
  }
  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString(void 0, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
})();
//# sourceMappingURL=options.js.map
