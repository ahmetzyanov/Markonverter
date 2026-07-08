import { ExtensionSettings, PickupPoint } from "../../shared/types";
import {
  isGenericOzonPickupName,
  OzonPickupCandidate,
  safeOzonPickupName,
  shouldReplaceOzonPickupCandidate
} from "./pickup-capture";

// Pure string logic for matching visible Ozon delivery text against captured
// pickup candidates and saved pickup points. Extracted from content/app.ts so
// it can be tested without a DOM; no module-level state lives here.

export function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function ozonCandidateDisplayName(candidate: OzonPickupCandidate): string {
  return safeOzonPickupName(candidate.name, candidate.externalLocationId);
}

export function ozonPickupDisplayName(pickupPoint: PickupPoint): string {
  if (pickupPoint.marketplace !== "ozon") {
    return pickupPoint.name;
  }
  return safeOzonPickupName(pickupPoint.name, pickupPoint.externalLocationId);
}

export function normalizedCandidateDisplayName(candidate: OzonPickupCandidate): string {
  return compactText(safeOzonPickupName(candidate.name, candidate.externalLocationId)).toLowerCase();
}

export function isCandidateNameSharedAcrossExternalIds(
  candidate: OzonPickupCandidate,
  allCandidates: OzonPickupCandidate[]
): boolean {
  const name = normalizedCandidateDisplayName(candidate);
  if (!name || isGenericOzonPickupName(name, candidate.externalLocationId)) {
    return false;
  }
  const matchingExternalIds = new Set(
    allCandidates.filter((item) => normalizedCandidateDisplayName(item) === name).map((item) => item.externalLocationId)
  );
  return matchingExternalIds.size > 1;
}

// Ozon exposes the selected location under several id spaces at once (the
// addressbook address UUID a point was saved with, plus the areaid/fias ids it
// echoes in composer responses). Matching "is this point the selected one"
// must accept any of them.
export function ozonPointMatchesLocationId(point: PickupPoint, locationId: string | null | undefined): boolean {
  if (!locationId) {
    return false;
  }
  return point.externalLocationId === locationId || (point.locationAliasIds ?? []).includes(locationId);
}

export function findOzonPickupPointByLocationId(points: PickupPoint[], locationId: string | null | undefined): PickupPoint | null {
  if (!locationId) {
    return null;
  }
  const exact = points.find((point) => point.marketplace === "ozon" && point.externalLocationId === locationId);
  if (exact) {
    return exact;
  }
  // Alias ids are area/city-level; only trust one that maps to a single point.
  const byAlias = points.filter((point) => point.marketplace === "ozon" && (point.locationAliasIds ?? []).includes(locationId));
  return byAlias.length === 1 ? byAlias[0] : null;
}

// Whether Ozon's currently selected location id is safe to remember as an
// alias of `point`: it must not already belong to the point, and no other
// saved point may own it (two same-city points would otherwise cross-confirm).
export function canLearnOzonLocationAlias(points: PickupPoint[], point: PickupPoint, selectedLocationId: string): boolean {
  if (ozonPointMatchesLocationId(point, selectedLocationId)) {
    return false;
  }
  return !points.some((other) => other.id !== point.id && ozonPointMatchesLocationId(other, selectedLocationId));
}

export function findSavedPickupPointForVisibleDelivery(
  settings: ExtensionSettings,
  visibleDeliveryText: string,
  allCandidates: OzonPickupCandidate[],
  currentCandidates: OzonPickupCandidate[] = []
): PickupPoint | null {
  const savedPoints = settings.pickupPoints.filter((point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "");
  const byExternalId = new Map(savedPoints.map((point) => [point.externalLocationId, point]));
  const explicitCurrentMatches = currentCandidates
    .map((candidate) => byExternalId.get(candidate.externalLocationId))
    .filter((point): point is PickupPoint => Boolean(point));
  const explicitCurrentIds = new Set(explicitCurrentMatches.map((point) => point.id));
  if (explicitCurrentIds.size === 1) {
    const [pointId] = explicitCurrentIds;
    return explicitCurrentMatches.find((point) => point.id === pointId) || null;
  }

  const candidateMatches = allCandidates
    .map((candidate) => {
      const point = byExternalId.get(candidate.externalLocationId);
      return point
        ? {
            point,
            score: scoreVisiblePickupMatch(`${candidate.name} ${ozonPickupDisplayName(point)} ${point.comment || ""}`, visibleDeliveryText, {
              allowSingleStrongToken: true
            })
          }
        : null;
    })
    .filter((match): match is { point: PickupPoint; score: number } => match !== null && match.score >= 10);

  const directMatches = savedPoints
    .map((point) => ({
      point,
      score: scoreVisiblePickupMatch(`${ozonPickupDisplayName(point)} ${point.comment || ""}`, visibleDeliveryText)
    }))
    .filter((match) => match.score >= 14);

  const byPointId = new Map<string, { point: PickupPoint; score: number }>();
  for (const match of [...candidateMatches, ...directMatches]) {
    const existing = byPointId.get(match.point.id);
    if (!existing || match.score > existing.score) {
      byPointId.set(match.point.id, match);
    }
  }

  const matches = [...byPointId.values()].sort((a, b) => b.score - a.score);
  const [best, second] = matches;
  if (!best) {
    return null;
  }
  if (second && second.score >= best.score - 6) {
    return null;
  }
  return best.point;
}

export function scoreVisiblePickupMatch(
  pickupText: string,
  visibleDeliveryText: string,
  options: { allowSingleStrongToken?: boolean } = {}
): number {
  const pickupTokens = pickupMatchTokens(pickupText);
  const visibleTokens = pickupMatchTokens(visibleDeliveryText);
  let score = 0;
  let matchedTokens = 0;
  let hasNumericMatch = false;
  let hasStrongTextMatch = false;

  for (const token of pickupTokens) {
    if (!visibleTokens.has(token)) {
      continue;
    }
    matchedTokens += 1;
    if (/\d/.test(token)) {
      hasNumericMatch = true;
    }
    if (token.length >= 5 && /\p{L}/u.test(token)) {
      hasStrongTextMatch = true;
    }
    score += token.length >= 5 ? 10 : 5;
  }

  if (matchedTokens < 2 && !hasNumericMatch && !(options.allowSingleStrongToken && hasStrongTextMatch)) {
    return 0;
  }
  return score;
}

export function pickupMatchTokens(text: string): Set<string> {
  const lowerText = text.toLowerCase();
  const normalized = lowerText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(/\s+/)
    .filter(
      (token) =>
        (token.length >= 4 || (token.length >= 2 && /\d/.test(token))) &&
        !/^(пункт|ozon|срок|хранения|заказа|дней|адрес|редактировать|изменить|удалить|delivery|pickup|edit|delete|remove)$/.test(
          token
        )
    );
  const numericAddressTokens = lowerText.match(/\d+[\p{L}]?/gu) || [];
  return new Set([...normalized, ...numericAddressTokens].slice(0, 50));
}

export function visibleDeliveryPickupLabel(text: string): string {
  const cleaned = stripOzonActionText(text)
    .replace(/^(?:доставка\s+и\s+возврат|доставка|способ\s+получения|адрес\s+доставки)\s+/i, " ")
    .replace(/(?:пункты\s+выдачи\s+ozon|срок\s+хранения\s+заказа|со\s+склада\s+продавца|с\s+\d{1,2}\s+[а-я]+|сегодня|завтра).*$/i, " ");
  const ozonPoint = compactText(cleaned.match(/Пункт\s+Ozon\s*№\s*[\d-]+[^|<>{}\[\]\n\r]{0,140}/i)?.[0] || "");
  const label = compactText(ozonPoint || cleaned).replace(/^[,;|•·\s-]+/, "").replace(/[,;|•·\s-]+$/, "");
  if (!label || label.length < 8 || label.length > 180) {
    return "";
  }
  return /(?:пункт\s+ozon\s*№|пвз|pickup|выдач)/i.test(label) || isAddressLikePickupRowText(label) ? label : "";
}

export function canUseVisibleDeliveryNameForSavedPoint(settings: ExtensionSettings, pickupPoint: PickupPoint): boolean {
  if (!isGenericOzonPickupName(pickupPoint.name, pickupPoint.externalLocationId)) {
    return false;
  }
  const genericSavedPoints = settings.pickupPoints.filter(
    (point) => point.marketplace === "ozon" && point.externalLocationId.trim() !== "" && isGenericOzonPickupName(point.name, point.externalLocationId)
  );
  return genericSavedPoints.length === 1 && genericSavedPoints[0]?.id === pickupPoint.id;
}

export function stripOzonActionText(text: string): string {
  return compactText(
    text.replace(/(?:^|[\s,;|•·-])(?:Редактировать|Изменить|Удалить|Edit|Delete|Remove)(?=$|[\s,;|•·-])/giu, " ")
  );
}

export function isOzonAddAddressControlText(text: string): boolean {
  return /(?:^|\s)(?:добавить|добавьте|add)(?:\s|$)/i.test(text) && /(адрес|пункт\s+выдач|постамат|delivery|pickup)/i.test(text);
}

export function isAddressLikePickupRowText(text: string): boolean {
  return (
    /(ул\.?|улица|пр-кт|проспект|шоссе|пер\.?|переулок|мкр|микрорайон|дом|д\.|street|avenue|road)/i.test(text) ||
    /(?:^|[\s,])\d{1,4}[а-яa-z]?(?:[\s,]|$)/i.test(text)
  );
}

export function countPickupRowMarkers(text: string): number {
  return (text.match(/(?:пункт\s+ozon|пвз|pickup|выдач)/gi) || []).length;
}

export function matchDetectedPickupCandidateToRow(
  rowText: string,
  candidates: OzonPickupCandidate[]
): OzonPickupCandidate | null {
  const rowNumber = extractOzonVisiblePointNumber(rowText);
  const rowTokens = pickupMatchTokens(rowText);
  let best: { candidate: OzonPickupCandidate; score: number } | null = null;

  for (const candidate of candidates) {
    const candidateText = `${candidate.name} ${candidate.comment || ""}`;
    const candidateNumber = extractOzonVisiblePointNumber(candidateText);
    let score = 0;
    if (rowNumber && candidateNumber && rowNumber === candidateNumber) {
      score += 100;
    }
    const candidateTokens = pickupMatchTokens(candidateText);
    for (const token of rowTokens) {
      if (candidateTokens.has(token)) {
        score += token.length >= 5 ? 10 : 4;
      }
    }
    if (score < 14) {
      continue;
    }
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  return best?.candidate || null;
}

export function extractOzonVisiblePointNumber(text: string): string {
  return compactText(text.match(/(?:№|N[°o.]?)\s*([\d-]{3,})/i)?.[1] || "");
}

export function rowMatchKey(text: string): string {
  return extractOzonVisiblePointNumber(text) || pickupMatchTokens(text).values().next().value || compactText(text).slice(0, 80);
}

export function pickupRowName(text: string): string {
  const cleaned = compactText(
    text.replace(
      /(?:^|[\s,;|•-])(?:Add|Saved|Refresh PVZ|Show in panel|Добавить|Сохранено|Обновить ПВЗ|Показать в панели|Удалить|Редактировать|Изменить|Edit|Delete|Remove)(?=$|[\s,;|•-])/giu,
      " "
    ).replace(/(?:срок\s+хранения\s+заказа|storage\s+period).*$/i, " ")
  );
  return cleaned.length > 170 ? `${cleaned.slice(0, 167)}...` : cleaned;
}

export function uniqueOzonPickupCandidates(candidates: OzonPickupCandidate[]): OzonPickupCandidate[] {
  const byId = new Map<string, OzonPickupCandidate>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.externalLocationId);
    if (!existing || shouldReplaceOzonPickupCandidate(existing, candidate)) {
      byId.set(candidate.externalLocationId, candidate);
    }
  }
  return [...byId.values()];
}
