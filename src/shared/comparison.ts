import { convertAmount, roundMoney } from "./currency";
import {
  ComparisonResult,
  ComparisonRow,
  Currency,
  ExtensionSettings,
  PickupPoint,
  PriceQuote
} from "./types";

export function makeSuccessResult(
  pickupPointId: string,
  originalPrice: PriceQuote,
  targetCurrency: Currency,
  settings: ExtensionSettings
): ComparisonResult {
  return {
    pickupPointId,
    status: "success",
    originalPrice,
    convertedAmount: roundMoney(
      convertAmount(originalPrice.amount, originalPrice.currency, targetCurrency, settings.ratesToRub)
    ),
    convertedCurrency: targetCurrency
  };
}

export function makeErrorResult(pickupPointId: string, error: unknown): ComparisonResult {
  return {
    pickupPointId,
    status: "error",
    error: error instanceof Error ? error.message : String(error)
  };
}

export function buildComparisonRows(
  pickupPoints: PickupPoint[],
  results: ComparisonResult[]
): ComparisonRow[] {
  const resultByPoint = new Map(results.map((result) => [result.pickupPointId, result]));
  const successfulAmounts = results
    .filter((result): result is Extract<ComparisonResult, { status: "success" }> => result.status === "success")
    .map((result) => result.convertedAmount);
  const cheapest = successfulAmounts.length > 0 ? Math.min(...successfulAmounts) : undefined;

  return pickupPoints.map((pickupPoint) => {
    const result = resultByPoint.get(pickupPoint.id) ?? makeErrorResult(pickupPoint.id, "No result");
    const isCheapest = result.status === "success" && cheapest !== undefined && result.convertedAmount === cheapest;
    return {
      pickupPoint,
      result,
      isCheapest,
      deltaFromCheapest:
        result.status === "success" && cheapest !== undefined ? roundMoney(result.convertedAmount - cheapest) : undefined
    };
  });
}
