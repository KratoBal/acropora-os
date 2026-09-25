"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Icon,
  Pagination,
  PilotBadge,
  PilotThemeRoot,
  pilotBadgeVariantForTone,
} from "@acropora/ui";
import {
  assetStatusLabel,
  assetStatusTone,
  type AssetListResponse,
} from "@acropora/types";

import { eszkozAzonosito } from "@/lib/eszkoz-azonosito";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";

/**
 * AZ ESZKÖZLISTA -- FIGMA 9. KÖR (Partner Portál), a Make-terv
 * `PartnerPortalScreen.tsx:803-890` átültetése.
 *
 * VIZUÁLIS VÁLTÁS A KORÁBBI KÖRHÖZ KÉPEST: az előző kör a belső, violet
 * `ServiceListHeader`/`ServiceListTabs`/`ServiceSearchField`/
 * `ServiceStatusBadge`/`ServiceListFooter`/`StatCard` keretet vette át
 * (Balázs 2026-09-24-i kérése, hogy a portál az app.acropora.hu-hoz
 * hasonlítson) -- a mostani Figma-kör a portál egészét pilot-aqua design-
 * rendszerre viszi, ez a lap a hibajegy-listával (#1117) egyező mintát
 * követi.
 *
 * A SZŰRŐ-LOGIKA VÁLTOZATLAN: a "Beépített" alapértelmezett fül jelentése
 * MINDEN státusz, KIVÉVE Kivezetett (nem hierarchia-fogalom, lásd a Make-terv
 * saját `tab === 'Beépített' ? d.allapot !== 'Kivezetett'` sorát, 813. sor)
 * -- a valódi szűrést a szerver végzi (`status` paraméter), ez a fájl csak a
 * FÜL-ÉRTÉKET adja tovább, változatlanul.
 *
 * A "HIERARCHIA" OSZLOP MIND A HÁROM ÁGA MEGMARAD (Része: X / N részegység /
 * Önálló eszköz) -- a Make-terv demo-adata csak az egyiket mutatja be
 * (876. sor, mindig "Önálló eszköz"), de ez a prototípus tömörsége, nem
 * szándékos leegyszerűsítés.
 *
 * A FEJLÉC LEÍRÁS-MONDATA MEGMARAD ("A cégéhez tartozó eszközök.
 * Kattintson egy eszközre az adatlapjáért.") -- a Make-terv fejléce ezt nem
 * mutatja (824-829. sor: csak eyebrow + cím), de ez a prototípus tömörsége,
 * nem szándékos elhagyás.
 *
 * A STATISZTIKA-CSEMPÉK IKONJAI KÖZELÍTÉSEK: a Make-terv `CubeIcon`/
 * `WrenchIcon`/`CheckIcon`-t használ, a közös `Icon` készletben ("package",
 * "service", "activity") nincs pontos megfelelőjük -- ez díszítő elem, nem
 * adatot hordozó jelölés, ezért a közelítés nem "kitalált mező".
 */

const TABS = [
  { key: "ALL", label: "Összes" },
  { key: "IN_PLACE", label: "Beépített" },
  { key: "ACTIVE", label: "Aktív" },
  { key: "IN_REPAIR", label: "Javítás alatt" },
  { key: "WARM_STANDBY", label: "Meleg tartalék" },
  { key: "COLD_STANDBY", label: "Hideg tartalék" },
  { key: "RETIRED", label: "Kivezetett" },
] as const;

const PAGE_SIZE = 25;

/**
 * AZ "ÚJ ESZKÖZ" GOMB EBBEN A KÖRBEN NEM JELENIK MEG.
 *
 * A feladat kéri ("csak ott, ahol a jogosultsága engedi"), DE a portálon ma
 * NINCS eszköz-felviteli űrlap (`/eszkozok/uj` nem létező útvonal), és ennek
 * megépítése önálló feladat, nem a meglévő lapok kinézetének igazítása. Egy
 * gomb, ami egy nem létező oldalra mutatna, rosszabb a hiányánál. Ha a
 * felvitel elkészül, ide egy `hasPermission(user, PERMISSIONS.SERVICE_MANAGE)`
 * feltétel és egy `Link href="/eszkozok/uj"` kerül vissza, a `ServiceListHeader`
 * `action` prop-jába, a belső lista "Új eszköz" gombjának mintájára.
 */
export function AssetList() {
  const { user } = useAuth();
  const [data, setData] = useState<AssetListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [helyszin, setHelyszin] = useState("");
  const [status, setStatus] = useState("IN_PLACE");
  const [page, setPage] = useState(1);
  const [helyszinek, setHelyszinek] = useState<
    { id: string; name: string; code: string }[]
  >([]);

  useEffect(() => {
    if (!user?.customerId) return;
    void partnerApi
      .departments(user.customerId)
      .then((valasz) => setHelyszinek(valasz.items))
      .catch(() => setHelyszinek([]));
  }, [user?.customerId]);

  const load = useCallback(() => {
    if (!user?.customerId) return;
    void partnerApi
      .assets({
        ...(helyszin ? { departmentId: helyszin } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        status,
        page,
        pageSize: PAGE_SIZE,
      })
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az eszközök nem tölthetők be.",
        ),
      );
  }, [user?.customerId, helyszin, search, status, page]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  /* MINDEN SZŰRŐ-VÁLTOZÁS AZ ELSŐ OLDALRA VISZ -- ugyanaz az indok, mint a
     belső listánál: egy más szűrőn a régi oldalszám gyakran nem is létezik. */
  const selectStatus = (key: string) => {
    setStatus(key === status ? "ALL" : key);
    setPage(1);
  };
  const selectHelyszin = (value: string) => {
    setHelyszin(value);
    setPage(1);
  };
  const selectSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const counts = data?.counts ?? null;
  const total = counts
    ? Object.values(counts).reduce((sum, value) => sum + value, 0)
    : null;

  const tiles = useMemo(
    () =>
      [
        {
          key: "ALL",
          label: "Nyilvántartott eszköz",
          value: total,
          icon: "package",
        },
        {
          key: "IN_REPAIR",
          label: "Javítás alatt",
          value: counts?.IN_REPAIR ?? null,
          icon: "service",
        },
        {
          key: "ACTIVE",
          label: "Aktívan üzemel",
          value: counts?.ACTIVE ?? null,
          icon: "activity",
        },
      ] as const,
    [counts, total],
  );

  return (
    <PilotThemeRoot className="flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          Saját adatok
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">Eszközök</h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          A cégéhez tartozó eszközök. Kattintson egy eszközre az adatlapjáért.
        </p>
      </div>

      {error ? (
        <div className="px-8 py-4">
          <p
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}{" "}
            <button
              type="button"
              className="cursor-pointer font-medium underline"
              onClick={load}
            >
              Újrapróbálás
            </button>
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 border-b border-pilot-grey-100 bg-pilot-grey-50 px-8 py-5 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="flex items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-pilot-grey-200"
          >
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                tile.key === "IN_REPAIR"
                  ? "bg-pilot-amber-50 text-pilot-amber-600"
                  : "bg-pilot-aqua-50 text-pilot-aqua-600"
              }`}
            >
              <Icon name={tile.icon} size={16} />
            </div>
            <div>
              <p className="text-lg font-semibold text-pilot-grey-900">
                {tile.value === null ? "—" : tile.value}
              </p>
              <p className="text-xs text-pilot-grey-400">{tile.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-b border-pilot-grey-100 bg-white px-8 py-4">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectStatus(tab.key)}
              className={`cursor-pointer whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-all ${
                status === tab.key
                  ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                  : "text-pilot-grey-500 hover:bg-pilot-grey-50 hover:text-pilot-grey-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
            />
            <input
              type="text"
              aria-label="Eszköz keresése"
              placeholder="Név, eszközszám, gyártó, modell, sorozatszám"
              value={search}
              onChange={(event) => selectSearch(event.target.value)}
              className="w-full rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
            />
          </div>
          <label>
            <span className="sr-only">Helyszín</span>
            <select
              value={helyszin}
              onChange={(event) => selectHelyszin(event.target.value)}
              className="cursor-pointer rounded-md py-1.5 pl-3 pr-8 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
            >
              <option value="">Minden helyszín</option>
              {helyszinek.map((egyseg) => (
                <option key={egyseg.id} value={egyseg.id}>
                  {egyseg.name}
                </option>
              ))}
            </select>
          </label>
          {data ? (
            <Pagination
              position="top"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </div>
      </div>

      {!data && !error ? (
        <p className="px-8 py-6 text-sm text-pilot-grey-400">
          Eszközök betöltése…
        </p>
      ) : null}

      {data?.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="package" size={24} className="text-pilot-aqua-600" />
          </div>
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs megjeleníthető eszköz
          </p>
          <p className="max-w-xs text-sm text-pilot-grey-400">
            A partneri fiókhoz jelenleg nincs eszköz rögzítve, vagy a szűrők nem
            adnak találatot.
          </p>
        </div>
      ) : null}

      {data?.items.length ? (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100">
                {[
                  "Eszköz",
                  "Elhelyezés",
                  "Hierarchia",
                  "Kategória",
                  "Műszaki azonosító",
                  "Státusz",
                ].map((head) => (
                  <th
                    key={head}
                    className="whitespace-nowrap bg-white px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((asset, index) => (
                <tr
                  key={asset.id}
                  className={`border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                    index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                  }`}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/eszkozok/${asset.id}`}
                      className="font-medium text-pilot-grey-900 hover:text-pilot-aqua-700"
                    >
                      {asset.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                      {eszkozAzonosito(asset)}
                    </p>
                    {asset.partnerInternalCode ? (
                      <p className="mt-0.5 text-xs text-pilot-grey-400">
                        Partner belső kódja:{" "}
                        <span className="font-mono">
                          {asset.partnerInternalCode}
                        </span>
                      </p>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-500">
                    {asset.unit
                      ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                      : (asset.address?.formatted ?? "Nincs pontosítva.")}
                  </td>
                  <td className="px-5 py-3 text-xs text-pilot-grey-600">
                    {asset.parent ? (
                      <span>
                        Része: <strong>{asset.parent.name}</strong>
                      </span>
                    ) : asset.childCount ? (
                      `${asset.childCount} részegység`
                    ) : (
                      "Önálló eszköz"
                    )}
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-600">
                    {asset.category ?? "—"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-pilot-grey-500">
                    {[asset.manufacturer, asset.model, asset.serialNumber]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-5 py-3">
                    <PilotBadge
                      variant={pilotBadgeVariantForTone(
                        assetStatusTone[asset.status],
                      )}
                    >
                      {assetStatusLabel[asset.status]}
                    </PilotBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-pilot-grey-100 bg-white px-5 py-3 text-xs text-pilot-grey-400">
            {data.pagination.totalItems} eszköz összesen
          </div>
          <div className="flex justify-end border-t border-pilot-grey-100 bg-white px-4 py-2">
            <Pagination
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
