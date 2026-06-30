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
  "deliveryAddressUid",
  "addressOid",
  "addressId",
  "addressUid",
  "selectAddress",
  "select_address",
  "locationUid",
  "pickupPointId",
  "pickPointId",
  "pvzId",
  "pointId"
]);

const WEAK_ID_KEYS = new Set(["locationId", "cityId", "geoId", "regionId"]);
const RELEVANCE_RE = /(delivery|address|pickup|pickpoint|pvz|пвз|пункт|получ|достав|location|geo|city|region)/i;
const BAD_ID_RE = /(product|sku|item|seller|brand|category|image|price|cart|widget|layout|session|fingerprint|analytics|banner)/i;
const SERVICE_LABEL_RE =
  /(?:^|[\s,{])\\?["']?(?:url|href|action|layoutId|layoutVersion|pageType|ruleId|referer|referrer|widgetStates?|analytics|tracking|component|state|params?|query)\\?["']?\s*[:=]/i;
const TECHNICAL_LABEL_RE = /^(?:api|network|content)\.[a-z0-9._/?=&%-]+$/i;
const TECHNICAL_ENDPOINT_LABEL_RE = /\b(?:composer|entrypoint)(?:-[a-z0-9]+)*-(?:addressbook|delivery|geo)\b/i;
const UI_ACTION_LABEL_RE = /^(?:удалить|delete|remove|add|save|saved|edit|options|hide|open|refresh pvz|show in panel)$/i;
const BARE_OZON_POINT_LABEL_RE = /^пункт\s+ozon(?:\s*[•·|,;:.-]+)?$/i;
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

export function isGenericOzonPickupName(name: string, externalLocationId: string): boolean {
  const label = compact(name);
  const id = compact(externalLocationId);
  if (!label) {
    return true;
  }
  if (id && label.toLowerCase() === id.toLowerCase()) {
    return true;
  }
  if (/^[a-z0-9_-]{4,80}$/i.test(label)) {
    return true;
  }
  if (/^ozon pickup [a-z0-9_-]{4,80}$/i.test(label)) {
    return true;
  }
  if (id && label.toLowerCase() === `pickup ${id}`.toLowerCase()) {
    return true;
  }
  return isUnsafeOzonPickupName(label, id);
}

export function shouldReplaceOzonPickupCandidate(existing: OzonPickupCandidate, candidate: OzonPickupCandidate): boolean {
  if (isUnsafeOzonPickupName(candidate.name, candidate.externalLocationId)) {
    return false;
  }
  if (isUnsafeOzonPickupName(existing.name, existing.externalLocationId)) {
    return true;
  }

  const existingLabelScore = scorePickupLabel(existing.name, existing.externalLocationId);
  const candidateLabelScore = scorePickupLabel(candidate.name, candidate.externalLocationId);

  if (candidateLabelScore > existingLabelScore && candidate.score >= existing.score - 35) {
    return true;
  }
  if (candidateLabelScore < existingLabelScore && isGenericOzonPickupName(candidate.name, candidate.externalLocationId)) {
    return false;
  }
  if (candidate.score > existing.score) {
    return true;
  }
  return candidate.score === existing.score && candidateLabelScore >= existingLabelScore && candidate.name.length > existing.name.length;
}

export function shouldUseOzonPickupName(currentName: string, candidateName: string, externalLocationId: string): boolean {
  if (isUnsafeOzonPickupName(currentName, externalLocationId) && isCanonicalGenericOzonPickupName(candidateName, externalLocationId)) {
    return true;
  }
  return (
    isGenericOzonPickupName(currentName, externalLocationId) &&
    scorePickupLabel(candidateName, externalLocationId) > scorePickupLabel(currentName, externalLocationId)
  );
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

    const bestName = name || extractNameNearId(sourceText, id, sourceText.indexOf(id));
    candidates.push({
      externalLocationId: id,
      name: bestName || `Ozon pickup ${id}`,
      country,
      currency,
      source,
      score: keyScore + (relevantObject ? 20 : 0) + (bestName ? 10 : 0) + (country === "KZ" ? 2 : 0),
      comment: `Captured from ${source}`
    });
  }
}

function collectFromText(text: string, source: string, sourceText: string, candidates: OzonPickupCandidate[]): void {
  if (!RELEVANCE_RE.test(`${source} ${sourceText} ${text.slice(0, 2000)}`)) {
    return;
  }

  const patterns = [
    /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
    /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi,
    /[?&](?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)=([a-z0-9_-]{4,80})/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const id = normalizeId(match[1]);
      if (!id) {
        continue;
      }
      const country = inferCountry(`${sourceText} ${text.slice(Math.max(0, match.index - 200), match.index + 300)}`);
      const name = extractNameNearId(text, id, match.index) || extractNameNearId(sourceText, id, sourceText.indexOf(id));
      candidates.push({
        externalLocationId: id,
        name: name || `Ozon pickup ${id}`,
        country,
        currency: country === "KZ" ? "KZT" : "RUB",
        source,
        score: 35 + (name ? 30 : 0),
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
    "subtitle",
    "description",
    "caption",
    "text",
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
  return sourceLabel && isUsefulLabel(compact(sourceLabel)) ? compact(sourceLabel) : "";
}

function extractNameNearId(text: string, id: string, matchIndex: number): string {
  if (!text || matchIndex < 0) {
    return "";
  }

  const start = Math.max(0, matchIndex - 600);
  const end = Math.min(text.length, matchIndex + id.length + 900);
  const snippet = decodeTextSnippet(text.slice(start, end));
  const localIdIndex = snippet.indexOf(id);
  const scopedText = localIdIndex >= 0 ? textScopeNearId(snippet, localIdIndex, id) : snippet;
  const labels: string[] = [];
  const structuredLabels = extractStructuredLabels(scopedText);
  const scopedTextIsJson = isJsonLikeSnippet(scopedText);

  labels.push(...structuredLabels);
  labels.push(...extractOzonPointLabels(scopedText));

  if (localIdIndex >= 0) {
    if (scopedText.includes("<") || (structuredLabels.length === 0 && !scopedTextIsJson)) {
      labels.push(stripMarkup(scopedText));
    }
    const scopedIdIndex = scopedText.indexOf(id);
    if (scopedIdIndex >= 0 && structuredLabels.length === 0 && !scopedTextIsJson) {
      labels.push(stripMarkup(scopedText.slice(scopedIdIndex + id.length)));
    }
  }

  return pickBestLabel(labels, id);
}

function textScopeNearId(text: string, idIndex: number, id: string): string {
  const tagStart = text.lastIndexOf("<", idIndex);
  const openingTagEnd = text.indexOf(">", idIndex + id.length);
  const closingTagStart = openingTagEnd >= 0 ? text.indexOf("</", openingTagEnd) : -1;
  const closingTagEnd = closingTagStart >= 0 ? text.indexOf(">", closingTagStart) : -1;
  if (tagStart >= 0 && openingTagEnd >= 0 && closingTagStart > openingTagEnd && closingTagEnd > closingTagStart) {
    return text.slice(tagStart, closingTagEnd + 1);
  }

  const objectStart = text.lastIndexOf("{", idIndex);
  const objectEnd = text.indexOf("}", idIndex + id.length);
  const jsonScope = jsonScopeNearId(text, idIndex);
  if (jsonScope) {
    return jsonScope;
  }
  if (objectStart >= 0 && objectEnd > idIndex) {
    return text.slice(objectStart, objectEnd + 1);
  }

  const itemStart = Math.max(
    0,
    Math.max(text.lastIndexOf("\n", idIndex), text.lastIndexOf("|", idIndex), text.lastIndexOf("</", idIndex))
  );
  const nextBreaks = [text.indexOf("\n", idIndex + id.length), text.indexOf("|", idIndex + id.length), text.indexOf("<", idIndex + id.length)]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const itemEnd = nextBreaks[0] ?? Math.min(text.length, idIndex + id.length + 320);
  return text.slice(itemStart, itemEnd);
}

function jsonScopeNearId(text: string, idIndex: number): string {
  const starts: number[] = [];
  let start = text.lastIndexOf("{", idIndex);
  while (start >= 0 && starts.length < 8 && idIndex - start < 2500) {
    starts.push(start);
    start = text.lastIndexOf("{", start - 1);
  }

  const scopes = starts
    .map((scopeStart) => {
      const scopeEnd = findMatchingBrace(text, scopeStart);
      return scopeEnd > idIndex ? text.slice(scopeStart, scopeEnd + 1) : "";
    })
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);

  const scopedToSinglePickup = scopes.filter((scope) => countPickupIdsInText(scope) <= 1);
  return (
    scopedToSinglePickup.find((scope) => extractStructuredLabels(scope).some((label) => isUsefulLabel(compact(label)))) ||
    scopedToSinglePickup[0] ||
    ""
  );
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractStructuredLabels(text: string): string[] {
  const labels: string[] = [];
  const pattern =
    /(?:fullAddress|formattedAddress|addressText|shortAddress|displayName|address|subtitle|description|caption|title|name|city|street|text)["'\s]*[:=]\s*["']([^"']{3,260})/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > 0 && /[\w-]/.test(text[match.index - 1] || "")) {
      continue;
    }
    labels.push(match[1]);
  }
  const attributePattern = /(?:aria-label|title|data-address|data-title)=["']([^"']{3,260})/gi;
  while ((match = attributePattern.exec(text))) {
    labels.push(match[1]);
  }
  return labels;
}

function countPickupIdsInText(text: string): number {
  const ids = new Set<string>();
  const patterns = [
    /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'=:\s]+([a-z0-9_-]{4,80})/gi,
    /(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)["'\s]*[:=]["'\s]*([a-z0-9_-]{4,80})/gi,
    /[?&](?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)=([a-z0-9_-]{4,80})/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const id = normalizeId(match[1]);
      if (id) {
        ids.add(id);
      }
    }
  }
  return ids.size;
}

function extractOzonPointLabels(text: string): string[] {
  const labels: string[] = [];
  const pattern = /Пункт\s+Ozon\s*№\s*[\d-]+[^|<>{}\[\]\n\r]{0,170}/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    labels.push(match[0]);
  }
  return labels;
}

function pickBestLabel(labels: string[], externalLocationId: string): string {
  let best = "";
  let bestScore = 0;
  for (const rawLabel of labels) {
    const label = cleanLabel(rawLabel, externalLocationId);
    if (!label || !isUsefulLabel(label)) {
      continue;
    }
    const score = scorePickupLabel(label, externalLocationId);
    if (score > bestScore || (score === bestScore && label.length > best.length && label.length <= 180)) {
      best = label;
      bestScore = score;
    }
  }
  return best;
}

function cleanLabel(value: string, externalLocationId: string): string {
  const withoutMarkup = stripMarkup(decodeTextSnippet(value))
    .replace(new RegExp(externalLocationId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    .replace(/(?:deliveryAddressOid|deliveryAddressId|deliveryAddressUid|addressOid|addressId|addressUid|select_address|selectAddress|locationUid|pickupPointId|pickPointId|pvzId|pointId)\s*[:=]?\s*/gi, " ")
    .replace(/(?:fullAddress|formattedAddress|addressText|shortAddress|displayName|address|subtitle|description|caption|title|name|city|street|text)\\?["']?\s*[:=]\s*\\?["']?/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\/modal\/addressbook\S*/gi, " ")
    .replace(/\\[nrt]/gi, " ");
  return compact(withoutMarkup)
    .replace(/^[\s"'=:,;{}()[\]<>.-]+/, "")
    .replace(/[\s"'=:,;{}()[\]<>.-]+$/, "");
}

function decodeTextSnippet(value: string): string {
  return value
    .replace(/\\u([\da-f]{4})/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number.parseInt(code, 10)));
}

function stripMarkup(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
}

function isJsonLikeSnippet(value: string): boolean {
  return /^\s*[{[]/.test(value) || /["'][a-z][\w-]*["']\s*:/i.test(value) || SERVICE_LABEL_RE.test(value);
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
  return (
    value.length >= 3 &&
    value.length <= 180 &&
    !SERVICE_LABEL_RE.test(value) &&
    !/\b(?:layoutId|layoutVersion|pageType|ruleId|referer|referrer|widgetStates?)\b/i.test(value) &&
    !TECHNICAL_LABEL_RE.test(value) &&
    !TECHNICAL_ENDPOINT_LABEL_RE.test(value) &&
    !UI_ACTION_LABEL_RE.test(value) &&
    !BARE_OZON_POINT_LABEL_RE.test(value) &&
    !/%[0-9a-f]{2}/i.test(value) &&
    !/\\?["'][,;]\\?["']/.test(value) &&
    (value.match(/["']?[a-z][\w-]*["']?\s*[:=]/gi)?.length || 0) < 2 &&
    !/^(url|href|action|items?|widgetStates?|addressbook|delivery|address|title|name|subtitle)$/i.test(value) &&
    !/^[a-z0-9_-]{4,80}$/i.test(value) &&
    !/^ozon pickup [a-z0-9_-]{4,80}$/i.test(value) &&
    (ozonPointMatches?.length || 0) <= 1
  );
}

function isUnsafeOzonPickupName(name: string, externalLocationId: string): boolean {
  const label = compact(name);
  if (!label || isCanonicalGenericOzonPickupName(label, externalLocationId)) {
    return false;
  }
  return !isUsefulLabel(label);
}

function isCanonicalGenericOzonPickupName(name: string, externalLocationId: string): boolean {
  const label = compact(name);
  const id = compact(externalLocationId);
  if (!id) {
    return false;
  }
  return (
    label.toLowerCase() === id.toLowerCase() ||
    label.toLowerCase() === `pickup ${id}`.toLowerCase() ||
    label.toLowerCase() === `ozon pickup ${id}`.toLowerCase()
  );
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function scorePickupLabel(name: string, externalLocationId: string): number {
  const label = compact(name);
  if (isGenericOzonPickupName(label, externalLocationId) || !isUsefulLabel(label)) {
    return 0;
  }

  let score = 1;
  if (/пункт\s+ozon\s*№|pvz|pickup point/i.test(label)) {
    score += 1;
  }
  if (/[,\d]/.test(label)) {
    score += 1;
  }
  if (/(ул\.?|улица|пр-кт|проспект|шоссе|пер\.?|переулок|дом|д\.|street|avenue|road)/i.test(label)) {
    score += 2;
  }
  if (/(москва|санкт-петербург|екатеринбург|казань|новосибирск|краснодар|алматы|астана|караганда|шымкент|атырау|актобе|павлодар|буинск)/i.test(label)) {
    score += 2;
  }
  return score;
}

function dedupeCandidates(candidates: OzonPickupCandidate[]): OzonPickupCandidate[] {
  const byId = new Map<string, OzonPickupCandidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.externalLocationId);
    if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
      byId.set(candidate.externalLocationId, candidate);
    }
  }
  return [...byId.values()];
}
