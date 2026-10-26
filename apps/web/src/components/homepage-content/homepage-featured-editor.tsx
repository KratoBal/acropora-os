"use client";

import { PilotButton, PilotCallout, Skeleton } from "@acropora/ui";
import type { ProductListItem } from "@acropora/types";
import { useEffect, useState } from "react";

import {
  homepageContentApi,
  type HomepageFeaturedProduct,
} from "@/lib/api/homepage-content";
import { productApi } from "@/lib/api/products";

import { HOMEPAGE_INPUT_CLASS } from "./homepage-fields";

/** The band shows at most this many (commerce #555; the server checks it too). */
export const FEATURED_MAX = 12;

const price = (gross: string | null) =>
  gross
    ? `${Number(gross).toLocaleString("hu-HU", { maximumFractionDigits: 0 })} Ft`
    : null;

/**
 * "EGYEDI KORALLOK" (Balázs's brief, 4. pont; Figma 685:535): the products of
 * the band, at most twelve, the first is the large card. Search and add,
 * remove, and reorder by dragging or with the arrow keys on the handle.
 *
 * EVERY CHANGE IS STORED AT ONCE, like the marker on the product page: the band
 * is its own list on the server (`HomepageFeaturedProduct`), not part of the
 * page's "Mentés". The name, image and price come from the product itself.
 */
export function HomepageFeaturedEditor({
  token,
  onProjection,
}: {
  token: string;
  /** What happened to the shop after a change, in the page's own words. */
  onProjection: (projection: "off" | "sent" | "unchanged" | "failed") => void;
}) {
  const [list, setList] = useState<HomepageFeaturedProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<ProductListItem[]>([]);
  const [dragged, setDragged] = useState<number | null>(null);

  const load = (signal?: AbortSignal) =>
    homepageContentApi
      .featured(token, signal)
      .then(setList)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setList([]);
        setError(
          cause instanceof Error ? cause.message : "A lista nem tölthető be.",
        );
      });

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (search.trim().length < 2) {
      setHits([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void productApi
        .list(token, { search: search.trim(), pageSize: 8 })
        .then((answer) => {
          if (active) setHits(answer.items);
        })
        .catch(() => {
          if (active) setHits([]);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [token, search]);

  const run = async (
    change: () => Promise<{
      list: HomepageFeaturedProduct[];
      projection: "off" | "sent" | "unchanged" | "failed";
    }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await change();
      setList(result.list);
      onProjection(result.projection);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A változtatás nem sikerült.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const move = (from: number, to: number) => {
    if (!list || to < 0 || to >= list.length || from === to) return;
    const ids = list.map((p) => p.productId);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved as string);
    void run(() => homepageContentApi.orderFeatured(token, ids));
  };

  if (list === null) return <Skeleton className="h-24" />;
  const marked = new Set(list.map((p) => p.productId));
  return (
    <div className="space-y-4">
      <p className="text-sm text-pilot-grey-600">
        Legfeljebb {FEATURED_MAX} termék; az első a „Nagy kártya”. A változás
        azonnal mentődik.
      </p>
      {error ? (
        <PilotCallout
          tone="warm"
          title="A változtatás nem sikerült"
          description={error}
        />
      ) : null}
      {list.length === 0 ? (
        <PilotCallout
          tone="aqua"
          title="Nincs kijelölt termék."
          description="Keress rá egy termékre lent, és add hozzá."
        />
      ) : (
        <ol aria-label="Egyedi korallok sorrendje" className="space-y-2">
          {list.map((product, index) => (
            <li
              key={product.productId}
              onDragOver={(event) => {
                if (dragged !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null) move(dragged, index);
                setDragged(null);
              }}
              className="flex items-center gap-3 rounded-lg bg-pilot-grey-50 p-3 text-sm ring-1 ring-pilot-grey-200"
            >
              <button
                type="button"
                draggable
                disabled={busy}
                onDragStart={() => setDragged(index)}
                onDragEnd={() => setDragged(null)}
                aria-label={`${product.name} áthelyezése (fel és le nyíl)`}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    move(index, index - 1);
                  } else if (event.key === "ArrowDown") {
                    event.preventDefault();
                    move(index, index + 1);
                  }
                }}
                className="cursor-grab px-1 text-pilot-grey-400"
              >
                ⋮⋮
              </button>
              <span className="w-6 font-semibold text-pilot-aqua-700">
                {index + 1}.
              </span>
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  className="size-10 rounded object-cover"
                />
              ) : (
                <span className="size-10 rounded bg-pilot-grey-100" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-pilot-grey-900">
                  {product.name}
                </span>
                <span className="block text-xs text-pilot-grey-500">
                  {[
                    index === 0 ? "Nagy kártya" : null,
                    price(product.grossPrice),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <PilotButton
                variant="ghost"
                disabled={busy}
                aria-label={`${product.name} eltávolítása`}
                onClick={() =>
                  void run(() =>
                    homepageContentApi.setFeatured(
                      token,
                      product.productId,
                      false,
                    ),
                  )
                }
              >
                Eltávolítás
              </PilotButton>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <input
          aria-label="Termék keresése az Egyedi korallokhoz"
          placeholder="Termék neve vagy cikkszáma"
          value={search}
          disabled={list.length >= FEATURED_MAX}
          onChange={(event) => setSearch(event.target.value)}
          className={HOMEPAGE_INPUT_CLASS}
        />
        {list.length >= FEATURED_MAX ? (
          <p className="text-xs text-pilot-grey-500">
            Elérted a {FEATURED_MAX} terméket; új termékhez előbb távolíts el
            egyet.
          </p>
        ) : null}
        <ul className="space-y-1">
          {hits
            .filter((hit) => !marked.has(hit.id))
            .map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  disabled={busy || list.length >= FEATURED_MAX}
                  onClick={() => {
                    setSearch("");
                    void run(() =>
                      homepageContentApi.setFeatured(token, hit.id, true),
                    );
                  }}
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-pilot-grey-50"
                >
                  {hit.name}
                  {hit.primarySku ? (
                    <span className="ml-2 text-xs text-pilot-grey-500">
                      {hit.primarySku}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
