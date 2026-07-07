import { Currency, PriceQuote } from "../../shared/types";

export interface OzonPrivatePriceRequest {
  productId: string;
  productUrl: string;
  pickupExternalLocationId: string;
  currencyHint: Currency;
  allowSessionMutatingLocationActivation?: boolean;
}

interface EndpointCandidate {
  label: string;
  url: string;
  method: "GET" | "POST";
  headers?: HeadersInit;
  body?: string;
}

export const OZON_PRODUCT_UNAVAILABLE_IN_REGION = "Ozon product is not delivered to this pickup point region";
// Ozon's antibot returns HTTP 403 session-wide once request volume trips it;
// hammering more candidates after the first 403 only digs the hole deeper.
export const OZON_REQUESTS_THROTTLED_MESSAGE = "Ozon is temporarily blocking requests (HTTP 403)";

export async function fetchOzonPrivatePrice(request: OzonPrivatePriceRequest): Promise<PriceQuote> {
  const productUrl = new URL(request.productUrl);
  const pathWithSearch = `${productUrl.pathname}${productUrl.search}`;
  const activation = request.allowSessionMutatingLocationActivation
    ? await activateOzonPickupLocation(pathWithSearch, request.pickupExternalLocationId)
    : { confirmed: false, aliases: [] };
  const acceptedLocationIds = normalizeLocationIds([request.pickupExternalLocationId, ...activation.aliases]);
  const candidates = buildEndpointCandidates(pathWithSearch, acceptedLocationIds, {
    includeLocationCandidates: request.allowSessionMutatingLocationActivation === true,
    includeSelectionCandidates: request.allowSessionMutatingLocationActivation === true
  });
  const errors: string[] = [];
  let throttled = false;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: candidate.method,
        credentials: "include",
        headers: candidate.headers,
        body: candidate.body
      });
      if (!response.ok) {
        errors.push(`${candidate.label}: HTTP ${response.status}`);
        if (response.status === 403) {
          throttled = true;
          break;
        }
        continue;
      }

      const json = await response.json();
      const location = inspectResponseLocation(json, acceptedLocationIds);
      if (location.hasConflictingExplicitLocation && !location.hasAcceptedExplicitLocation) {
        errors.push(`${candidate.label}: response did not confirm requested pickup point (confirmed a different pickup point)`);
        continue;
      }
      if (!location.hasAcceptedLocation && !activation.confirmed) {
        errors.push(`${candidate.label}: response did not confirm requested pickup point`);
        continue;
      }

      const price = extractOzonPrice(json, request.currencyHint);
      if (!price) {
        if (responseContainsProductUnavailableInRegion(json)) {
          errors.push(`${candidate.label}: ${OZON_PRODUCT_UNAVAILABLE_IN_REGION}`);
          continue;
        }
        errors.push(`${candidate.label}: no unambiguous product price in response`);
        continue;
      }

      return price;
    } catch (error) {
      errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (throttled) {
    throw new Error(OZON_REQUESTS_THROTTLED_MESSAGE);
  }
  throw new Error(`Ozon private API did not return a verified product price. ${errors.join("; ")}`);
}

export function isOzonProductUnavailableInRegion(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(OZON_PRODUCT_UNAVAILABLE_IN_REGION) || /товар\s+не\s+доставляется\s+в\s+ваш\s+регион/i.test(text);
}

export function isOzonRequestsThrottled(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(OZON_REQUESTS_THROTTLED_MESSAGE);
}

// True only for a genuine "Ozon never confirmed this pickup point" failure —
// not a network hiccup, ambiguous price, or other transient miss. Only this
// specific failure justifies remembering the point as permanently doomed for
// the session; a transient failure should just be retried later.
export function isOzonPickupNotConfirmed(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("response did not confirm requested pickup point");
}

export async function activateOzonPickupLocationForProduct(productUrl: string, pickupExternalLocationId: string): Promise<boolean> {
  const url = new URL(productUrl);
  const pathWithSearch = `${url.pathname}${url.search}`;
  const activation = await activateOzonPickupLocation(pathWithSearch, pickupExternalLocationId);
  return activation.confirmed;
}

// Read the pickup point Ozon currently considers selected (its own ground truth),
// so a sweep can reliably return there afterwards even if the visible page does
// not expose a parseable id. Non-mutating.
export async function fetchOzonSelectedLocationId(productUrl: string): Promise<string | null> {
  const url = new URL(productUrl);
  const pathWithSearch = `${url.pathname}${url.search}`;
  const candidates = buildEndpointCandidates(pathWithSearch, []);
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: candidate.method,
        credentials: "include",
        headers: candidate.headers,
        body: candidate.body
      });
      if (!response.ok) {
        if (response.status === 403) {
          break;
        }
        continue;
      }
      const selected = extractSelectedOzonLocationId(await response.json());
      if (selected) {
        return selected;
      }
    } catch {
      // Best effort: fall through to the next endpoint / null.
    }
  }
  return null;
}

export function extractSelectedOzonLocationId(json: unknown): string | null {
  let found: string | null = null;
  walk(json, [], (path, value) => {
    if (found || (typeof value !== "string" && typeof value !== "number")) {
      return;
    }
    if (!isSelectedLocationPath(path.join(".").toLowerCase())) {
      return;
    }
    const text = String(value).trim();
    if (isLocationAlias(text)) {
      found = text;
    }
  });
  return found;
}

interface OzonPickupActivationResult {
  confirmed: boolean;
  aliases: string[];
}

interface LocationInspection {
  hasAcceptedLocation: boolean;
  hasAcceptedExplicitLocation: boolean;
  hasConflictingExplicitLocation: boolean;
}

async function activateOzonPickupLocation(
  pathWithSearch: string,
  pickupExternalLocationId: string
): Promise<OzonPickupActivationResult> {
  const candidates = buildLocationActivationCandidates(pathWithSearch, pickupExternalLocationId);
  const aliases = new Set<string>();
  let confirmed = false;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: candidate.method,
        credentials: "include",
        headers: candidate.headers,
        body: candidate.body
      });
      if (!response.ok) {
        if (response.status === 403) {
          break;
        }
        continue;
      }

      const json = parseMaybeJson(await response.text());
      const activation = inspectActivationResponse(json, pickupExternalLocationId);
      confirmed ||= activation.confirmed;
      activation.aliases.forEach((alias) => aliases.add(alias));
      if (confirmed) {
        break;
      }
    } catch {
      // Best effort only: the verified product-price request below decides whether the switch worked.
    }
  }

  aliases.delete(pickupExternalLocationId);
  return {
    confirmed,
    aliases: [...aliases].slice(0, 6)
  };
}

export function buildLocationActivationCandidates(pathWithSearch: string, pickupExternalLocationId: string): EndpointCandidate[] {
  const jsonHeaders = {
    "content-type": "application/json",
    "x-o3-app-name": "dweb_client",
    "x-o3-app-version": "release"
  };

  return buildLocationActivationModalVariants(pathWithSearch, pickupExternalLocationId).flatMap(({ label, modalPath }) => {
    const encodedModalPath = encodeURIComponent(modalPath);
    return [
      {
        label: `entrypoint-${label}`,
        method: "GET",
        url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedModalPath}`,
        headers: jsonHeaders
      },
      {
        label: `composer-${label}`,
        method: "GET",
        url: `/api/composer-api.bx/page/json/v2?url=${encodedModalPath}`,
        headers: jsonHeaders
      },
      {
        label: `entrypoint-post-${label}`,
        method: "POST",
        url: "/api/entrypoint-api.bx/page/json/v2",
        headers: jsonHeaders,
        body: JSON.stringify({
          url: modalPath,
          referer: pathWithSearch
        })
      },
      {
        label: `composer-post-${label}`,
        method: "POST",
        url: "/api/composer-api.bx/page/json/v2",
        headers: jsonHeaders,
        body: JSON.stringify({
          url: modalPath,
          referer: pathWithSearch
        })
      }
    ] satisfies EndpointCandidate[];
  });
}

function buildLocationActivationModalVariants(
  pathWithSearch: string,
  pickupExternalLocationId: string
): Array<{ label: string; modalPath: string }> {
  const encodedLocation = encodeURIComponent(pickupExternalLocationId);
  const encodedProductPath = encodeURIComponent(pathWithSearch);
  return [
    {
      label: "select-address-product-context",
      modalPath: `/modal/addressbook?select_address=${encodedLocation}&src_main=${encodedProductPath}&page_changed=true`
    },
    {
      label: "select-address-page-changed",
      modalPath: `/modal/addressbook?select_address=${encodedLocation}&page_changed=true`
    },
    {
      label: "select-address-legacy",
      modalPath: `/modal/addressbook?select_address=${encodedLocation}`
    }
  ];
}

export function buildEndpointCandidates(
  pathWithSearch: string,
  pickupExternalLocationIds: string | string[],
  options: { includeLocationCandidates?: boolean; includeSelectionCandidates?: boolean } = {}
): EndpointCandidate[] {
  const encodedUrl = encodeURIComponent(pathWithSearch);
  const locationIds = normalizeLocationIds(pickupExternalLocationIds);
  const jsonHeaders = {
    "content-type": "application/json",
    "x-o3-app-name": "dweb_client",
    "x-o3-app-version": "release"
  };

  return [
    {
      label: "composer-get-current-page",
      method: "GET",
      url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}`,
      headers: jsonHeaders
    },
    {
      label: "entrypoint-get-current-page",
      method: "GET",
      url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`,
      headers: jsonHeaders
    },
    ...(options.includeLocationCandidates
      ? locationIds.flatMap((pickupExternalLocationId) => {
          const encodedLocation = encodeURIComponent(pickupExternalLocationId);
          const deliveryCandidates = [
            {
              label: "composer-get-delivery-address",
              method: "GET",
              url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}&deliveryAddressOid=${encodedLocation}`,
              headers: jsonHeaders
            },
            {
              label: "entrypoint-get-delivery-address",
              method: "GET",
              url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&deliveryAddressOid=${encodedLocation}`,
              headers: jsonHeaders
            },
            {
              label: "composer-post-delivery-address",
              method: "POST",
              url: "/api/composer-api.bx/page/json/v2",
              headers: jsonHeaders,
              body: JSON.stringify({
                url: pathWithSearch,
                deliveryAddressOid: pickupExternalLocationId
              })
            }
          ] satisfies EndpointCandidate[];
          const selectionCandidates = [
            {
              label: "composer-get-selected-location",
              method: "GET",
              url: `/api/composer-api.bx/page/json/v2?url=${encodedUrl}&select_location=${encodedLocation}`,
              headers: jsonHeaders
            },
            {
              label: "entrypoint-get-selected-location",
              method: "GET",
              url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}&select_location=${encodedLocation}`,
              headers: jsonHeaders
            },
            {
              label: "composer-post-selected-location",
              method: "POST",
              url: "/api/composer-api.bx/page/json/v2",
              headers: jsonHeaders,
              body: JSON.stringify({
                url: pathWithSearch,
                select_location: pickupExternalLocationId
              })
            },
            {
              label: "composer-post-location-both",
              method: "POST",
              url: "/api/composer-api.bx/page/json/v2",
              headers: jsonHeaders,
              body: JSON.stringify({
                url: pathWithSearch,
                deliveryAddressOid: pickupExternalLocationId,
                select_location: pickupExternalLocationId
              })
            }
          ] satisfies EndpointCandidate[];
          return options.includeSelectionCandidates ? [...deliveryCandidates, ...selectionCandidates] : deliveryCandidates;
        })
      : [])
  ];
}

function normalizeLocationIds(pickupExternalLocationIds: string | string[]): string[] {
  const rawIds = Array.isArray(pickupExternalLocationIds) ? pickupExternalLocationIds : [pickupExternalLocationIds];
  return [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];
}

function responseContainsAnyLocation(json: unknown, pickupExternalLocationIds: string[]): boolean {
  return normalizeLocationIds(pickupExternalLocationIds).some((id) => responseContainsLocation(json, id));
}

function inspectResponseLocation(json: unknown, pickupExternalLocationIds: string[]): LocationInspection {
  const acceptedIds = normalizeLocationIds(pickupExternalLocationIds);
  let hasAcceptedExplicitLocation = false;
  let hasConflictingExplicitLocation = false;

  walk(json, [], (path, value) => {
    if (typeof value !== "string" && typeof value !== "number") {
      return;
    }

    const text = String(value).trim();
    if (!text || !isExplicitLocationConfirmationPath(path.join(".").toLowerCase())) {
      return;
    }

    if (acceptedIds.some((id) => textContainsLocationId(text, id))) {
      hasAcceptedExplicitLocation = true;
      return;
    }
    if (isLocationAlias(text)) {
      hasConflictingExplicitLocation = true;
    }
  });

  return {
    hasAcceptedLocation: responseContainsAnyLocation(json, acceptedIds),
    hasAcceptedExplicitLocation,
    hasConflictingExplicitLocation
  };
}

function inspectActivationResponse(json: unknown, pickupExternalLocationId: string): OzonPickupActivationResult {
  const aliases = new Set<string>();
  let confirmed = false;

  walk(json, [], (path, value) => {
    if (typeof value !== "string" && typeof value !== "number") {
      return;
    }

    const text = String(value).trim();
    if (!textContainsLocationId(text, pickupExternalLocationId)) {
      return;
    }

    const joined = path.join(".").toLowerCase();
    if (!isExplicitLocationConfirmationPath(joined)) {
      return;
    }

    confirmed = true;
    scalarLocationAliasValues(path, value).forEach((alias) => aliases.add(alias));
  });

  walk(json, [], (path, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const localConfirmationValues = Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      scalarLocationValues([...path, key], child)
    );
    if (!localConfirmationValues.some((item) => textContainsLocationId(item, pickupExternalLocationId))) {
      return;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const hasSelectedFlag = entries.some(([key, child]) => isSelectionFlag(key, child));
    const selectedAliases = entries.flatMap(([key, child]) => scalarSelectedLocationAliasValues([...path, key], child));
    if (!hasSelectedFlag && selectedAliases.length === 0) {
      return;
    }

    confirmed = true;
    entries.flatMap(([key, child]) => scalarLocationAliasValues([...path, key], child)).forEach((item) => aliases.add(item));
  });

  aliases.delete(pickupExternalLocationId);
  return { confirmed, aliases: [...aliases] };
}

function scalarLocationValues(path: string[], value: unknown): string[] {
  if ((typeof value !== "string" && typeof value !== "number") || !locationConfirmationPathScore(path.join(".").toLowerCase())) {
    return [];
  }
  return [String(value).trim()].filter(Boolean);
}

function scalarLocationAliasValues(path: string[], value: unknown): string[] {
  if ((typeof value !== "string" && typeof value !== "number") || !locationAliasPathScore(path.join(".").toLowerCase())) {
    return [];
  }
  return [String(value).trim()].filter(isLocationAlias);
}

function scalarSelectedLocationAliasValues(path: string[], value: unknown): string[] {
  if ((typeof value !== "string" && typeof value !== "number") || !isSelectedLocationPath(path.join(".").toLowerCase())) {
    return [];
  }
  return [String(value).trim()].filter(isLocationAlias);
}

function isLocationAlias(value: string): boolean {
  return /^[a-z0-9_-]{4,120}$/i.test(value);
}

export function responseContainsLocation(json: unknown, pickupExternalLocationId: string): boolean {
  const needle = pickupExternalLocationId.trim();
  if (!needle) {
    return false;
  }

  let found = false;
  walk(json, [], (_path, value) => {
    if (found || (typeof value !== "string" && typeof value !== "number")) {
      return;
    }
    const path = _path.join(".").toLowerCase();
    if (!locationConfirmationPathScore(path)) {
      return;
    }
    found = textContainsLocationId(String(value), needle);
  });
  return found;
}

// Substring containment is not enough: id "12345" must not be confirmed by a
// response that only mentions "123456". Require non-alphanumeric boundaries.
function textContainsLocationId(text: string, id: string): boolean {
  const isBoundary = (char: string | undefined) => char === undefined || !/[a-z0-9]/i.test(char);
  let from = 0;
  while (true) {
    const index = text.indexOf(id, from);
    if (index === -1) {
      return false;
    }
    if (isBoundary(text[index - 1]) && isBoundary(text[index + id.length])) {
      return true;
    }
    from = index + 1;
  }
}

export function extractOzonPrice(json: unknown, currencyHint: Currency): PriceQuote | null {
  const candidates: Array<PriceQuote & { score: number; path: string }> = [];

  for (const [path, value] of preferredPricePaths(json)) {
    const parsed = parsePrice(value, currencyHint);
    if (parsed) {
      candidates.push({ ...parsed, score: 100, path });
    }
  }

  walk(json, [], (path, value) => {
    const key = path[path.length - 1]?.toLowerCase() || "";
    const joined = path.join(".").toLowerCase();
    const looksProductScoped =
      joined.includes("webprice") ||
      joined.includes("finalprice") ||
      joined.includes("cardprice") ||
      joined.includes("price") ||
      joined.includes("product");
    const looksWrongKind =
      joined.includes("oldprice") ||
      joined.includes("originalprice") ||
      joined.includes("delivery") ||
      joined.includes("installment") ||
      joined.includes("bonus") ||
      joined.includes("points");
    if (
      !looksProductScoped ||
      looksWrongKind ||
      looksPresentationPriceMetadata(joined, key) ||
      (!key.includes("price") && typeof value !== "string")
    ) {
      return;
    }

    const parsed = parsePrice(value, currencyHint);
    if (!parsed || parsed.amount < 1 || parsed.amount > 100_000_000) {
      return;
    }

    candidates.push({
      ...parsed,
      score: (joined.includes("final") ? 15 : 0) + (joined.includes("webprice") ? 12 : 0) + (parsed.currency ? 5 : 0),
      path: joined
    });
  });

  const unique = dedupeCandidates(candidates);
  unique.sort((a, b) => b.score - a.score);
  const [best] = unique;
  if (!best) {
    return null;
  }
  if (unique.some((candidate) => candidate !== best && candidate.score === best.score && candidate.amount !== best.amount)) {
    return null;
  }
  const deliveryText = extractOzonDeliveryText(json);
  return { amount: best.amount, currency: best.currency, rawText: best.rawText, ...(deliveryText ? { deliveryText } : {}) };
}

export function extractOzonDeliveryText(json: unknown): string | null {
  const candidates: Array<{ text: string; score: number }> = [];

  walk(json, [], (path, value) => {
    if (typeof value !== "string") {
      return;
    }

    const text = compactText(value);
    if (!text || text.length < 3 || text.length > 160 || !/\p{L}|\d/u.test(text)) {
      return;
    }

    const joined = path.join(".").toLowerCase();
    if (!joined.includes("deliver") && !joined.includes("достав") && !joined.includes("eta") && !joined.includes("time")) {
      return;
    }
    if (
      /(price|amount|cost|address|coordinates|geo|url|request|tracking|analytics)/i.test(joined) ||
      /(^|\.)(oid|uid|id)$/i.test(joined)
    ) {
      return;
    }

    candidates.push({
      text,
      score:
        (/(eta|time|date|period|interval|deadline|subtitle|title|text)/i.test(joined) ? 20 : 0) +
        (/(today|tomorrow|сегодня|завтра|дн|час|мин|\d)/i.test(text) ? 15 : 0) +
        (joined.includes("widgetstates") ? 5 : 0)
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  return candidates[0]?.text || null;
}

function responseContainsProductUnavailableInRegion(json: unknown): boolean {
  let found = false;
  walk(json, [], (_path, value) => {
    if (found || typeof value !== "string") {
      return;
    }
    const text = compactText(value);
    found = /товар\s+не\s+доставляется\s+в\s+ваш\s+регион/i.test(text);
  });
  return found;
}

function preferredPricePaths(json: unknown): Array<[string, unknown]> {
  const roots = findWidgetStates(json);
  const candidates: Array<[string, unknown]> = [];

  for (const root of roots) {
    for (const [key, rawValue] of Object.entries(root)) {
      const lowerKey = key.toLowerCase();
      if (!lowerKey.includes("webprice") && !lowerKey.includes("price")) {
        continue;
      }
      const value = parseMaybeJson(rawValue);
      const paths = [
        ["price"],
        ["finalPrice"],
        ["cardPrice"],
        ["mainPrice"],
        ["price", "price"],
        ["price", "text"],
        ["mainState", "price"],
        ["state", "price"]
      ];
      for (const path of paths) {
        const nested = getPath(value, path);
        if (nested !== undefined) {
          candidates.push([`${key}.${path.join(".")}`, nested]);
        }
      }
    }
  }

  return candidates;
}

function findWidgetStates(json: unknown): Array<Record<string, unknown>> {
  const roots: Array<Record<string, unknown>> = [];
  walk(json, [], (path, value) => {
    if (path[path.length - 1] === "widgetStates" && value && typeof value === "object" && !Array.isArray(value)) {
      roots.push(value as Record<string, unknown>);
    }
  });
  return roots;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function dedupeCandidates<T extends PriceQuote & { score: number; path: string }>(candidates: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const candidate of candidates) {
    const key = `${candidate.amount}:${candidate.currency}:${candidate.rawText || ""}`;
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function looksPresentationPriceMetadata(path: string, key: string): boolean {
  if (/(^|\.)pricebadge(\.|$)/i.test(path)) {
    return true;
  }
  if (/(^|\.)(size|style|styletype|textstyle|font|typography|color|iconkey|iconcolor|theme|preset|trackinginfo)(\.|$)/i.test(path)) {
    return true;
  }
  return /(^|\.)(padding|margin|radius|width|height|layout|params)(\.|$)/i.test(path) && key !== "price";
}

function walk(value: unknown, path: string[], visitor: (path: string[], value: unknown) => void): void {
  visitor(path, value);
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((item, index) => walk(item, [...path, String(index)], visitor));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 300)) {
    walk(child, [...path, key], visitor);
  }
}

function locationConfirmationPathScore(path: string): number {
  if (/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)) {
    return 0;
  }
  if (/(selected|current|active|chosen)/i.test(path) && /(delivery|address|pickup|pickpoint|pvz|location|geo|city|region)/i.test(path)) {
    return 2;
  }
  if (/(delivery|address|pickup|pickpoint|pvz|location|geo|city|region)/i.test(path)) {
    return 1;
  }
  return 0;
}

function locationAliasPathScore(path: string): number {
  if (/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)) {
    return 0;
  }
  if (/(city|region|geo|coordinates|latitude|longitude)/i.test(path)) {
    return 0;
  }
  if (/(delivery|address|pickup|pickpoint|pvz|location)/i.test(path) && /(oid|id|uid)$/i.test(path)) {
    return 2;
  }
  if (/(selected|current|active|chosen)/i.test(path) && /(delivery|address|pickup|pickpoint|pvz|location)/i.test(path)) {
    return 1;
  }
  return 0;
}

function isExplicitLocationConfirmationPath(path: string): boolean {
  if (/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)) {
    return false;
  }
  if (isSelectedLocationPath(path)) {
    return true;
  }
  if (/(addressbook|book|list|items|available|suggest|candidate)/i.test(path)) {
    return false;
  }
  return /(delivery|address|pickup|pickpoint|pvz|location)/i.test(path) && /(oid|id|uid)$/i.test(path);
}

function isSelectedLocationPath(path: string): boolean {
  return (
    /(selected|current|active|chosen)/i.test(path) &&
    /(delivery|address|pickup|pickpoint|pvz|location)/i.test(path) &&
    !/(request|url|href|referrer|referer|query|param|tracking|analytics|debug|log|metrika|route)/i.test(path)
  );
}

function isSelectionFlag(key: string, value: unknown): boolean {
  if (!/(selected|current|active|chosen)/i.test(key)) {
    return false;
  }
  return value === true || value === 1 || value === "true" || value === "selected" || value === "active";
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parsePrice(value: unknown, currencyHint: Currency): PriceQuote | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? { amount: value, currency: currencyHint } : null;
  }
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();
  if (/^[a-z]+(?:_[a-z]+)*_\d+$/i.test(text)) {
    return null;
  }
  // Serialized JSON blobs would have every digit group concatenated into one
  // bogus amount; real price strings never contain braces/brackets or quotes.
  if (/[{}[\]"]/.test(text)) {
    return null;
  }

  const currency = text.includes("₽") || /руб|rub/i.test(text) ? "RUB" : text.includes("₸") || /тг|тенге|kzt/i.test(text) ? "KZT" : currencyHint;
  if (!/\d[\d\s.,]{1,}/.test(text)) {
    return null;
  }

  const normalized = text
    .replace(/[^\d,.\s]/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? { amount, currency, rawText: value } : null;
}
