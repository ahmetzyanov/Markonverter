import { extractOzonPickupCandidatesFromSources, OzonCaptureSource } from "../marketplaces/ozon/pickup-capture";

const COLLECT_EVENT = "markonverter:collect-ozon-pickup";
const CANDIDATES_EVENT = "markonverter:ozon-pickup-candidates";
const NETWORK_FIXTURE_EVENT = "markonverter:ozon-network-fixture";
const MAX_NETWORK_FIXTURE_TEXT_LENGTH = 2_000_000;

install();

function install(): void {
  document.addEventListener(COLLECT_EVENT, () => emitCandidates(collectSources("manual")));
  window.addEventListener("load", () => emitCandidates(collectSources("load")));
  queueMicrotask(() => emitCandidates(collectSources("initial")));
  patchFetch();
  patchXhr();
}

function emitCandidates(sources: OzonCaptureSource[]): void {
  const candidates = extractOzonPickupCandidatesFromSources(sources);
  if (candidates.length === 0) {
    return;
  }
  document.dispatchEvent(
    new CustomEvent(CANDIDATES_EVENT, {
      detail: JSON.stringify(candidates.slice(0, 20))
    })
  );
}

function collectSources(reason: string): OzonCaptureSource[] {
  const sources: OzonCaptureSource[] = [];
  const urlHint = location.href;

  collectStorage("localStorage", localStorage, sources, urlHint);
  collectStorage("sessionStorage", sessionStorage, sources, urlHint);

  if (document.cookie) {
    sources.push({ source: `cookie.${reason}`, value: document.cookie, urlHint });
  }

  for (const key of ["__NUXT__", "__NEXT_DATA__", "__INITIAL_STATE__", "__APOLLO_STATE__", "__PRELOADED_STATE__"]) {
    const value = (window as unknown as Record<string, unknown>)[key];
    if (value) {
      sources.push({ source: `window.${key}`, value, urlHint });
    }
  }

  const deliveryText = collectDeliveryText();
  if (deliveryText) {
    sources.push({ source: `dom.${reason}`, value: deliveryText, textHint: deliveryText, urlHint });
  }

  return sources;
}

function collectStorage(name: string, storage: Storage, sources: OzonCaptureSource[], urlHint: string): void {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !/(ozon|delivery|address|pickup|pvz|location|geo|city|region)/i.test(key)) {
        continue;
      }
      const value = storage.getItem(key);
      if (value) {
        sources.push({ source: `${name}.${key}`, value, urlHint });
      }
    }
  } catch {
    // Some browser privacy modes can deny storage access.
  }
}

function collectDeliveryText(): string {
  const selectors = [
    '[data-widget*="address" i]',
    '[data-widget*="delivery" i]',
    '[data-widget*="geo" i]',
    '[data-widget*="user" i]',
    '[href*="delivery" i]',
    "button",
    "a"
  ];
  const chunks: string[] = [];
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const text = element.innerText || element.textContent || "";
      if (/(достав|получ|пункт|пвз|адрес|город|pickup|delivery|address)/i.test(text)) {
        chunks.push(text);
      }
    });
  }
  return chunks.slice(0, 30).join(" | ").slice(0, 8000);
}

function patchFetch(): void {
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const request = fetchRequest(args[0], args[1]);
    inspectResponse({ ...request, source: "fetch" }, response.clone());
    return response;
  };
}

function patchXhr(): void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
    const xhr = this as XMLHttpRequest & { markonverterMethod?: string; markonverterUrl?: string; markonverterRequestBody?: string };
    xhr.markonverterMethod = method;
    xhr.markonverterUrl = String(url);
    const forwardOpen = originalOpen as unknown as (this: XMLHttpRequest, ...args: unknown[]) => void;
    return forwardOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function send(...args: unknown[]) {
    const xhr = this as XMLHttpRequest & { markonverterMethod?: string; markonverterUrl?: string; markonverterRequestBody?: string };
    xhr.markonverterRequestBody = requestBodyText(args[0]);
    this.addEventListener("loadend", () => {
      if (!isRelevantUrl(xhr.markonverterUrl || "")) {
        return;
      }
      inspectPayload(
        {
          source: "xhr",
          method: xhr.markonverterMethod || "GET",
          url: xhr.markonverterUrl || "xhr",
          status: xhr.status,
          contentType: xhr.getResponseHeader("content-type") || "",
          requestBody: xhr.markonverterRequestBody
        },
        xhr.responseText
      );
    });
    return originalSend.call(this, ...(args as [Document | XMLHttpRequestBodyInit | null | undefined]));
  };
}

function inspectResponse(request: NetworkFixtureMeta, response: Response): void {
  if (!isRelevantUrl(request.url)) {
    return;
  }
  response
    .text()
    .then((text) =>
      inspectPayload(
        {
          ...request,
          status: response.status,
          contentType: response.headers.get("content-type") || ""
        },
        text
      )
    )
    .catch(() => undefined);
}

interface NetworkFixtureMeta {
  source: "fetch" | "xhr";
  method: string;
  url: string;
  status?: number;
  contentType?: string;
  requestBody?: string;
}

function inspectPayload(meta: NetworkFixtureMeta, text: string): void {
  if (!text) {
    return;
  }
  const capturedText = text.slice(0, MAX_NETWORK_FIXTURE_TEXT_LENGTH);
  emitCandidates([
    {
      source: `network.${meta.url}`,
      value: capturedText,
      urlHint: location.href,
      textHint: collectDeliveryText()
    }
  ]);
  emitNetworkFixture(meta, capturedText, text.length);
}

function emitNetworkFixture(meta: NetworkFixtureMeta, responseText: string, responseLength: number): void {
  if (!isRelevantUrl(meta.url)) {
    return;
  }
  document.dispatchEvent(
    new CustomEvent(NETWORK_FIXTURE_EVENT, {
      detail: JSON.stringify({
        source: meta.source,
        method: meta.method,
        url: absoluteUrl(meta.url),
        status: meta.status,
        contentType: meta.contentType,
        pageUrl: location.href,
        requestBody: meta.requestBody,
        responseText,
        responseLength
      })
    })
  );
}

function fetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function fetchRequest(input: RequestInfo | URL, init?: RequestInit): NetworkFixtureMeta {
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  return {
    source: "fetch",
    method,
    url: fetchUrl(input),
    requestBody: requestBodyText(init?.body)
  };
}

function requestBodyText(body: unknown): string | undefined {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Blob) {
    return `[Blob ${body.type || "application/octet-stream"} ${body.size} bytes]`;
  }
  if (body instanceof FormData) {
    return "[FormData]";
  }
  if (body instanceof ArrayBuffer) {
    return `[ArrayBuffer ${body.byteLength} bytes]`;
  }
  return undefined;
}

function absoluteUrl(url: string): string {
  try {
    return new URL(url, location.href).toString();
  } catch {
    return url;
  }
}

function isRelevantUrl(url: string): boolean {
  return /(composer-api|entrypoint-api|delivery|address|location|geo|pvz|pickup)/i.test(url);
}
