"use client";

import { Icon } from "@acropora/ui";
import {
  SEARCH_GROUPS,
  type SearchResponse,
  type SearchResultItem,
} from "@acropora/types";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { searchApi } from "@/lib/api/search";

const GROUP_LABEL: Record<(typeof SEARCH_GROUPS)[number], string> = {
  tickets: "Hibajegyek",
  worksheets: "Munkalapok",
  assets: "Eszközök",
  partners: "Partnerek",
  aquariums: "Akváriumok",
};

type FlattenedResult = SearchResultItem & {
  group: (typeof SEARCH_GROUPS)[number];
};

const flatten = (response: SearchResponse): FlattenedResult[] =>
  SEARCH_GROUPS.flatMap((group) =>
    (response[group] ?? []).map((item) => ({ ...item, group })),
  );

export function GlobalSearch({ token }: { token: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const results = flatten(response);
  const ready = query.trim().length >= 2;

  useEffect(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, [pathname]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    if (!ready) {
      setResponse({});
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void searchApi
        .search(token, query.trim(), controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) {
            setResponse(next);
            setActiveIndex(-1);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setResponse({});
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, ready, token]);

  const choose = (result: FlattenedResult) => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    router.push(result.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % results.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? results.length - 1 : current - 1,
      );
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      const selected = results[activeIndex];
      if (!selected) return;
      event.preventDefault();
      choose(selected);
    }
  };

  return (
    <div ref={root} className="relative w-full">
      <label className="block w-full">
        <span className="sr-only">Keresés</span>
        <span className="flex h-10 items-center gap-2 rounded-xl bg-pilot-grey-100 px-3 text-pilot-grey-500 ring-pilot-aqua-500 transition focus-within:ring-2">
          <Icon name="search" size={17} />
          <input
            type="search"
            aria-label="Keresés"
            aria-expanded={open && ready}
            aria-controls="global-search-results"
            aria-activedescendant={
              activeIndex >= 0
                ? `global-search-result-${activeIndex}`
                : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Keresés az Acropora OS-ben…"
            className="min-w-0 flex-1 bg-transparent text-sm text-pilot-grey-900 outline-none placeholder:text-pilot-grey-500"
          />
          {loading ? <span className="text-xs">Keresés…</span> : null}
        </span>
      </label>

      {open && ready ? (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Keresési találatok"
          className="absolute left-0 right-0 top-12 z-50 max-h-[min(32rem,calc(100vh-5rem))] overflow-y-auto rounded-xl border border-pilot-grey-200 bg-pilot-white p-2 shadow-xl"
        >
          {!loading && results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-pilot-grey-600">
              Nincs találat erre: „{query.trim()}”.
            </p>
          ) : null}
          {SEARCH_GROUPS.map((group) => {
            const groupResults = response[group] ?? [];
            if (!groupResults.length) return null;
            return (
              <section key={group} className="py-1">
                <h2 className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-pilot-grey-500">
                  {GROUP_LABEL[group]}
                </h2>
                {groupResults.map((result) => {
                  const index = results.findIndex(
                    (item) => item.id === result.id && item.group === group,
                  );
                  return (
                    <button
                      key={result.id}
                      id={`global-search-result-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activeIndex === index}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose({ ...result, group })}
                      className={[
                        "block w-full rounded-lg px-3 py-2 text-left transition-colors",
                        activeIndex === index
                          ? "bg-pilot-aqua-50 text-pilot-aqua-900"
                          : "text-pilot-grey-900 hover:bg-pilot-grey-100",
                      ].join(" ")}
                    >
                      <span className="block truncate text-sm font-semibold">
                        {result.title}
                      </span>
                      <span className="block truncate text-xs text-pilot-grey-600">
                        {result.subtitle}
                      </span>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
