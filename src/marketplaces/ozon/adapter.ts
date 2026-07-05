import { ProductIdentity } from "../../shared/types";

const OZON_PRODUCT_RE = /\/product\/(?:[^/?#]+-)?(\d+)(?:[/?#]|$)/;

export function isOzonProductPage(url: URL): boolean {
  return isOzonHost(url.hostname) && OZON_PRODUCT_RE.test(url.pathname);
}

export function getOzonProductIdentity(url: URL, document: Document): ProductIdentity | null {
  const match = url.pathname.match(OZON_PRODUCT_RE);
  if (!match) {
    return null;
  }
  return {
    marketplace: "ozon",
    productId: match[1],
    url: url.toString(),
    title: document.querySelector("h1")?.textContent?.trim() || document.title || undefined
  };
}

function isOzonHost(hostname: string): boolean {
  return hostname === "ozon.ru" || hostname.endsWith(".ozon.ru") || hostname === "ozon.kz" || hostname.endsWith(".ozon.kz");
}
