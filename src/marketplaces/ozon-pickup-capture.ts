import { Currency, PickupCountry } from "../shared/types";

export interface OzonCaptureSource {
  source: string;
  value: unknown;
  urlHint?: string;
  textHint?: string;
}

export interface OzonPickupCandidate {
  externalLocationId: string;
  name: string;
  country: PickupCountry;
  currency: Currency;
  source: string;
  score: number;
  comment?: string;
}

const STRONG_ID_KEYS = new Set([
  "deliveryAddressOid",
  "deliveryAddressId",
  "addressOid",
  "addressId",
  "locationUid",
  "pickupPointId",
  "pickPointId",
  "pvzId",
  "pointId"
]);

const WEAK_ID_KEYS = new Set(["locationId", "cityId", "geoId", "regionId"]);
const RELEVANCE_RE = /(delivery|address|pickup|pickpoint|pvz|пвз|пункт|получ|достав|location|geo|city|region)/i;
const BAD_ID_RE = /(product|sku|item|seller|brand|category|image|price|cart|widget|layout|session|fingerprint|analytics|banner)/i;
const KZ_RE = /(kazakhstan|казахстан|kz\b|алматы|астана|караганда|шымкент|атырау|актобе|павлодар|усть-каменогорск)/i;
const RU_RE = /(russia|россия|ru\b|москва|санкт-петербург|екатеринбург|казань|новосибирск|краснодар)/i;

export function extractOzonPickupCandidatesFromSources(sources: OzonCaptureSource[]): OzonPickupCandidate[] {
  const candidates: OzonPickupCandidate[] = [];

  for (const source of sources) {
    const sourceText = `${source.source} ${source.urlHint || ""} ${source.textHint || ""}`;
    collectFromUnknown(parseMaybeJson(source.value), source.source, sourceText, candidates);
    if (typeof source.value === "string") {
      collectFromText(source.value, source.source, sourceText, candidates);
    }
  }

  return dedupeCandidates(candidates).sort((a, b) => b.score - a.score);
}

function collectFromUnknown(
  value: unknown,
  source: string,
  sourceText: string,
  candidates: OzonPickupCandidate[],
  path: string[] = [],
  depth = 0
): void {
  if (depth > 8 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const parsed = parseMaybeJson(value);
    if (parsed !== value) {
      collectFromUnknown(parsed, source, sourceText, candidates, path, depth + 1);
    } else {
      collectFromText(value, source, sourceText, candidates);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.slice(0, 150).forEach((item, index) => {
      collectFromUnknown(item, source, sourceText, candidates, [...path, String(index)], depth + 1);
    });
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const object = value as Record<string, unknown>;
  collectFromObject(object, source, sourceText, path, candidates);
  for (const [key, child] of Object.entries(object).slice(0, 250)) {
    collectFromUnknown(child, source, sourceText, candidates, [...path, key], depth + 1);
  }
}

function collectFromObject(
  object: Record<string, unknown>,
  source: string,
  sourceText: string,
  path: string[],
  candidates: OzonPickupCandidate[]
): void {
  const keys = Object.keys(object);
  const pathText = [...path, ...keys].join(".");
  const relevantObject = RELEVANCE_RE.test(pathText) || RELEVANCE_RE.test(sourceText);
  const objectText = objectStrings(object).join(" ");
  const name = extractName(object, sourceText);
  const country = inferCountry(`${sourceText} ${objectText}`);
  const currency = country === "KZ" ? "KZT" : "RUB";

  for (const [key, rawValue] of Object.entries(object)) {
    const id = normalizeId(rawValue);
    if (!id || BAD_ID_RE.test(key)) {
      continue;
    }

    const keyScore = scoreIdKey(key);
    if (keyScore === 0 || (keyScore < 35 && !relevantObject)) {
      continue;
    }

    candidates.push({
      externalLocationId: id,
      name: name || `Ozon pickup ${id}`,
      country,
      currency,
      source,
      score: keyScore + (relevantObject ? 20 : 0) + (name ? 10 : 0) + (country === "KZ" ? 2 : 0),
      comment: `Captured from ${source}`
    });
  }
}

function collectFromText(text: string, source: string, sourceText: string, candidates: OzonPickupCandidate[]): void {
  if (!RELEVANCE_RE.test(`${source} ${sourceText} ${text.slice(0, 2000)}`)) {
    return;
  }

  const patterns = [
    /(?:deliveryAddressOid|deliveryAddressId|addressOid|addressId|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
    /(?:deliveryAddressOid|deliveryAddressId|addressOid|addressId|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const id = normalizeId(match[1]);
      if (!id) {
        continue;
      }
      const country = inferCountry(`${sourceText} ${text.slice(Math.max(0, match.index - 200), match.index + 300)}`);
      candidates.push({
        externalLocationId: id,
        name: `Ozon pickup ${id}`,
        country,
        currency: country === "KZ" ? "KZT" : "RUB",
        source,
        score: 35,
        comment: `Captured from ${source}`
      });
    }
  }
}

function scoreIdKey(key: string): number {
  if (STRONG_ID_KEYS.has(key)) {
    return 60;
  }
  if (WEAK_ID_KEYS.has(key)) {
    return 20;
  }
  if (/(delivery|address|pickup|pick|pvz|location).*(oid|id|uid)$/i.test(key)) {
    return 45;
  }
  if (/(oid|id|uid)$/i.test(key) && RELEVANCE_RE.test(key)) {
    return 25;
  }
  return 0;
}

function extractName(object: Record<string, unknown>, sourceText: string): string {
  const exactKeys = [
    "fullAddress",
    "formattedAddress",
    "address",
    "addressText",
    "shortAddress",
    "displayName",
    "name",
    "title",
    "city"
  ];

  for (const key of exactKeys) {
    const value = stringValue(object[key]);
    if (value && isUsefulLabel(value)) {
      return compact(value);
    }
  }

  for (const [key, rawValue] of Object.entries(object)) {
    const value = stringValue(rawValue);
    if (value && /(address|name|title|city|street|пвз|пункт)/i.test(key) && isUsefulLabel(value)) {
      return compact(value);
    }
  }

  const sourceLabel = sourceText.match(/(?:пункт выдачи|пвз|pickup point|адрес)[:\s-]+([^|]{8,120})/i)?.[1];
  return sourceLabel ? compact(sourceLabel) : "";
}

function inferCountry(text: string): PickupCountry {
  if (/https?:\/\/(?:[^/]+\.)?ozon\.kz\b/i.test(text) || /\bozon\.kz\b/i.test(text)) {
    return "KZ";
  }
  if (/https?:\/\/(?:[^/]+\.)?ozon\.ru\b/i.test(text) || /\bozon\.ru\b/i.test(text)) {
    return "RU";
  }
  if (KZ_RE.test(text) || /\.kz\b/i.test(text)) {
    return "KZ";
  }
  if (RU_RE.test(text) || /\.ru\b/i.test(text)) {
    return "RU";
  }
  return "RU";
}

function objectStrings(object: Record<string, unknown>): string[] {
  return Object.values(object)
    .filter((value): value is string => typeof value === "string")
    .slice(0, 30);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeId(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  return /^[a-z0-9_-]{4,80}$/i.test(trimmed) ? trimmed : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isUsefulLabel(value: string): boolean {
  const ozonPointMatches = value.match(/Пункт\s+Ozon\s*№/gi);
  return value.length >= 3 && value.length <= 180 && !/^[a-z0-9_-]{4,80}$/i.test(value) && (ozonPointMatches?.length || 0) <= 1;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupeCandidates(candidates: OzonPickupCandidate[]): OzonPickupCandidate[] {
  const byId = new Map<string, OzonPickupCandidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.externalLocationId);
    if (!existing || candidate.score > existing.score || (candidate.name.length > existing.name.length && candidate.score === existing.score)) {
      byId.set(candidate.externalLocationId, candidate);
    }
  }
  return [...byId.values()];
}
