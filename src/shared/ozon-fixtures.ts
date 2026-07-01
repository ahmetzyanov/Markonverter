export const OZON_FIXTURE_STORE_KEY = "markonverter.ozonFixtures";
export const OZON_FIXTURE_STORE_VERSION = 1;
export const MAX_OZON_FIXTURE_RECORDS = 30;
export const MAX_OZON_FIXTURE_BODY_CHARS = 750_000;
export const MAX_OZON_FIXTURE_REQUEST_BODY_CHARS = 20_000;

export interface OzonNetworkFixtureInput {
  source: string;
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  pageUrl: string;
  requestBody?: string;
  responseText: string;
  responseLength?: number;
}

export interface OzonNetworkFixtureRecord extends OzonNetworkFixtureInput {
  id: string;
  capturedAt: string;
  responseLength: number;
  responseTruncated: boolean;
}

export interface OzonFixtureStore {
  version: typeof OZON_FIXTURE_STORE_VERSION;
  records: OzonNetworkFixtureRecord[];
}

export function emptyOzonFixtureStore(): OzonFixtureStore {
  return {
    version: OZON_FIXTURE_STORE_VERSION,
    records: []
  };
}

export function createOzonFixtureRecord(
  input: OzonNetworkFixtureInput,
  now = new Date()
): OzonNetworkFixtureRecord | null {
  const url = cleanText(input.url, 3000);
  const responseText = typeof input.responseText === "string" ? input.responseText : "";
  if (!isRelevantOzonFixtureUrl(url) || !responseText) {
    return null;
  }

  const responseLength = Number.isFinite(input.responseLength) && input.responseLength && input.responseLength > 0
    ? Math.floor(input.responseLength)
    : responseText.length;
  const truncatedResponse = truncateText(responseText, MAX_OZON_FIXTURE_BODY_CHARS);
  const requestBody = input.requestBody ? truncateText(input.requestBody, MAX_OZON_FIXTURE_REQUEST_BODY_CHARS).text : undefined;
  const method = cleanText(input.method || "GET", 12).toUpperCase() || "GET";

  return {
    id: fixtureRecordId(method, url, responseLength, truncatedResponse.text),
    capturedAt: now.toISOString(),
    source: cleanText(input.source || "network", 80),
    method,
    url,
    status: sanitizeStatus(input.status),
    contentType: cleanText(input.contentType || "", 160),
    pageUrl: cleanText(input.pageUrl || "", 3000),
    requestBody,
    responseText: truncatedResponse.text,
    responseLength,
    responseTruncated: truncatedResponse.truncated
  };
}

export function appendOzonFixtureRecords(
  store: OzonFixtureStore,
  inputs: OzonNetworkFixtureInput[],
  now = new Date()
): OzonFixtureStore {
  const records = [...normalizeOzonFixtureStore(store).records];
  for (const input of inputs) {
    const record = createOzonFixtureRecord(input, now);
    if (!record) {
      continue;
    }
    const existingIndex = records.findIndex((existing) => existing.id === record.id);
    if (existingIndex >= 0) {
      records.splice(existingIndex, 1);
    }
    records.push(record);
  }

  return {
    version: OZON_FIXTURE_STORE_VERSION,
    records: records.slice(-MAX_OZON_FIXTURE_RECORDS)
  };
}

export function normalizeOzonFixtureStore(value: unknown): OzonFixtureStore {
  const candidate = value as Partial<OzonFixtureStore> | undefined;
  const records = Array.isArray(candidate?.records)
    ? candidate.records.map(normalizeOzonFixtureRecord).filter((record): record is OzonNetworkFixtureRecord => Boolean(record))
    : [];
  return {
    version: OZON_FIXTURE_STORE_VERSION,
    records: records.slice(-MAX_OZON_FIXTURE_RECORDS)
  };
}

function normalizeOzonFixtureRecord(value: unknown): OzonNetworkFixtureRecord | null {
  const candidate = value as Partial<OzonNetworkFixtureRecord> | undefined;
  if (!candidate || typeof candidate.responseText !== "string" || typeof candidate.url !== "string") {
    return null;
  }
  return createOzonFixtureRecord(
    {
      source: candidate.source || "network",
      method: candidate.method || "GET",
      url: candidate.url,
      status: candidate.status,
      contentType: candidate.contentType,
      pageUrl: candidate.pageUrl || "",
      requestBody: candidate.requestBody,
      responseText: candidate.responseText,
      responseLength: candidate.responseLength
    },
    parseDate(candidate.capturedAt) || new Date()
  );
}

function isRelevantOzonFixtureUrl(url: string): boolean {
  return /(?:^|\/\/)(?:[^/]+\.)?ozon\.(?:ru|kz)\//i.test(url) && /(composer-api|entrypoint-api|delivery|address|location|geo|pvz|pickup)/i.test(url);
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function truncateText(value: string, maxLength: number): { text: string; truncated: boolean } {
  return value.length > maxLength
    ? {
        text: value.slice(0, maxLength),
        truncated: true
      }
    : {
        text: value,
        truncated: false
      };
}

function sanitizeStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function fixtureRecordId(method: string, url: string, responseLength: number, responseText: string): string {
  return `${method}:${url}:${responseLength}:${hashText(responseText.slice(0, 20_000))}`;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
