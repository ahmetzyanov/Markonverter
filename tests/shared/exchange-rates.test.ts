import {
  applyCurrencyRateResult,
  currencyRateProviderFallbackOrder,
  fetchCurrencyRates,
  isCurrencyRateCacheFresh
} from "../../src/shared/exchange-rates";
import { DEFAULT_SETTINGS } from "../../src/shared/types";

describe("exchange rate providers", () => {
  it("reads KZT to RUB directly from CBR VunitRate", async () => {
    const result = await fetchCurrencyRates("cbr", async () =>
      textResponse(`
        <ValCurs Date="30.06.2026">
          <Valute>
            <CharCode>AUD</CharCode>
            <Nominal>1</Nominal>
            <Value>53,9600</Value>
            <VunitRate>53,9600</VunitRate>
          </Valute>
          <Valute>
            <CharCode>KZT</CharCode>
            <Nominal>100</Nominal>
            <Value>15,9833</Value>
            <VunitRate>0,159833</VunitRate>
          </Valute>
        </ValCurs>
      `)
    );

    expect(result.provider).toBe("cbr");
    expect(result.fallbackUsed).toBe(false);
    expect(result.effectiveDate).toBe("30.06.2026");
    expect(result.ratesToRub.KZT).toBeCloseTo(0.159833);
  });

  it("inverts National Bank KZ RUB rate into KZT to RUB", async () => {
    const result = await fetchCurrencyRates("nbk", async () =>
      textResponse(`
        <rss>
          <channel>
            <item>
              <title>USD</title>
              <pubDate>30.06.2026</pubDate>
              <description>520.00</description>
              <quant>1</quant>
            </item>
            <item>
              <title>RUB</title>
              <pubDate>30.06.2026</pubDate>
              <description>6.24</description>
              <quant>1</quant>
            </item>
          </channel>
        </rss>
      `)
    );

    expect(result.provider).toBe("nbk");
    expect(result.ratesToRub.KZT).toBeCloseTo(1 / 6.24);
  });

  it("falls back when a provider returns an implausible KZT to RUB rate", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cbr.ru")) {
        return textResponse(`
          <ValCurs Date="30.06.2026">
            <Valute>
              <CharCode>KZT</CharCode>
              <Nominal>1</Nominal>
              <Value>53,9600</Value>
              <VunitRate>53,9600</VunitRate>
            </Valute>
          </ValCurs>
        `);
      }

      return textResponse(`
        <rss>
          <channel>
            <item>
              <title>RUB</title>
              <pubDate>30.06.2026</pubDate>
              <description>6.24</description>
              <quant>1</quant>
            </item>
          </channel>
        </rss>
      `);
    });

    const result = await fetchCurrencyRates("cbr", fetcher);

    expect(result.provider).toBe("nbk");
    expect(result.fallbackUsed).toBe(true);
    expect(result.ratesToRub.KZT).toBeCloseTo(1 / 6.24);
  });

  it("inverts ExchangeRate-API RUB rate into KZT to RUB", async () => {
    const result = await fetchCurrencyRates("exchangeRateApi", async () =>
      jsonResponse({
        result: "success",
        time_last_update_utc: "Mon, 29 Jun 2026 00:02:31 +0000",
        base_code: "RUB",
        rates: {
          RUB: 1,
          KZT: 6.25
        }
      })
    );

    expect(result.provider).toBe("exchangeRateApi");
    expect(result.ratesToRub.KZT).toBeCloseTo(0.16);
  });

  it("tries the remaining providers as fallbacks", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cbr.ru")) {
        return textResponse("unavailable", 503);
      }
      if (url.includes("nationalbank.kz")) {
        return textResponse("unavailable", 503);
      }
      return jsonResponse({
        result: "success",
        rates: {
          KZT: 6.25
        }
      });
    });

    const result = await fetchCurrencyRates("cbr", fetcher);

    expect(result.provider).toBe("exchangeRateApi");
    expect(result.fallbackUsed).toBe(true);
    expect(result.attemptedProviders).toEqual(["cbr", "nbk", "exchangeRateApi"]);
    expect(result.ratesToRub.KZT).toBeCloseTo(0.16);
  });

  it("keeps the selected provider while storing the actual fallback provider", async () => {
    const result = await fetchCurrencyRates("cbr", async () =>
      jsonResponse({
        result: "success",
        rates: {
          KZT: 6.25
        }
      })
    );

    const settings = applyCurrencyRateResult(DEFAULT_SETTINGS, { ...result, provider: "exchangeRateApi", fallbackUsed: true }, "cbr");

    expect(settings.currencyRateProvider).toBe("cbr");
    expect(settings.currencyRateMeta?.provider).toBe("exchangeRateApi");
    expect(settings.currencyRateMeta?.fallbackUsed).toBe(true);
  });

  it("uses the preferred provider first", () => {
    expect(currencyRateProviderFallbackOrder("nbk")).toEqual(["nbk", "cbr", "exchangeRateApi"]);
  });

  it("does not auto-refresh manual rates", async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      currencyRateProvider: "manual" as const,
      currencyRateMeta: {
        provider: "manual" as const,
        updatedAt: "2026-06-01T00:00:00.000Z"
      }
    };

    expect(currencyRateProviderFallbackOrder("manual")).toEqual([]);
    expect(isCurrencyRateCacheFresh(settings, Date.parse("2026-06-30T10:00:00.000Z"))).toBe(true);
    await expect(fetchCurrencyRates("manual")).rejects.toThrow("Manual currency rates cannot be updated automatically");
  });

  it("treats recent metadata as a fresh cache", () => {
    const now = Date.parse("2026-06-30T10:00:00.000Z");
    const settings = {
      ...DEFAULT_SETTINGS,
      currencyRateMeta: {
        provider: "cbr" as const,
        updatedAt: "2026-06-30T09:00:00.000Z"
      }
    };

    expect(isCurrencyRateCacheFresh(settings, now)).toBe(true);
  });
});

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
