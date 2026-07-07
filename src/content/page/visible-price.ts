import { Currency, PriceQuote } from "../../shared/types";

// Kept in sync with BADGE_ATTR in ./inline-converted-price.ts: that module
// injects a "~converted price" badge span into the same price-widget
// elements this file reads, so it must be stripped before parsing here.
const APPROX_PRICE_BADGE_ATTR = "data-mkv-approx-badge";

export function extractVisibleOzonPrice(currencyHint: Currency): PriceQuote | null {
  const selectors = ['[data-widget="webPrice"]', '[data-widget*="webPrice" i]', '[data-widget*="price" i]'];
  const seen = new Set<HTMLElement>();
  const candidates: Array<PriceQuote & { score: number }> = [];

  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (seen.has(element) || !isVisibleEnough(element)) {
        return;
      }
      seen.add(element);
      const text = compactText(readTextWithoutApproxBadges(element));
      if (!text) {
        return;
      }
      candidates.push(...parseVisiblePriceCandidates(text, currencyHint));
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    return null;
  }
  const deliveryText = extractVisibleDeliverySummary();
  return {
    amount: best.amount,
    currency: best.currency,
    rawText: best.rawText,
    ...(deliveryText ? { deliveryText } : {})
  };
}

function parseVisiblePriceCandidates(text: string, currencyHint: Currency): Array<PriceQuote & { score: number }> {
  const candidates: Array<PriceQuote & { score: number }> = [];
  const pricePattern = /(\d[\d\s\u00a0]{1,14}(?:[,.]\d{1,2})?)\s*(₽|руб\.?|рублей|RUB|₸|тг|тенге|KZT)?/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pricePattern.exec(text))) {
    const rawAmount = match[1];
    const amount = Number.parseFloat(rawAmount.replace(/[\s\u00a0]/g, "").replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
      continue;
    }
    const currency = parseCurrencyMarker(match[2] || text, currencyHint);
    const rawText = match[0].trim();
    candidates.push({
      amount,
      currency,
      rawText,
      score: 100 + (match[2] ? 30 : 0) + (amount >= 100 ? 10 : 0) - index
    });
    index += 1;
  }
  return candidates;
}

function parseCurrencyMarker(value: string, fallback: Currency): Currency {
  if (/₽|руб|RUB/i.test(value)) {
    return "RUB";
  }
  if (/₸|тг|тенге|KZT/i.test(value)) {
    return "KZT";
  }
  return fallback;
}

function extractVisibleDeliverySummary(): string | null {
  const selectors = ['[data-widget*="delivery" i]', '[data-widget*="address" i]'];
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisibleEnough(element)) {
        continue;
      }
      const text = cleanDeliverySummaryText(element);
      if (text && text.length <= 160 && /(сегодня|завтра|достав|получ|today|tomorrow|delivery|\d)/i.test(text)) {
        return text;
      }
    }
  }
  return null;
}

function isVisibleEnough(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 20 && rect.height > 8 && rect.bottom > 0 && rect.right > 0;
}

// The inline "~converted price" badge (see page/inline-converted-price.ts) is
// injected into the same price-widget elements this reads, so it must be
// stripped before parsing — otherwise its own "~..." amount becomes a second,
// unmarked price candidate.
function readTextWithoutApproxBadges(element: HTMLElement): string {
  if (!element.querySelector(`[${APPROX_PRICE_BADGE_ATTR}]`)) {
    return element.innerText || element.textContent || "";
  }
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`[${APPROX_PRICE_BADGE_ATTR}]`).forEach((node) => node.remove());
  return clone.innerText || clone.textContent || "";
}

function cleanDeliverySummaryText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("button, [role='button']").forEach((node) => node.remove());
  return stripActionText(compactText(clone.innerText || clone.textContent || ""));
}

function stripActionText(text: string): string {
  return compactText(
    text.replace(/(?:^|[\s,;|•·-])(?:Редактировать|Изменить|Удалить|Edit|Delete|Remove)(?=$|[\s,;|•·-])/giu, " ")
  );
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
