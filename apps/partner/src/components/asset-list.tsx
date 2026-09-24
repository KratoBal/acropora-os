"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  EmptyState,
  Pagination,
  ServiceListFooter,
  ServiceListHeader,
  ServiceListTabs,
  ServiceSearchField,
  ServiceStatusBadge,
  Skeleton,
  StatCard,
  sv,
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
 * AZ ESZKÖZLISTA A BELSŐ (`app.acropora.hu`) ELRENDEZÉSÉBEN.
 *
 * Balázs kérése, 2026-09-24 07:28 UTC, verbatim: "en orulnek neki, ha
 * ugyanugy nezne ki a partner portalon pl az eszkozkezelo mint az
 * app.acropora.hu-n".
 *
 * A KÖZÖS KERETRE ÁLLVA: murena #1041-e (`ticket-portal-visual-parity`)
 * átköltöztette a `sv`/`ServiceStatusBadge`/`ServiceListHeader`/
 * `ServiceListTabs`/`ServiceListFooter`/`ServiceSearchField` keretet
 * `apps/web`-ből `packages/ui`-ba a hibajegy-lapokhoz. Ez a lap ugyanazokat
 * a komponenseket használja, nem egy saját, párhuzamos Tailwind-közelítést.
 *
 * AMI NEM KÖLTÖZÖTT ÁT (`ServiceListStats`/`ServiceStatTile`,
 * `apps/web/src/components/service/service-list-stats.tsx`): a statisztika-
 * csempék ezért a MÁR KORÁBBAN IS közös `StatCard`-ot használják (nem
 * kattinthatók, szemben a belső lap csempéivel).
 */

const TABS = [
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
      <ServiceListHeader
        eyebrow="Saját adatok"
        title="Eszközök"
        lead="A cégéhez tartozó eszközök. Kattintson egy eszközre az adatlapjáért."
      />

      {error ? (
        <Alert
          className="mb-6"
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

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={tile.value === null ? "—" : String(tile.value)}
          />
        ))}
      </div>

      <section className={sv.panel}>
        <ServiceListTabs
          tabs={TABS}
          active={status}
          onSelect={selectStatus}
          label="Eszközök szűrése státusz szerint"
        />
        <div className={sv.toolbar}>
          <ServiceSearchField
            label="Eszköz keresése"
            placeholder="Név, eszközszám, gyártó, modell, sorozatszám"
            value={search}
            onChange={selectSearch}
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <label>
              <span className="sr-only">Helyszín</span>
              <select
                className={sv.select}
                value={helyszin}
                onChange={(event) => selectHelyszin(event.target.value)}
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
          <div className="space-y-3 p-5" aria-label="Eszközök betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : null}

        {data?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
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
                      <th key={head} className={sv.tableHead}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((asset) => (
                    <tr key={asset.id} className={sv.tableRow}>
                      <td className={sv.tableCell}>
                        <Link
                          href={`/eszkozok/${asset.id}`}
                          className={sv.rowTitle}
                        >
                          {asset.name}
                        </Link>
                        <span className={`mt-1 block font-mono ${sv.rowMeta}`}>
                          {eszkozAzonosito(asset)}
                        </span>
                        {asset.partnerInternalCode ? (
                          <span className={`mt-1 block ${sv.rowMeta}`}>
                            Partner belső kódja:{" "}
                            <span className="font-mono">
                              {asset.partnerInternalCode}
                            </span>
                          </span>
                        ) : null}
                      </td>
                      <td className={sv.tableCell}>
                        {asset.unit
                          ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                          : (asset.address?.formatted ?? "Nincs pontosítva.")}
                      </td>
                      <td className={`${sv.tableCell} text-xs text-ink`}>
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
                      <td className={sv.tableCell}>{asset.category ?? "—"}</td>
                      <td className={sv.tableCell}>
                        {[asset.manufacturer, asset.model, asset.serialNumber]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className={sv.tableCell}>
                        <ServiceStatusBadge
                          tone={assetStatusTone[asset.status]}
                        >
                          {assetStatusLabel[asset.status]}
                        </ServiceStatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ServiceListFooter
              shown={data.items.length}
              totalItems={data.pagination.totalItems}
              tail={{
                kind: "paged",
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
              }}
            />
          </>
        ) : data ? (
          <div className="p-5">
            <EmptyState
              title="Nincs megjeleníthető eszköz"
              description="A partneri fiókhoz jelenleg nincs eszköz rögzítve, vagy a szűrők nem adnak találatot."
            />
          </div>
        ) : null}
      </section>
      {data ? (
        <Pagination
          position="bottom"
          className="mt-6"
          page={data.pagination.page}
          totalPages={data.pagination.totalPages}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
