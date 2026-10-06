"use client";

import {
  ASSET_EXPORT_HEADERS,
  assetExportCells,
  hasPermission,
  PERMISSIONS,
  type AssetListItem,
} from "@acropora/types";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { assetCategoriesApi } from "@/lib/api/asset-categories";
import { assetsApi } from "@/lib/api/assets";

import { assetExportQuery, assetFilterSummary } from "./asset-list-export";

/**
 * AZ ESZKÖZLISTA NYOMTATÓBARÁT NÉZETE (kártya 323e9b38). A lista szűrői
 * után álló TELJES halmaz, nem képernyőkép: fejléc a szűrők leírásával és
 * a dátummal, A4 fekvő lap, ismétlődő táblafejléc. A menü és Sutyerák nincs
 * rajta (a shell-en kívüli útvonal), a gombsor nyomtatáskor eltűnik.
 */
export function AssetListPrintPage() {
  const { session } = useAuth();
  const params = useSearchParams();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const query = useMemo(
    () => assetExportQuery(new URLSearchParams(params.toString())),
    [params],
  );
  const [items, setItems] = useState<AssetListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const printed = useRef(false);
  const printedAt = useMemo(
    () =>
      new Intl.DateTimeFormat("hu-HU", {
        timeZone: "Europe/Budapest",
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date()),
    [],
  );

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    assetsApi
      .exportItems(token, query, controller.signal)
      .then((response) => setItems(response.items))
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Az eszközlista nem tölthető be.",
          );
      });
    // a fejléc kategória-neve; a hiánya nem tartja vissza a listát
    assetCategoriesApi
      .list(token, true, controller.signal)
      .then((response) =>
        setCategories(
          new Map(
            response.items.map((category) => [category.id, category.name]),
          ),
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [canView, query, token]);

  // a lap betöltés után egyszer magától nyomtat; a gomb utána is ott van
  useEffect(() => {
    if (!items || printed.current) return;
    printed.current = true;
    if (typeof window.print === "function") window.print();
  }, [items]);

  const summary = assetFilterSummary(query, {
    categoryName: (id) => categories.get(id),
    ownerName: items?.[0]?.owner.displayName,
  });

  if (!canView)
    return (
      <p className="p-6 text-sm">Az eszközlista nyomtatásához nincs jogod.</p>
    );

  return (
    <main className="asset-print bg-white p-6 text-[11px] text-black">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          .asset-print { padding: 0; }
          .asset-print-actions { display: none; }
          .asset-print thead { display: table-header-group; }
          .asset-print tr { break-inside: avoid; }
        }
      `}</style>
      <header className="mb-3 border-b border-black pb-2">
        <h1 className="text-base font-semibold">Eszközlista</h1>
        <p>Nyomtatva: {printedAt}</p>
        <ul data-testid="asset-print-filters">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {items ? (
          <p className="font-medium" data-testid="asset-print-count">
            {items.length} eszköz
          </p>
        ) : null}
      </header>
      <div className="asset-print-actions mb-3 flex gap-2">
        <button
          type="button"
          className="rounded border border-black px-3 py-1"
          onClick={() => window.print()}
          disabled={!items}
        >
          Nyomtatás
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : !items ? (
        <p>Az eszközlista betöltése…</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {ASSET_EXPORT_HEADERS.map((header) => (
                <th
                  key={header}
                  className="border border-black px-1 py-0.5 text-left align-bottom"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {assetExportCells(item).map((cell, index) => (
                  <td
                    key={ASSET_EXPORT_HEADERS[index]}
                    className="border border-black px-1 py-0.5 align-top"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
