// Ozon pickup-candidate collection: the page-world event feed, fallback DOM /
// storage capture sources, private-API discovery, and saved-name repair/sync.
// Quote capture lives in ./ozon-quote-capture; app state (settings, product)
// and panel glue are imported from ./app and ./panel/render — the import
// cycles are intentional and function-level only.

import {
  extractOzonPickupCandidatesFromSources,
  isGenericOzonPickupName,
  OzonCaptureSource,
  OzonPickupCandidate,
  safeOzonPickupName,
  shouldReplaceOzonPickupCandidate,
  shouldUseOzonPickupName
} from "../marketplaces/ozon/pickup-capture";
import {
  canUseVisibleDeliveryNameForSavedPoint,
  isCandidateNameSharedAcrossExternalIds,
  ozonCandidateDisplayName,
  visibleDeliveryPickupLabel
} from "../marketplaces/ozon/pickup-matching";
import { ExtensionSettings, PickupPoint, ProductIdentity } from "../shared/types";
import { getCurrentProduct, getLatestSettings, setLatestSettings } from "./app";
import { MENU_ASSIST_ID, PANEL_ID } from "./ids";
import {
  cleanOzonDeliverySummaryText,
  collectOzonRowEvidence,
  dispatchSyntheticClick,
  findOzonDeliveryContainer,
  isVisibleDeliverySummaryElement,
  waitForOzonDeliveryContainer,
  waitForOzonDeliverySelectorOpener
} from "./ozon-delivery-dom";
import { collectOzonPickupCandidatesFromDeliveryContainer, scheduleOzonDeliveryAssistSync } from "./ozon-delivery-assist";
import { collectCurrentDeliverySummaryText, scheduleCurrentVisibleQuoteCapture } from "./ozon-quote-capture";
import { renderLastPanel, updateLastPanelSettings } from "./panel/render";
import { runtimeRequest } from "./runtime";

const COLLECT_PICKUP_EVENT = "markonverter:collect-ozon-pickup";
const PICKUP_CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";

export let latestPickupCandidates: OzonPickupCandidate[] = [];
let pickupApiDiscoveryKey = "";
let pickupApiDiscoveryPromise: Promise<OzonPickupCandidate[]> | null = null;
let savedPickupNameSyncTimer: number | null = null;
const targetedPickupDiscoveryIds = new Set<string>();
const autoPickupSelectorOpenKeys = new Set<string>();

export function installPickupCandidateCapture(): void {
  document.addEventListener(PICKUP_CANDIDATES_EVENT, handlePickupCandidatesEvent);
}

export function resetPickupDiscoverySession(): void {
  targetedPickupDiscoveryIds.clear();
  autoPickupSelectorOpenKeys.clear();
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

export function mergePickupCandidates(candidates: OzonPickupCandidate[]): boolean {
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

export function requestPagePickupCandidates(): void {
  document.dispatchEvent(new CustomEvent(COLLECT_PICKUP_EVENT));
}

export async function getBestPickupCandidate(): Promise<OzonPickupCandidate | null> {
  requestPagePickupCandidates();
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  await new Promise((resolve) => setTimeout(resolve, 250));
  mergePickupCandidates(extractOzonPickupCandidatesFromSources(collectFallbackCaptureSources()));
  return latestPickupCandidates[0] || null;
}

export function collectFallbackCaptureSources(): OzonCaptureSource[] {
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

export function discoverOzonPickupCandidatesFromApi(product: ProductIdentity): Promise<OzonPickupCandidate[]> {
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

export async function refreshSavedOzonPickupNamesOnLoad(product: ProductIdentity, settings: ExtensionSettings): Promise<ExtensionSettings> {
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

export function collectCurrentDeliveryPickupSources(urlHint: string): OzonCaptureSource[] {
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
    setLatestSettings(settings);
    didUpdate = true;
  }

  if (didUpdate) {
    updateLastPanelSettings(settings);
    renderLastPanel();
    scheduleOzonDeliveryAssistSync();
  }
}

export async function repairUnsafeSavedPickupNames(settings: ExtensionSettings): Promise<ExtensionSettings> {
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
      setLatestSettings(nextSettings);
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
  if (!candidate || isCandidateNameSharedAcrossExternalIds(candidate, latestPickupCandidates)) {
    return null;
  }
  return candidate;
}
