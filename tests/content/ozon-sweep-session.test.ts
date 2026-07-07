import { afterEach, beforeEach, vi } from "vitest";

import {
  isOzonPickupActivationDoomed,
  isOzonSweepThrottled,
  markOzonPickupActivationDoomed,
  markOzonSweepThrottled
} from "../../src/content/ozon-sweep-session";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    }
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", createMemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Ozon sweep session: doomed pickup points", () => {
  it("is not doomed until marked", () => {
    expect(isOzonPickupActivationDoomed("daa6eeff-8093-429a-9fee-9c73e5ef6036")).toBe(false);
  });

  it("remembers a doomed pickup point for the rest of the tab session", () => {
    markOzonPickupActivationDoomed("daa6eeff-8093-429a-9fee-9c73e5ef6036");
    expect(isOzonPickupActivationDoomed("daa6eeff-8093-429a-9fee-9c73e5ef6036")).toBe(true);
    // Session state is not per-product: a structural id-space mismatch is the
    // same regardless of which product page discovered it.
    expect(isOzonPickupActivationDoomed("other-point-id")).toBe(false);
  });
});

describe("Ozon sweep session: 403 throttle backoff", () => {
  it("is not throttled until a 403 is observed", () => {
    expect(isOzonSweepThrottled()).toBe(false);
  });

  it("backs off for a bounded window after Ozon returns HTTP 403", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    markOzonSweepThrottled();
    expect(isOzonSweepThrottled()).toBe(true);

    vi.setSystemTime(30_000);
    expect(isOzonSweepThrottled()).toBe(true);

    vi.setSystemTime(90_000);
    expect(isOzonSweepThrottled()).toBe(false);
  });
});
