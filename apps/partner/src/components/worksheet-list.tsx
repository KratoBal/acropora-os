"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Icon,
  Pagination,
  PilotAvatar,
  PilotBadge,
  PilotThemeRoot,
  pilotBadgeVariantForTone,
  pilotInitials,
} from "@acropora/ui";
import {
  worksheetStatusLabel,
  worksheetStatusTone,
  type WorksheetListResponse,
} from "@acropora/types";

import { partnerApi } from "@/lib/api";

/**
 * A MUNKALAP-LISTA -- FIGMA 9. KÖR (Partner Portál), a Make-terv
 * `PartnerPortalScreen.tsx:973-1050` átültetése.
 *
 * VIZUÁLIS VÁLTÁS A KORÁBBI KÖRHÖZ KÉPEST: az előző kör a belső, violet
 * `ServiceListHeader`/`ServiceListTabs`/`ServiceSearchField`/
 * `ServiceStatusBadge`/`ServiceListFooter`/`StatCard`/`Avatar` keretet vette
 * át -- a mostani Figma-kör a portál egészét pilot-aqua design-rendszerre
 * viszi, ez a lap a hibajegy- (#1117) és eszköz-listával (#1119) egyező
 * mintát követi.
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
 * AZ AVATAR EGY SZÍNT VISEL, NEM SZEMÉLYENKÉNT KÜLÖNBÖZŐT -- EZ MEGEGYEZIK
 * A KORÁBBI KÓDDAL ÉS A MAKE-TERVVEL IS. A `WorksheetListItem.assigneeNames`
 * csak nevek tömbje, nincs rajta `userId` -- az aquárium-lista
 * `pilotAvatarColor(userId)`-je itt nem alkalmazható (a korábbi kód is
 * egyetlen, fix `bg-brand-100` háttért adott mindenkinek, a Make-terv pedig
 * egyetlen, fix `#0b7a6e`-t). A pilot-verzió ugyanezt teszi, csak a
 * `--color-pilot-aqua-600` TOKENJÉRE hivatkozva (nem egy ide másolt hexával),
 * hogy sötét módban is a helyes árnyalatot adja.
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
] as const;

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
    () =>
      [
        {
          key: "DRAFT",
          label: "Szerkesztés alatt",
          value: counts?.DRAFT ?? null,
          icon: "clipboard",
        },
        {
          key: "AWAITING_SIGNATURE",
          label: "Aláírásra vár",
          value: counts?.AWAITING_SIGNATURE ?? null,
          icon: "pencil",
        },
        {
          key: "SIGNED",
          label: "Aláírt munkalap",
          value: counts?.SIGNED ?? null,
          icon: "pencil",
        },
      ] as const,
    [counts],
  );

  return (
    <PilotThemeRoot className="-mx-5 -mt-10 -mb-16 flex min-h-screen max-w-none flex-col bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
          Szervizmunka
        </p>
        <h1 className="text-xl font-semibold text-pilot-grey-900">
          Munkalapok
        </h1>
        <p className="mt-0.5 text-sm text-pilot-grey-400">
          A helyszíni munkától az aláírásig. A sorszám a lezáráskor keletkezik,
          piszkozatnak nincs száma.
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
                tile.key === "AWAITING_SIGNATURE"
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

      <div className="flex flex-wrap items-center gap-4 border-b border-pilot-grey-100 bg-white px-8 py-4">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => selectStatus(tab.key)}
              className={`cursor-pointer rounded-md px-3.5 py-1.5 text-sm font-medium transition-all ${
                status === tab.key
                  ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                  : "text-pilot-grey-500 hover:bg-pilot-grey-50 hover:text-pilot-grey-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Munkalap keresése"
            placeholder="Munkalapszám vagy tárgy"
            value={search}
            onChange={(event) => selectSearch(event.target.value)}
            className="w-56 rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
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
        <p className="px-8 py-6 text-sm text-pilot-grey-400">
          Munkalapok betöltése…
        </p>
      ) : null}

      {data?.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="clipboard" size={24} className="text-pilot-aqua-600" />
          </div>
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs munkalap
          </p>
          <p className="max-w-xs text-sm text-pilot-grey-400">
            Módosítsd a keresést vagy a szűrőt.
          </p>
        </div>
      ) : null}

      {data?.items.length ? (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100">
                {[
                  "Munkalap",
                  "Helyszín",
                  "Felelős",
                  "Állapot",
                  "Módosítva",
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
              {data.items.map((worksheet, index) => (
                <tr
                  key={worksheet.id}
                  className={`border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                    index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                  }`}
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/munkalapok/${worksheet.id}`}
                      className="font-medium text-pilot-grey-900 hover:text-pilot-aqua-700"
                    >
                      {worksheet.subject}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                      {worksheet.number ?? "Még nincs száma"}
                      {worksheet.versionCount > 1
                        ? ` · ${worksheet.versionCount} verzió`
                        : ""}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-500">
                    {worksheet.departmentPath?.length
                      ? worksheet.departmentPath.join(" / ")
                      : worksheet.departmentCode}
                  </td>
                  <td className="px-5 py-3">
                    {worksheet.assigneeNames[0] ? (
                      <span className="flex items-center gap-2">
                        <PilotAvatar
                          initials={pilotInitials(worksheet.assigneeNames[0])}
                          color="var(--color-pilot-aqua-600)"
                          size="sm"
                        />
                        <span className="text-pilot-grey-700">
                          {worksheet.assigneeNames.join(", ")}
                        </span>
                      </span>
                    ) : (
                      <span className="italic text-pilot-grey-400">
                        Nincs kiosztva
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <PilotBadge
                      variant={pilotBadgeVariantForTone(
                        worksheetStatusTone(worksheet.status),
                      )}
                    >
                      {worksheetStatusLabel[worksheet.status]}
                    </PilotBadge>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-500">
                    {new Intl.DateTimeFormat("hu-HU", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(worksheet.updatedAt))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-pilot-grey-100 bg-white px-5 py-3 text-xs text-pilot-grey-400">
            {data.pagination.totalItems} munkalap összesen
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
