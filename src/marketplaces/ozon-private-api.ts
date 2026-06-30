import { Currency, PriceQuote } from "../shared/types";

export interface OzonPrivatePriceRequest {
  productId: string;
  productUrl: string;
  pickupExternalLocationId: string;
  currencyHint: Currency;
}

interface EndpointCandidate {
  label: string;
  url: string;
  method: "GET" | "POST";
  headers?: HeadersInit;
  body?: string;
}

export async function fetchOzonPrivatePrice(request: OzonPrivatePriceRequest): Promise<PriceQuote> {
  const productUrl = new URL(request.productUrl);
  const pathWithSearch = `${productUrl.pathname}${productUrl.search}`;
  const acceptedLocationIds = [
    request.pickupExternalLocationId,
    ...(await activateOzonPickupLocation(pathWithSearch, request.pickupExternalLocationId))
  ];
  const candidates = buildEndpointCandidates(pathWithSearch, acceptedLocationIds);
  const errors: string[] = [];

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
        continue;
      }

      const json = await response.json();
      if (!responseContainsAnyLocation(json, acceptedLocationIds)) {
        errors.push(`${candidate.label}: response did not confirm requested pickup point`);
        continue;
      }

      const price = extractOzonPrice(json, request.currencyHint);
      if (!price) {
        errors.push(`${candidate.label}: no unambiguous product price in response`);
        continue;
      }

      return price;
    } catch (error) {
      errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Ozon private API did not return a verified product price. ${errors.join("; ")}`);
}

async function activateOzonPickupLocation(pathWithSearch: string, pickupExternalLocationId: string): Promise<string[]> {
  const candidates = buildLocationActivationCandidates(pathWithSearch, pickupExternalLocationId);
  const aliases = new Set<string>();

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: candidate.method,
        credentials: "include",
        headers: candidate.headers,
        body: candidate.body
      });
      if (!response.ok) {
        continue;
      }

      const json = parseMaybeJson(await response.text());
      extractConfirmedLocationAliases(json, pickupExternalLocationId).forEach((alias) => aliases.add(alias));
    } catch {
      // Best effort only: the verified product-price request below decides whether the switch worked.
    }
  }

  aliases.delete(pickupExternalLocationId);
  return [...aliases].slice(0, 6);
}

export function buildLocationActivationCandidates(pathWithSearch: string, pickupExternalLocationId: string): EndpointCandidate[] {
  const modalPath = `/modal/addressbook?select_address=${encodeURIComponent(pickupExternalLocationId)}`;
  const encodedModalPath = encodeURIComponent(modalPath);
  const jsonHeaders = {
    "content-type": "application/json",
    "x-o3-app-name": "dweb_client",
    "x-o3-app-version": "release"
  };

  return [
    {
      label: "entrypoint-select-address-modal",
      method: "GET",
      url: `/api/entrypoint-api.bx/page/json/v2?url=${encodedModalPath}`,
      headers: jsonHeaders
    },
    {
      label: "composer-select-address-modal",
      method: "GET",
      url: `/api/composer-api.bx/page/json/v2?url=${encodedModalPath}`,
      headers: jsonHeaders
    },
    {
      label: "entrypoint-post-select-address-modal",
      method: "POST",
      url: "/api/entrypoint-api.bx/page/json/v2",
      headers: jsonHeaders,
      body: JSON.stringify({
        url: modalPath,
        referer: pathWithSearch
      })
    },
    {
      label: "composer-post-select-address-modal",
      method: "POST",
      url: "/api/composer-api.bx/page/json/v2",
      headers: jsonHeaders,
      body: JSON.stringify({
        url: modalPath,
        referer: pathWithSearch
      })
    }
  ];
}

export function buildEndpointCandidates(pathWithSearch: string, pickupExternalLocationIds: string | string[]): EndpointCandidate[] {
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
    ...locationIds.flatMap((pickupExternalLocationId) => {
      const encodedLocation = encodeURIComponent(pickupExternalLocationId);
      return [
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
          label: "composer-post-delivery-address",
          method: "POST",
          url: "/api/composer-api.bx/page/json/v2",
          headers: jsonHeaders,
          body: JSON.stringify({
            url: pathWithSearch,
            deliveryAddressOid: pickupExternalLocationId
          })
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
    })
  ];
}

function normalizeLocationIds(pickupExternalLocationIds: string | string[]): string[] {
  const rawIds = Array.isArray(pickupExternalLocationIds) ? pickupExternalLocationIds : [pickupExternalLocationIds];
  return [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];
}

function responseContainsAnyLocation(json: unknown, pickupExternalLocationIds: string[]): boolean {
  return normalizeLocationIds(pickupExternalLocationIds).some((id) => responseContainsLocation(json, id));
}

function extractConfirmedLocationAliases(json: unknown, pickupExternalLocationId: string): string[] {
  const aliases = new Set<string>();
  if (responseContainsLocation(json, pickupExternalLocationId)) {
    collectLocationAliasValues(json).forEach((alias) => aliases.add(alias));
  }

  walk(json, [], (path, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    const localConfirmationValues = Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      scalarLocationValues([...path, key], child)
    );
    if (!localConfirmationValues.some((item) => item.includes(pickupExternalLocationId))) {
      return;
    }
    Object.entries(value as Record<string, unknown>)
      .flatMap(([key, child]) => scalarLocationAliasValues([...path, key], child))
      .forEach((item) => aliases.add(item));
  });
  return [...aliases];
}

function collectLocationAliasValues(json: unknown): string[] {
  const aliases = new Set<string>();
  walk(json, [], (path, value) => {
    scalarLocationAliasValues(path, value).forEach((alias) => aliases.add(alias));
  });
  return [...aliases];
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
    found = String(value).includes(needle);
  });
  return found;
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
    if (!looksProductScoped || looksWrongKind || (!key.includes("price") && typeof value !== "string")) {
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
  const [best, second] = unique;
  if (!best) {
    return null;
  }
  if (second && best.score === second.score && best.amount !== second.amount) {
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

  const currency = value.includes("₽") || /руб/i.test(value) ? "RUB" : value.includes("₸") || /тг|тенге/i.test(value) ? "KZT" : currencyHint;
  if (!/\d[\d\s.,]{1,}/.test(value)) {
    return null;
  }

  const normalized = value
    .replace(/[^\d,.\s]/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? { amount, currency, rawText: value } : null;
}
