import { Currency, ExtensionSettings } from "./types";

export function convertAmount(
  amount: number,
  from: Currency,
  to: Currency,
  ratesToRub: ExtensionSettings["ratesToRub"]
): number {
  assertPositiveRate(from, ratesToRub[from]);
  assertPositiveRate(to, ratesToRub[to]);
  return (amount * ratesToRub[from]) / ratesToRub[to];
}

export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "KZT" ? 0 : 2
  }).format(amount);
}

function assertPositiveRate(currency: Currency, rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Invalid ${currency} exchange rate`);
  }
}
