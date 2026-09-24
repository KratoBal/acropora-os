"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Pagination,
  Skeleton,
  StatCard,
} from "@acropora/ui";
import { assetStatusLabel, type AssetListResponse } from "@acropora/types";

import { eszkozAzonosito } from "@/lib/eszkoz-azonosito";
import { assetStatusVariant } from "@/lib/asset-status";
import { partnerApi } from "@/lib/api";
import { useAuth } from "./auth";

/**
 * AZ ESZKÖZLISTA A BELSŐ (`app.acropora.hu`) ELRENDEZÉSÉBEN.
 *
 * Balázs kérése, 2026-09-24 07:28 UTC, verbatim: "en orulnek neki, ha
 * ugyanugy nezne ki a partner portalon pl az eszkozkezelo mint az
 * app.acropora.hu-n". Ez a lap a `card-list` alakot (`.reference-card`)
 * lecseréli táblázatra, ugyanazokkal az oszlopokkal, fülekkel és
 * állapot-cimkékkel, mint a belső `asset-list-page.tsx`.
 *
 * AMIT NEM EMELTÜNK ÁT, ÉS MIÉRT: a belső lap `sv`/`ServiceStatusBadge`/
 * `ServiceListHeader` kerete (`apps/web/src/components/service/*`) a saját
 * fejlécében kimondja, hogy SZÁNDÉKOSAN nincs a `packages/ui`-ban -- a
 * szerviz-redesign még nem az egész alkalmazásé, és a közös csomagba tett
 * változat AZONNAL felkínálná ~50, ehhez a körhöz nem tartozó lapnak. A
 * portál emellett SOHA nem hivatkozhat `apps/web`-re (lásd
 * `visual-base.spec.ts`), tehát ez a lap saját, Tailwind-osztályokkal írt
 * táblázatot használ -- UGYANAZOKKAL A TOKENEKKEL (`ink`, `muted`, `line`,
 * `brand-*`, `paper`), amiket a közös `theme.css` mostantól ide is elhoz.
 *
 * AMIT ÁTEMELTÜNK: a `assetStatusLabel` szótár (`@acropora/types`, pure
 * adat, nincs apps/web-függése), és a `Badge`/`Pagination`/`StatCard`/
 * `PageHeader`/`EmptyState`/`Alert`/`Skeleton`/`Button` a `@acropora/ui`-ból
 * -- ezek MÁR eddig is közösek voltak, függetlenül a szerviz-redesign
 * körétől.
 */

const TABS: { key: string; label: string }[] = [
  { key: "ALL", label: "Összes" },
  { key: "IN_PLACE", label: "Beépített" },
  { key: "ACTIVE", label: "Aktív" },
  { key: "IN_REPAIR", label: "Javítás alatt" },
  { key: "WARM_STANDBY", label: "Meleg tartalék" },
  { key: "COLD_STANDBY", label: "Hideg tartalék" },
  { key: "RETIRED", label: "Kivezetett" },
];

const PAGE_SIZE = 25;

/**
 * AZ "ÚJ ESZKÖZ" GOMB EBBEN A KÖRBEN NEM JELENIK MEG.
 *
 * A feladat kéri ("csak ott, ahol a jogosultsága engedi"), DE a portálon ma
 * NINCS eszköz-felviteli űrlap (`/eszkozok/uj` nem létező útvonal), és ennek
 * megépítése önálló feladat, nem a meglévő lapok kinézetének igazítása. Egy
 * gomb, ami egy nem létező oldalra mutatna, rosszabb a hiányánál. Ha a
 * felvitel elkészül, ide egy `hasPermission(user, PERMISSIONS.SERVICE_MANAGE)`
 * feltétel és egy `Link href="/eszkozok/uj"` kerül vissza, a belső lista
 * "Új eszköz" gombjának mintájára.
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
    () => [
      { key: "ALL", label: "Nyilvántartott eszköz", value: total },
      {
        key: "IN_REPAIR",
        label: "Javítás alatt",
        value: counts?.IN_REPAIR ?? null,
      },
      { key: "ACTIVE", label: "Aktívan üzemel", value: counts?.ACTIVE ?? null },
    ],
    [counts, total],
  );

  return (
    <section>
      <PageHeader
        eyebrow="Saját adatok"
        title="Eszközök"
        description="A cégéhez tartozó eszközök. Kattintson egy eszközre az adatlapjáért."
      />

      {error ? (
        <Alert
          className="mt-4"
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={load}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={tile.value === null ? "—" : String(tile.value)}
          />
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-white">
        <div className="flex items-center gap-5 overflow-x-auto border-b border-line px-[22px]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectStatus(tab.key)}
              className={`whitespace-nowrap border-b-2 py-[15px] text-xs transition-colors ${
                status === tab.key
                  ? "border-brand-700 font-bold text-brand-700"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3.5 border-b border-line px-5 py-[18px]">
          <input
            type="search"
            value={search}
            onChange={(event) => selectSearch(event.target.value)}
            placeholder="Név, eszközszám, gyártó, modell, sorozatszám"
            className="h-9 min-w-[220px] flex-1 rounded-lg border border-dusk-200 bg-white px-3 text-sm text-dusk-900 outline-none focus:border-brand-500 sm:max-w-[330px]"
          />
          <label>
            <span className="sr-only">Helyszín</span>
            <select
              value={helyszin}
              onChange={(event) => selectHelyszin(event.target.value)}
              className="h-9 rounded-lg border border-dusk-200 bg-white px-2.5 text-xs text-dusk-900"
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

        {!data && !error ? (
          <div className="space-y-3 p-5" aria-label="Eszközök betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : null}

        {data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left">
              <thead>
                <tr>
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
                      className="bg-[#fcfbfd] px-5 py-[13px] text-[10px] font-semibold uppercase tracking-[0.07em] text-muted whitespace-nowrap"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((asset) => (
                  <tr
                    key={asset.id}
                    className="transition-colors hover:bg-[#fbf9ff]"
                  >
                    <td className="border-t border-[#efedf3] px-5 py-[18px] text-xs align-top">
                      <Link
                        href={`/eszkozok/${asset.id}`}
                        className="block text-[13px] font-semibold leading-[1.45] text-ink hover:text-brand-700"
                      >
                        {asset.name}
                      </Link>
                      <span className="mt-1 block font-mono text-[11px] leading-[1.5] text-muted">
                        {eszkozAzonosito(asset)}
                      </span>
                      {asset.partnerInternalCode ? (
                        <span className="mt-1 block text-[11px] leading-[1.5] text-muted">
                          Partner belső kódja:{" "}
                          <span className="font-mono">
                            {asset.partnerInternalCode}
                          </span>
                        </span>
                      ) : null}
                    </td>
                    <td className="border-t border-[#efedf3] px-5 py-[18px] text-xs align-top">
                      {asset.unit
                        ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                        : (asset.address?.formatted ?? "Nincs pontosítva.")}
                    </td>
                    <td className="border-t border-[#efedf3] px-5 py-[18px] text-xs align-top text-ink">
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
                    <td className="border-t border-[#efedf3] px-5 py-[18px] text-xs align-top">
                      {asset.category ?? "—"}
                    </td>
                    <td className="border-t border-[#efedf3] px-5 py-[18px] text-xs align-top">
                      {[asset.manufacturer, asset.model, asset.serialNumber]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="border-t border-[#efedf3] px-5 py-[18px] text-xs align-top">
                      <Badge variant={assetStatusVariant[asset.status]}>
                        {assetStatusLabel[asset.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data ? (
          <div className="p-5">
            <EmptyState
              title="Nincs megjeleníthető eszköz"
              description="A partneri fiókhoz jelenleg nincs eszköz rögzítve, vagy a szűrők nem adnak találatot."
            />
          </div>
        ) : null}

        {data ? (
          <Pagination
            position="bottom"
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </section>
  );
}
