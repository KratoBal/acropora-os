"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
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
  worksheetStatusLabel,
  worksheetStatusTone,
  type WorksheetListResponse,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";

/**
 * A MUNKALAP-LISTA A BELSŐ (`app.acropora.hu`) ELRENDEZÉSÉBEN.
 *
 * Balázs kérése, 2026-09-21, megerősítve 2026-09-24 07:28 UTC: "ugyanaz
 * legyen a hibajegy es a munkalap oldal is". Az `asset-list.tsx` és a
 * `ticket-list.tsx` (murena #1041) mintáját követi: a közös
 * `sv`/`ServiceListHeader`/`ServiceListTabs`/`ServiceListFooter`/
 * `ServiceSearchField`/`ServiceStatusBadge` komponenseket használja
 * (`packages/ui`), nem egy saját Tailwind-közelítést.
 *
 * A "PARTNER" OSZLOP KIMARAD, ÉS EZ NEM CSONKÍTÁS. A belső lista "Partner"
 * oszlopa a `customerName`-et mutatja -- a partner-portálon ez MINDIG a
 * bejelentkezett cég, tehát üres ismétlés lenne (ugyanaz a döntés, mint a
 * `ticket-detail.tsx`-ben az "Az ügy adatai" panel "Partner" sorának
 * elhagyásánál). A "Helyszín" oszlop marad, mert a partnernek több
 * telephelye is lehet.
 *
 * A "FELELŐS" OSZLOP MARAD: a `assigneeNames` a MI kollégáink neve, nem
 * belső megjegyzés -- ugyanaz a döntés, mint a `ticket-detail.tsx` naplóján
 * a kolléga nevének megtartása ("a megjegyzes nem kell a nev igen").
 *
 * AMI KIMARAD, ÉS MIÉRT: a partner-választó (nincs értelme, egy partner
 * mindig saját magát látja), a "Csak amit rám osztottak" és a "Rejtettek
 * is" kapcsoló (mindkettő belső jogosultsághoz/fogalomhoz kötött, a
 * feladat nem kéri, és egy új szűrő bevezetése túlmutatna a kinézet
 * igazításán). Az "ár" oszlop sehol nem jelenik meg -- ez Balázs 2026-09-17-i
 * döntése (#809), nem partneri szűkítés.
 */

const TABS = [
  { key: "ALL", label: "Összes" },
  { key: "DRAFT", label: "Piszkozat" },
  { key: "AWAITING_SIGNATURE", label: "Aláírásra vár" },
  { key: "SIGNED", label: "Aláírva" },
  { key: "REJECTED", label: "Elutasítva" },
];

const PAGE_SIZE = 25;

export function WorksheetList() {
  const [data, setData] = useState<WorksheetListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    void partnerApi
      .worksheets({
        ...(status !== "ALL" ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        page,
        pageSize: PAGE_SIZE,
      })
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A munkalapok nem tölthetők be.",
        ),
      );
  }, [status, search, page]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  const selectStatus = (key: string) => {
    setStatus(key === status ? "ALL" : key);
    setPage(1);
  };
  const selectSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const counts = data?.counts ?? null;
  const tiles = useMemo(
    () => [
      {
        key: "DRAFT",
        label: "Szerkesztés alatt",
        value: counts?.DRAFT ?? null,
      },
      {
        key: "AWAITING_SIGNATURE",
        label: "Aláírásra vár",
        value: counts?.AWAITING_SIGNATURE ?? null,
      },
      {
        key: "SIGNED",
        label: "Aláírt munkalap",
        value: counts?.SIGNED ?? null,
      },
    ],
    [counts],
  );

  return (
    <section>
      <ServiceListHeader
        eyebrow="Szervizmunka"
        title="Munkalapok"
        lead="A helyszíni munkától az aláírásig. A sorszám a lezáráskor keletkezik, piszkozatnak nincs száma."
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
          label="Munkalapok szűrése állapot szerint"
        />
        <div className={sv.toolbar}>
          <ServiceSearchField
            label="Munkalap keresése"
            placeholder="Munkalapszám vagy tárgy"
            value={search}
            onChange={selectSearch}
          />
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
          <div className="space-y-3 p-5" aria-label="Munkalapok betöltése">
            <Skeleton className="h-16" />
            <Skeleton className="h-64" />
          </div>
        ) : null}

        {data?.items.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr>
                    {[
                      "Munkalap",
                      "Helyszín",
                      "Felelős",
                      "Állapot",
                      "Módosítva",
                    ].map((head) => (
                      <th key={head} className={sv.tableHead}>
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((worksheet) => (
                    <tr key={worksheet.id} className={sv.tableRow}>
                      <td className={sv.tableCell}>
                        <Link
                          href={`/munkalapok/${worksheet.id}`}
                          className={sv.rowTitle}
                        >
                          {worksheet.subject}
                        </Link>
                        <span className={`mt-1 block ${sv.rowMeta}`}>
                          {worksheet.number ?? "Még nincs száma"}
                          {worksheet.versionCount > 1
                            ? ` · ${worksheet.versionCount} verzió`
                            : ""}
                        </span>
                      </td>
                      <td className={sv.tableCell}>
                        <div className={sv.rowMeta}>
                          {worksheet.departmentPath?.length
                            ? worksheet.departmentPath.join(" / ")
                            : worksheet.departmentCode}
                        </div>
                      </td>
                      <td className={sv.tableCell}>
                        {worksheet.assigneeNames[0] ? (
                          <span className="flex items-center gap-2">
                            <Avatar
                              size="sm"
                              name={worksheet.assigneeNames[0]}
                              className="bg-brand-100 text-brand-ink ring-0"
                            />
                            <span className="text-xs text-ink">
                              {worksheet.assigneeNames.join(", ")}
                            </span>
                          </span>
                        ) : (
                          <span className={sv.rowMeta}>Nincs kiosztva</span>
                        )}
                      </td>
                      <td className={sv.tableCell}>
                        <ServiceStatusBadge
                          tone={worksheetStatusTone(worksheet.status)}
                        >
                          {worksheetStatusLabel[worksheet.status]}
                        </ServiceStatusBadge>
                      </td>
                      <td className={`${sv.tableCell} ${sv.rowMeta}`}>
                        {new Intl.DateTimeFormat("hu-HU", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(worksheet.updatedAt))}
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
              title="Nincs munkalap"
              description="Módosítsd a keresést vagy a szűrőt."
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
