import {
  CurrencyRateProvider,
  CurrencyRateRefreshResult,
  ExtensionSettings
} from "./types";
import { normalizeSettings } from "./validation";

export const CURRENCY_RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PROVIDER_FETCH_TIMEOUT_MS = 5000;
export const REMOTE_CURRENCY_RATE_PROVIDERS: CurrencyRateProvider[] = ["cbr", "nbk", "exchangeRateApi"];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ProviderQuote {
  provider: CurrencyRateProvider;
  rateKztToRub: number;
  effectiveDate?: string;
}

export function currencyRateProviderFallbackOrder(preferredProvider: CurrencyRateProvider): CurrencyRateProvider[] {
  if (preferredProvider === "manual") {
    return [];
  }
  return [
    preferredProvider,
    ...REMOTE_CURRENCY_RATE_PROVIDERS.filter((provider) => provider !== preferredProvider)
  ];
}

export function isCurrencyRateCacheFresh(
  settings: ExtensionSettings,
  now = Date.now(),
  ttlMs = CURRENCY_RATE_CACHE_TTL_MS
): boolean {
  if (settings.currencyRateProvider === "manual") {
    return true;
  }
  const updatedAt = Date.parse(settings.currencyRateMeta?.updatedAt || "");
  return Number.isFinite(updatedAt) && updatedAt <= now && now - updatedAt < ttlMs;
}

export async function fetchCurrencyRates(
  preferredProvider: CurrencyRateProvider,
  fetcher: FetchLike = fetch
): Promise<CurrencyRateRefreshResult> {
  if (preferredProvider === "manual") {
    throw new Error("Manual currency rates cannot be updated automatically");
  }
  const attemptedProviders = currencyRateProviderFallbackOrder(preferredProvider);
  const errors: string[] = [];

  for (const provider of attemptedProviders) {
    try {
      const quote = await fetchProviderQuote(provider, fetcher);
      return {
        provider: quote.provider,
        updatedAt: new Date().toISOString(),
        effectiveDate: quote.effectiveDate,
        fallbackUsed: provider !== preferredProvider,
        ratesToRub: {
          RUB: 1,
          KZT: quote.rateKztToRub
        },
        attemptedProviders
      };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Could not update currency rates (${errors.join("; ")})`);
}

export function applyCurrencyRateResult(
  settings: ExtensionSettings,
  result: CurrencyRateRefreshResult,
  preferredProvider = settings.currencyRateProvider
): ExtensionSettings {
  return normalizeSettings({
    ...settings,
    currencyRateProvider: preferredProvider,
    currencyRateMeta: {
      provider: result.provider,
      updatedAt: result.updatedAt,
      effectiveDate: result.effectiveDate,
      fallbackUsed: result.fallbackUsed
    },
    ratesToRub: result.ratesToRub
  });
}

async function fetchProviderQuote(provider: CurrencyRateProvider, fetcher: FetchLike): Promise<ProviderQuote> {
  if (provider === "cbr") {
    return fetchCbrQuote(fetcher);
  }
  if (provider === "nbk") {
    return fetchNationalBankKzQuote(fetcher);
  }
  return fetchExchangeRateApiQuote(fetcher);
}

async function fetchCbrQuote(fetcher: FetchLike): Promise<ProviderQuote> {
  const text = await fetchText(fetcher, "https://www.cbr.ru/scripts/XML_daily.asp");
  const valuteBlock = matchBlock(text, /<Valute\b[^>]*>[\s\S]*?<CharCode>\s*KZT\s*<\/CharCode>[\s\S]*?<\/Valute>/i, "CBR KZT rate");
  const vunitRate = parseDecimal(matchTag(valuteBlock, "VunitRate"));
  const value = parseDecimal(matchTag(valuteBlock, "Value"));
  const nominal = parseDecimal(matchTag(valuteBlock, "Nominal")) || 1;
  const rateKztToRub = vunitRate || value / nominal;

  return {
    provider: "cbr",
    rateKztToRub: assertPositiveRate(rateKztToRub, "CBR KZT rate"),
    effectiveDate: text.match(/<ValCurs\b[^>]*Date="([^"]+)"/i)?.[1]
  };
}

async function fetchNationalBankKzQuote(fetcher: FetchLike): Promise<ProviderQuote> {
  const text = await fetchText(fetcher, "https://nationalbank.kz/rss/rates_all.xml");
  const itemBlock = matchBlock(text, /<item\b[^>]*>[\s\S]*?<title>\s*RUB\s*<\/title>[\s\S]*?<\/item>/i, "NBK RUB rate");
  const rubInKzt = parseDecimal(matchTag(itemBlock, "description"));
  const quant = parseDecimal(matchTag(itemBlock, "quant")) || 1;
  const rateKztToRub = quant / rubInKzt;

  return {
    provider: "nbk",
    rateKztToRub: assertPositiveRate(rateKztToRub, "NBK RUB rate"),
    effectiveDate: matchTag(itemBlock, "pubDate")
  };
}

async function fetchExchangeRateApiQuote(fetcher: FetchLike): Promise<ProviderQuote> {
  const response = await fetchWithTimeout(fetcher, "https://open.er-api.com/v6/latest/RUB");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    result?: string;
    rates?: Record<string, unknown>;
    time_last_update_utc?: string;
    time_next_update_utc?: string;
  };
  if (data.result && data.result !== "success") {
    throw new Error(`Unexpected result ${data.result}`);
  }

  const rubToKzt = typeof data.rates?.KZT === "number" ? data.rates.KZT : Number(data.rates?.KZT);
  return {
    provider: "exchangeRateApi",
    rateKztToRub: assertPositiveRate(1 / rubToKzt, "ExchangeRate-API KZT rate"),
    effectiveDate: data.time_last_update_utc || data.time_next_update_utc
  };
}

async function fetchText(fetcher: FetchLike, url: string): Promise<string> {
  const response = await fetchWithTimeout(fetcher, url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function fetchWithTimeout(fetcher: FetchLike, url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, PROVIDER_FETCH_TIMEOUT_MS);

  try {
    return await fetcher(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function matchBlock(value: string, pattern: RegExp, label: string): string {
  const match = value.match(pattern)?.[0];
  if (!match) {
    throw new Error(`${label} was not found`);
  }
  return match;
}

function matchTag(value: string, tagName: string): string | undefined {
  return value.match(new RegExp(`<${tagName}>\\s*([^<]+?)\\s*<\\/${tagName}>`, "i"))?.[1];
}

function parseDecimal(value: string | undefined): number {
  if (!value) {
    return NaN;
  }
  return Number(value.replace(",", ".").replace(/\s+/g, ""));
}

function assertPositiveRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
