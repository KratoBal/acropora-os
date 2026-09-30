import { useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * A `next/navigation` TESZT-DUPLÁJA OLYAN LISTÁKHOZ, AMIK AZ URL-BEN TARTJÁK AZ
 * ÁLLAPOTUKAT (`useUrlQuery`). A `replace` itt tényleg átírja a queryt, és a
 * komponens újrarajzol -- ugyanúgy, mint a böngészőben. Egy statikus dupla
 * mellett egy fül-kattintás csak egy hívást rögzítene, és a lista sosem váltana.
 *
 * Használat:
 *   vi.mock("next/navigation", async () =>
 *     (await import("@/test/url-navigation")).nextNavigationModule);
 *   beforeEach(() => urlNavigation.reset("/szerviz/karbantartas"));
 */
let pathname = "/";
let search = "";
const listeners = new Set<() => void>();
const cache = new Map<string, URLSearchParams>();

function setSearch(next: string) {
  search = next;
  for (const listener of listeners) listener();
}

export const urlNavigation = {
  replace: vi.fn((href: string) => {
    const cut = href.indexOf("?");
    setSearch(cut === -1 ? "" : href.slice(cut + 1));
  }),
  push: vi.fn(),
  /** Új teszt: útvonal és kezdő query, a hívás-napló üresen. */
  reset(nextPathname: string, initialSearch = "") {
    pathname = nextPathname;
    search = initialSearch;
    cache.clear();
    urlNavigation.replace.mockClear();
    urlNavigation.push.mockClear();
  },
  get search() {
    return search;
  },
};

function params(): URLSearchParams {
  let value = cache.get(search);
  if (!value) {
    value = new URLSearchParams(search);
    cache.set(search, value);
  }
  return value;
}

export const nextNavigationModule = {
  useRouter: () => ({
    replace: urlNavigation.replace,
    push: urlNavigation.push,
  }),
  usePathname: () => pathname,
  useSearchParams: () =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      params,
      params,
    ),
};
