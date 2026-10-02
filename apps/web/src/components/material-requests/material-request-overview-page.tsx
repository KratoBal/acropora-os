"use client";

import type {
  MaterialRequestStatusCounts,
  MaterialRequestSummary,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotButton,
  PilotInput,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { ApiError } from "@/lib/api/client";
import { materialRequestsApi } from "@/lib/api/material-requests";

import {
  MaterialRequestDetail,
  useLiveRefresh,
} from "./material-request-detail";
import {
  RequestCard,
  RequestPill,
  StatusMetrics,
} from "./material-request-parts";
import {
  EMPTY_MESSAGE,
  OVERVIEW_FILTERS,
  OVERVIEW_FILTER_LABEL,
  filterQuery,
  type OverviewFilter,
} from "./material-request-v2-presentation";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      items: MaterialRequestSummary[];
      nextCursor: string | null;
    };

/**
 * ANYAGIGÉNYEK, V2 ÁTTEKINTŐ (Figma 404:16).
 *
 * The status cards, the filters and the search all come from the server,
 * scoped to the worksheets the caller can see; the browser never downloads
 * the whole history to count or filter it. A failed read is an error, never
 * an empty list. The selected request opens on the right on wide screens,
 * as its own page on narrow ones.
 *
 * Left out on purpose (owner, 2026-10-02): "Új anyagigény" (a request starts
 * only on a worksheet), "Szűrők" and "További műveletek" (no content yet),
 * and the Figma's "JAVASOLT V2" design note.
 */
export function MaterialRequestOverviewPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const hasSession = Boolean(session);
  const router = useRouter();
  const [filter, setFilter] = useState<OverviewFilter>("active");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [counts, setCounts] = useState<MaterialRequestStatusCounts | null>(
    null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const generation = useRef(0);

  // the search goes to the server after a short pause, not per keystroke
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (!hasSession) return;
    const mine = ++generation.current;
    setNow(new Date());
    const [page, summary] = await Promise.allSettled([
      materialRequestsApi.overview(token, {
        ...filterQuery(filter),
        q: query || undefined,
      }),
      materialRequestsApi.summary(token),
    ]);
    if (mine !== generation.current) return; // a newer filter answered first
    if (page.status === "fulfilled")
      setList({
        kind: "ready",
        items: page.value.items,
        nextCursor: page.value.nextCursor,
      });
    else
      setList({
        kind: "error",
        message:
          page.reason instanceof ApiError && page.reason.status === 403
            ? "Az anyagigények áttekintője belsős kollégáknak érhető el."
            : "Az anyagigények jelenleg nem tölthetők be.",
      });
    setCounts(summary.status === "fulfilled" ? summary.value : null);
    // `token` is read, not watched: the session object changes identity
  }, [hasSession, filter, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setList({ kind: "loading" });
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  const loadMore = async () => {
    if (list.kind !== "ready" || !list.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await materialRequestsApi.overview(token, {
        ...filterQuery(filter),
        q: query || undefined,
        cursor: list.nextCursor,
      });
      setList({
        kind: "ready",
        items: [...list.items, ...page.items],
        nextCursor: page.nextCursor,
      });
    } catch {
      setList({
        kind: "error",
        message: "A további anyagigények nem tölthetők be.",
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const open = (id: string) => {
    if (window.matchMedia("(min-width: 1024px)").matches) setSelected(id);
    else router.push(`/szerviz/anyagigenyek/${encodeURIComponent(id)}`);
  };

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-4 py-5 sm:px-8">
        <p className="mb-1 text-xs text-pilot-grey-400">
          Szerviz / Anyagigények
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Anyagigények
        </h1>
        <p className="text-xs text-pilot-grey-500">
          Áttekintés és beszerzési állapotok
        </p>
      </div>
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4 px-4 py-6 sm:px-8">
        <StatusMetrics counts={counts} />
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-pilot-grey-200 bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <div
            role="group"
            aria-label="Szűrés"
            className="flex flex-wrap gap-2"
          >
            {OVERVIEW_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => {
                  setFilter(option);
                  setSelected(null);
                }}
                className="rounded-full"
              >
                <RequestPill tone={filter === option ? "accent" : "neutral"}>
                  {OVERVIEW_FILTER_LABEL[option]}
                </RequestPill>
              </button>
            ))}
          </div>
          <PilotInput
            aria-label="Keresés"
            placeholder="Keresés: munkalap, ügyfél, tétel…"
            value={search}
            onChange={setSearch}
            className="min-w-[220px] flex-1"
          />
        </div>
        <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_480px]">
          <div className="flex min-w-0 flex-col gap-2.5">
            {list.kind === "loading" ? (
              <div aria-busy="true" className="flex flex-col gap-2.5">
                {[0, 1, 2].map((key) => (
                  <div
                    key={key}
                    className="h-[150px] animate-pulse rounded-[12px] border border-pilot-grey-200 bg-white"
                  />
                ))}
              </div>
            ) : list.kind === "error" ? (
              <p
                role="alert"
                className="rounded-[14px] border border-pilot-red-100 bg-pilot-red-50 px-4 py-3 text-sm leading-5 text-pilot-red-700"
              >
                {list.message}
              </p>
            ) : list.items.length === 0 ? (
              <p
                role="status"
                className="rounded-[14px] border border-pilot-grey-200 bg-white px-4 py-3 text-sm leading-5 text-pilot-grey-600"
              >
                {query
                  ? "Nincs a keresésnek megfelelő anyagigény."
                  : EMPTY_MESSAGE[filter]}
              </p>
            ) : (
              <>
                {list.items.map((item) => (
                  <RequestCard
                    key={item.id}
                    request={item}
                    now={now}
                    selected={item.id === selected}
                    onSelect={() => open(item.id)}
                  />
                ))}
                {list.nextCursor ? (
                  <div>
                    <PilotButton
                      variant="secondary"
                      size="regular"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? "Betöltés…" : "Továbbiak betöltése"}
                    </PilotButton>
                  </div>
                ) : null}
              </>
            )}
          </div>
          <div className="hidden lg:block">
            {selected ? (
              <MaterialRequestDetail
                key={selected}
                id={selected}
                variant="panel"
                onChanged={() => void load()}
              />
            ) : (
              <p className="rounded-[14px] border border-dashed border-pilot-grey-300 px-4 py-6 text-center text-sm leading-5 text-pilot-grey-500">
                Válassz egy anyagigényt a listából.
              </p>
            )}
          </div>
        </div>
      </div>
    </PilotThemeRoot>
  );
}

/** Figma 404:221: the detail page, with the worksheet link in its header. */
export function MaterialRequestDetailPage({ id }: { id: string }) {
  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-4 py-5 sm:px-8">
        <p className="mb-1 text-xs text-pilot-grey-400">
          Szerviz / Anyagigények
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Anyagigény részletei
        </h1>
        <p className="text-xs text-pilot-grey-500">
          Beszerzési felelős és státuszkövetés
        </p>
      </div>
      <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8">
        <MaterialRequestDetail id={id} variant="page" />
      </div>
    </PilotThemeRoot>
  );
}
