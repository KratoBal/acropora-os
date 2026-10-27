"use client";

import { PilotButton, PilotCallout } from "@acropora/ui";
import type { BrandSummary, HomepageBrand } from "@acropora/types";
import { useEffect, useState } from "react";

import { brandsApi } from "@/lib/api/brands";

import { HOMEPAGE_INPUT_CLASS } from "./homepage-fields";

/**
 * "MÁRKÁK" (Balázs, 2026-10-27): the brands of the home page's logo strip, any
 * number of them, in order. Search and add, remove, and reorder by dragging or
 * with the arrow keys on the handle.
 *
 * PART OF THE PAGE'S "MENTÉS", unlike the "Egyedi korallok" band: the list is a
 * field of the home page record, like the block order. `null` means the list
 * was never set: the shop keeps its row of names, and the save does not send a
 * list at all until somebody adds a brand here.
 *
 * A brand that is switched off or archived keeps its place, greyed, and is
 * left out of the strip until it is switched on again: it has no shop page.
 * The logo is the brand's own (`Brand.logoUrl`, edited on the brand's page).
 */
export function HomepageBrandsEditor({
  token,
  brands,
  onChange,
}: {
  token: string;
  brands: HomepageBrand[] | null;
  onChange: (brands: HomepageBrand[]) => void;
}) {
  const list = brands ?? [];
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<BrandSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);

  useEffect(() => {
    if (search.trim().length < 2) {
      setHits([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        search: search.trim(),
        status: "ACTIVE",
        pageSize: "10",
      });
      void brandsApi
        .list(token, query)
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

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved as HomepageBrand);
    onChange(next);
  };

  /** The logo is on the brand's detail, not in the search hit: one read per add. */
  const add = async (hit: BrandSummary) => {
    setSearch("");
    setError(null);
    try {
      const detail = await brandsApi.detail(token, hit.id);
      onChange([
        ...list,
        {
          id: detail.id,
          name: detail.name,
          slug: detail.slug,
          logoUrl: detail.logoUrl ?? null,
          shown: detail.isActive && !detail.archivedAt,
        },
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A márka nem tölthető be.",
      );
    }
  };

  const listed = new Set(list.map((b) => b.id));
  return (
    <div className="space-y-4">
      <p className="text-sm text-pilot-grey-600">
        A kirakat lassan gördülő logósávja: fekete-fehér, egér alatt színes, a
        márka oldalára visz. Csak termékkel rendelkező márka jelenik meg. A
        változás a „Mentés” gombbal kerül a webshopba.
      </p>
      {error ? (
        <PilotCallout
          tone="warm"
          title="A márka nem adható hozzá"
          description={error}
        />
      ) : null}
      {list.length === 0 ? (
        <PilotCallout
          tone="aqua"
          title="Nincs kijelölt márka."
          description="Amíg nincs, a kirakat a lenti márkaneveket mutatja. Keress rá egy márkára, és add hozzá."
        />
      ) : (
        <ol aria-label="Márkák sorrendje" className="space-y-2">
          {list.map((brand, index) => (
            <li
              key={brand.id}
              onDragOver={(event) => {
                if (dragged !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged !== null) move(dragged, index);
                setDragged(null);
              }}
              className={`flex items-center gap-3 rounded-lg bg-pilot-grey-50 p-3 text-sm ring-1 ring-pilot-grey-200 ${brand.shown ? "" : "opacity-60"}`}
            >
              <button
                type="button"
                draggable
                onDragStart={() => setDragged(index)}
                onDragEnd={() => setDragged(null)}
                aria-label={`${brand.name} áthelyezése (fel és le nyíl)`}
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
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt=""
                  className="h-8 w-16 object-contain"
                />
              ) : (
                <span className="h-8 w-16 rounded bg-pilot-grey-100" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-pilot-grey-900">
                  {brand.name}
                </span>
                <span className="block text-xs text-pilot-grey-500">
                  {[
                    brand.logoUrl ? null : "Nincs logó: a neve látszik",
                    brand.shown
                      ? null
                      : "Kikapcsolt márka: a sávban nem jelenik meg",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <PilotButton
                variant="ghost"
                aria-label={`${brand.name} eltávolítása`}
                onClick={() => onChange(list.filter((b) => b.id !== brand.id))}
              >
                Eltávolítás
              </PilotButton>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <input
          aria-label="Márka keresése a logósávhoz"
          placeholder="Márka neve"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={HOMEPAGE_INPUT_CLASS}
        />
        <ul className="space-y-1">
          {hits
            .filter((hit) => !listed.has(hit.id))
            .map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => void add(hit)}
                  className="w-full rounded px-2 py-1 text-left text-sm hover:bg-pilot-grey-50"
                >
                  {hit.name}
                  <span className="ml-2 text-xs text-pilot-grey-500">
                    {hit.usage.productCount} termék
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
