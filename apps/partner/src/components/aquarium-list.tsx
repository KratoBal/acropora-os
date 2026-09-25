"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Icon,
  Pagination,
  PilotAvatar,
  PilotButton,
  PilotThemeRoot,
  pilotAvatarColor,
  pilotInitials,
} from "@acropora/ui";
import type { AquariumListResponse } from "@acropora/types";

import { partnerApi } from "@/lib/api";
import { WATER_BODY_LABEL } from "@/lib/aquarium-labels";

/**
 * AZ AKVÁRIUM-LISTA A PORTÁLON -- PILOT-STÍLUS (Balázs döntése, emlék 1847,
 * 2026-09-25 16:04 UTC).
 *
 * === MI VÁLTOZOTT A KORÁBBI KÖRHÖZ KÉPEST ===
 *
 * Az előző kör (#1118) a belső `app.acropora.hu` RÉGI (violet, `sv`/
 * `ServiceListHeader`) keretét vette át. Ez a kör lecseréli a belső web
 * PILOT akvárium-listájának (`apps/web/src/components/aquariums/pilot/
 * pilot-aquarium-list-page.tsx`) elrendezésére -- ugyanaz az irány, amit a
 * portál többi listája (hibajegy #1117, eszköz #1119, munkalap #1120) már
 * követ.
 *
 * === HÁROM ELTÉRÉS A BELSŐ LISTÁTÓL, ÉS MIÉRT ===
 *
 * 1. NINCS "Tulajdon" SZŰRŐ ÉS OSZLOP (Saját/Ügyfél). A belső lista minden
 *    akváriumot lát, a partneré csak a SAJÁT ügyfeléhez tartozókat --
 *    `ownershipType` tehát a portálon mindig `CUSTOMER`, egy szűrő rajta
 *    semmit nem szűkítene. Az `AquariumSummary` mezőt a szerver továbbra is
 *    küldi, csak a felület nem jelenít meg rá szűrőt/oszlopot.
 * 2. "Ügyfél" OSZLOP HELYETT "Helyszín" (departmentName). A belső listán az
 *    ügyfél a releváns megkülönböztető adat (sok ügyfél akváriumai
 *    keverednek); a portálon az ügyfél mindig ugyanaz (a hívó saját cége),
 *    a HELYSZÍN viszont változik akváriumonként -- ugyanaz a csere, mint az
 *    eszköz-listánál ("Elhelyezés" oszlop).
 * 3. AZ "ÚJ AKVÁRIUM" GOMB FELTÉTEL NÉLKÜL JELENIK MEG, nem
 *    `hasPermission(..., AQUARIUMS_MANAGE)` mögött, mint a belső lapon. A
 *    `create()` szolgáltatás-réteg (`aquariums.service.ts`
 *    `resolvePartnerOwnership`) NEM hív `requireInternalWriter`-t, tehát
 *    minden `PARTNER_SERVICE` fiók elérheti a végpontot -- egy jog-alapú
 *    rejtés itt hamis biztonságot adna. Hozzárendelt helyszín nélkül a
 *    gomb a felvitel-űrlapra visz, ami a saját üres-állapot üzenetét adja.
 *
 * === "KARBANTARTÓK" OSZLOP -- MEGTARTVA, ÍTÉLET-KÉRDÉS ===
 *
 * A belső lista ezt a belsős karbantartó-kiosztás eredményeként mutatja
 * (`AQUARIUMS_MANAGE`, `requireInternalWriter`-rel zárva a partner elől).
 * A portál PARTNERE nem oszthat ki karbantartót, DE megnézheti, kit
 * rendeltünk hozzá -- ez puszta megjelenítés, nem művelet, tehát nem ütközik
 * a "belsős írás marad belsős" szabállyal. Ha Balázs mégis félrevezetőnek
 * találja (túl "belsős" adatnak), egy sor törli az oszlopot.
 *
 * === A "VÍZTÍPUS" (waterType, sós/édes) TOVÁBBRA SEM SZEREPEL A LISTÁN ===
 *
 * Ugyanaz az ok, mint a korábbi körben: az `AquariumSummary` nem hordozza,
 * csak az `AquariumDetail`. A "Típus" oszlop itt a `waterBodyType`
 * (akvárium/tó) -- MÁS mező, ami viszont MINDIG jelen van a listaválaszban.
 */

const WATER_BODY_OPTIONS = ["Mind", "Akvárium", "Tó"] as const;
const PAGE_SIZE = 25;

const litersFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 0,
});
const lastMeasuredFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function AquariumList() {
  const [data, setData] = useState<AquariumListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [waterBodyType, setWaterBodyType] = useState<"" | "AKVARIUM" | "TO">(
    "",
  );
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    void partnerApi
      .aquariums({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(waterBodyType ? { waterBodyType } : {}),
        page,
        pageSize: PAGE_SIZE,
      })
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Az akváriumok nem tölthetők be.",
        ),
      );
  }, [search, waterBodyType, page]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  const selectSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const selectWaterBody = (value: (typeof WATER_BODY_OPTIONS)[number]) => {
    setWaterBodyType(
      value === "Akvárium" ? "AKVARIUM" : value === "Tó" ? "TO" : "",
    );
    setPage(1);
  };
  const waterBodyFilterValue =
    waterBodyType === "AKVARIUM"
      ? "Akvárium"
      : waterBodyType === "TO"
        ? "Tó"
        : "Mind";

  return (
    <PilotThemeRoot className="flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-pilot-grey-900">
            Akváriumok
          </h1>
          <p className="mt-0.5 text-sm text-pilot-grey-400">
            {data ? `${data.pagination.totalItems} bejegyzés összesen` : " "}
          </p>
        </div>
        <Link href="/akvariumok/uj">
          <PilotButton variant="primary">
            <Icon name="plus" size={14} />
            Új akvárium
          </PilotButton>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-pilot-grey-100 bg-white px-8 py-4">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Akvárium keresése"
            placeholder="Keresés név alapján…"
            value={search}
            onChange={(event) => selectSearch(event.target.value)}
            className="w-72 rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-pilot-grey-400">
            Típus:
          </span>
          {WATER_BODY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => selectWaterBody(option)}
              className={`cursor-pointer whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                waterBodyFilterValue === option
                  ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                  : "text-pilot-grey-500 hover:bg-pilot-grey-50 hover:text-pilot-grey-800"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
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

      {!data && !error ? (
        <p className="px-8 py-6 text-sm text-pilot-grey-400">
          Akváriumok betöltése…
        </p>
      ) : null}

      {data && data.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="aquarium" size={24} className="text-pilot-aqua-600" />
          </div>
          <div className="text-center">
            <p className="mb-1 text-base font-semibold text-pilot-grey-700">
              {data.pagination.totalItems
                ? "Nincs találat"
                : "Még nincs akvárium"}
            </p>
            <p className="max-w-xs text-sm text-pilot-grey-400">
              {data.pagination.totalItems
                ? "Módosítsa a szűrőket."
                : "Adjon hozzá egy akváriumot, és itt láthatja az összes nyilvántartott példányt."}
            </p>
          </div>
          <Link href="/akvariumok/uj">
            <PilotButton variant="primary">
              <Icon name="plus" size={14} />
              Új akvárium
            </PilotButton>
          </Link>
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-pilot-grey-100">
                  {[
                    "Név",
                    "Helyszín",
                    "Típus",
                    "Liter",
                    "Karbantartók",
                    "Utolsó vízmérés",
                  ].map((col) => (
                    <th
                      key={col}
                      className={`whitespace-nowrap bg-white px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400 ${
                        col === "Liter" ? "text-right" : ""
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, index) => (
                  <tr
                    key={item.id}
                    className={`border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                      index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/akvariumok/${item.id}`}
                        className="font-medium text-pilot-grey-900 no-underline hover:text-pilot-aqua-700 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <div className="text-xs font-normal text-pilot-grey-500">
                        {item.aquariumNumber}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-pilot-grey-500">
                      {item.departmentName ?? "Nincs megadva"}
                    </td>
                    <td className="px-4 py-3 text-pilot-grey-600">
                      {WATER_BODY_LABEL[item.waterBodyType]}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-pilot-grey-700">
                      {item.systemVolumeLiters != null
                        ? `${litersFormatter.format(item.systemVolumeLiters)} l`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex -space-x-1.5">
                        {item.maintainers.map((maintainer) => (
                          <PilotAvatar
                            key={maintainer.userId}
                            initials={pilotInitials(maintainer.displayName)}
                            color={pilotAvatarColor(maintainer.userId)}
                            size="sm"
                          />
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-pilot-grey-500">
                      {item.lastMeasuredAt ? (
                        lastMeasuredFormatter.format(
                          new Date(item.lastMeasuredAt),
                        )
                      ) : (
                        <span className="italic text-pilot-grey-300">
                          nincs
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end border-t border-pilot-grey-100 bg-white px-4 py-2">
            <Pagination
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      ) : null}
    </PilotThemeRoot>
  );
}
