"use client";

import { Alert, EmptyState, Icon, Pagination, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetListResponse,
  type WorksheetSelectablePartner,
  type WorksheetVersionStatus,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  formatLaborHours,
  worksheetDisplayLabel,
  worksheetDisplayPilotVariant,
} from "../worksheet-labels";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- MUNKALAPOK LISTA (8. kör, 1/3 rész).
 *
 * Brief: `exchange/figma-leiras-8-kor-munkalapok-2026-09-25.md` (a mai
 * kódhoz igazított, javított változat), forrás:
 * `exchange/figma-munkalapok-make-8/src/MunkalapokScreen.tsx`
 * (`MunkalapokList`, 366-496. sor). Előkészítő leképezés:
 * `figma-munkalapok-8-kor-lefedettseg-2026-09-25.md` (barracuda/murena,
 * a `figma-eszkozok-make-7-lefedettseg.md` mintájára).
 *
 * === A SZABÁLY, AMIT EZ A KÖR KÖVET (Balázs/acrobot döntése,
 *     2026-09-25 10:34): A ZIP AZ ELRENDEZÉST ÉS A KINÉZETET ADJA, A
 *     MEZŐK/FELIRATOK/FELTÉTELEK A MAI KÓDBÓL JÖNNEK ===
 *
 * Ahol a terv másképp mutat, mint a mai működés, a KÓD nyer, és itt áll
 * leírva, nem csendben.
 *
 * === A FÜLSOR SORRENDJE A TERVET KÖVETI, A KULCSOK A MAI KÓDOT ===
 *
 * A mai `worksheet-list-page.tsx` "Összes" fület teszi ELSŐRE, a Figma
 * terv UTOLJÁRA ("Piszkozat, Aláírásra vár, Aláírva, Elutasítva, Összes").
 * A KINÉZET (sorrend) a tervé, az adat (a négy státusz kulcsa) a mai
 * kódé -- ugyanaz a "varrat" elv, mint az Eszközök körben.
 *
 * === A FÜLEK MELLETTI SZÁM MÁR VAN ADAT MÖGÖTT ===
 *
 * A terv minden fül mellé darabszámot rajzol. A mai `counts` válasz
 * (`WorksheetListResponse.counts`) MIND A NÉGY állapotra ad számot --
 * "Elutasítva" is benne van, csak a mai `ServiceListStats` csempesor nem
 * mutatja külön csempeként (lásd lent). Az "Összes" a négy szám összege --
 * nem új lekérdezés, csak összeadás.
 *
 * === A MAI "ÁLLAPOT SZERINTI CSEMPÉK" SOR MEGMARAD, RÉGI KINÉZETTEL ===
 *
 * A terv nem rajzol ilyen csempesort (nála a fülekbe épített szám
 * helyettesíti) -- de a mai `ServiceListStats` (ikon + nagy szám, 3
 * csempe: Piszkozat/Aláírásra vár/Aláírt) valódi, működő felület, amit a
 * terv hiánya nem tehet ide nem-létezővé. A Hibajegyek/Eszközök körök
 * mintáját követve: az ÖSSZETETT, ma is működő elem a régi kinézetében
 * marad, beágyazva -- itt a fejléc ALATT, a pilot-stílusú kereső/tábla
 * FÖLÖTT.
 *
 * === TOVÁBBI VALÓDI TÖBBLET, AMIT A TERV NEM RAJZOL, DE MEGMARAD ===
 *
 * - "Csak amit rám osztottak" / "Minden munkalap" váltógomb
 * - "Rejtettek is" / "Rejtettek nélkül" váltógomb (csak `SERVICE_HIDE` jogú
 *   felhasználónak)
 * - Sor-szintű "Rejtett" jelvény
 * - Verzió-szám a tárgy alatt, ha 1-nél több ("· N verzió")
 *
 * === THE SERVICE REDESIGN (Figma 423:448, Balázs, 2026-10-04) ===
 *
 * The page follows the redesign: header with one sentence, three stat
 * tiles, the five tabs in the design's order (Összes first), the filters,
 * and the columns Munkalap, Partner / helyszín, Felelős, Állapot, Munkaóra
 * and Hibajegy. The hours and the job come from the list row itself (API
 * E4); nothing is fetched per row.
 *
 * - THE TILES: one "Új és folyamatban" tile, not two (decision E5): the
 *   server counts drafts as one status, and the split by line count is
 *   only known per row.
 * - THE NUMBER STANDS ABOVE THE SUBJECT in the cell, as the redesign draws
 *   it. The earlier pilot list put the subject first (an older wish: people
 *   remember the subject); the approved redesign is the newer word, and the
 *   subject still stands right under the number.
 * - "Módosítva" is not a column any more (the design has none); the
 *   "Csak amit rám osztottak", partner, hidden-rows and paging controls all
 *   stay.
 */

const FIGMA_TAB_ORDER: {
  key: "" | WorksheetVersionStatus;
  label: string;
}[] = [
  { key: "", label: "Összes" },
  { key: "DRAFT", label: "Új és folyamatban" },
  { key: "AWAITING_SIGNATURE", label: "Elkészült" },
  { key: "SIGNED", label: "Lezárva" },
  { key: "REJECTED", label: "Elutasítva" },
];

/**
 * THE THREE STAT TILES (Figma 423:448), from the server's counts. Each tile
 * is also a filter, as the old tile row was: a click selects its status.
 */
const STAT_TILES: {
  key: WorksheetVersionStatus;
  label: string;
  detail: string;
  tone: string;
}[] = [
  {
    key: "DRAFT",
    label: "Új és folyamatban",
    detail: "még nincs lezárva",
    tone: "text-pilot-grey-900",
  },
  {
    key: "AWAITING_SIGNATURE",
    label: "Elkészült",
    detail: "aláírásra vár",
    tone: "text-pilot-amber-700",
  },
  {
    key: "SIGNED",
    label: "Lezárva",
    detail: "aláírva",
    tone: "text-pilot-aqua-700",
  },
];

/**
 * THE "MUNKAÓRA" CELL: the sheet's total hours, or a dash while it has no
 * line yet (a new sheet has nothing to count; "0 óra" would read as work
 * that took no time).
 */
export function worksheetHoursCell(item: {
  lineCount: number;
  laborHours: string;
}): string {
  return item.lineCount > 0 ? `${formatLaborHours(item.laborHours)} óra` : "—";
}

export function PilotWorksheetListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<WorksheetListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [partners, setPartners] = useState<WorksheetSelectablePartner[]>([]);
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const canHide = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_HIDE),
  );
  const token = session?.token ?? "";
  const userId = session?.user.id ?? "";
  const mineOnly = params.get("assigneeId") === userId && Boolean(userId);
  const activeStatus = params.get("status") ?? "";
  const includeHidden = params.get("includeHidden") === "true";

  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", "25");
    return value;
  }, [params]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await worksheetsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalapok nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, query, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void worksheetsApi
      .selectablePartners(token, controller.signal)
      .then((response) => setPartners(response.items))
      .catch(() => setPartners([]));
    return () => controller.abort();
  }, [canView, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search === (params.get("search") ?? "")) return;
      const next = new URLSearchParams(params.toString());
      if (search) next.set("search", search);
      else next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search]);

  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  const selectStatus = (key: string) => {
    filter("status", key === activeStatus ? "" : key);
  };

  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a munkalapokhoz"
        description="service.view jogosultság szükséges."
      />
    );

  const counts = data?.counts ?? null;
  const totalCount = counts
    ? counts.DRAFT + counts.AWAITING_SIGNATURE + counts.SIGNED + counts.REJECTED
    : null;
  const tabCount = (key: "" | WorksheetVersionStatus): number | null => {
    if (!counts) return null;
    if (key === "") return totalCount;
    return counts[key];
  };

  const hasFilters = Boolean(search || params.get("customerId"));

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col gap-6 bg-pilot-grey-50 px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pilot-aqua-700">
            Szerviz / Munkatér
          </p>
          <h1 className="text-3xl font-semibold text-pilot-grey-900">
            Munkalapok
          </h1>
          <p className="mt-2 text-sm text-pilot-grey-500">
            A helyszíni munka teljes életútja: kiosztás, tételek, napló, átadás
            és aláírás.
          </p>
        </div>
        {canManage ? (
          <Link href="/szerviz/munkalapok/uj">
            <PilotButton variant="primary" size="regular">
              <Icon name="plus" size={13} />
              Új munkalap
            </PilotButton>
          </Link>
        ) : null}
      </div>

      <ServiceOfflineNotice
        state={data ? { kind: "loaded" } : { kind: "empty" }}
        pilot
      />
      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      ) : null}

      <div
        aria-label="Munkalapok állapot szerint"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:max-w-[780px]"
      >
        {STAT_TILES.map((tile) => (
          <button
            key={tile.key}
            type="button"
            aria-pressed={activeStatus === tile.key}
            onClick={() => selectStatus(tile.key)}
            className={`cursor-pointer rounded-xl bg-white px-4 py-4 text-left ring-1 transition-colors ${
              activeStatus === tile.key
                ? "ring-2 ring-pilot-aqua-500"
                : "ring-pilot-grey-200 hover:ring-pilot-grey-300"
            }`}
          >
            <span className="block text-sm text-pilot-grey-600">
              {tile.label}
            </span>
            <span className="mt-2 flex items-baseline gap-4">
              <span className={`text-2xl font-semibold ${tile.tone}`}>
                {counts ? counts[tile.key] : "–"}
              </span>
              <span className="text-xs text-pilot-grey-500">{tile.detail}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {FIGMA_TAB_ORDER.map((tab) => {
          const active = activeStatus === tab.key;
          return (
            <button
              key={tab.key || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectStatus(tab.key)}
              className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-4 py-2 text-sm transition-colors ${
                active
                  ? "bg-pilot-aqua-50 font-semibold text-pilot-aqua-700"
                  : "text-pilot-grey-600 hover:text-pilot-grey-900"
              }`}
            >
              {tab.label}
              <span className="text-xs font-normal text-pilot-grey-400">
                {tabCount(tab.key) ?? "–"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          aria-label="Munkalap keresése"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Munkalapszám, partner vagy helyszín"
          className="w-full max-w-[390px] rounded-md bg-white px-3 py-2.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-400 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        />
        {partners.length ? (
          <label>
            <span className="sr-only">Partner szűrő</span>
            <select
              value={params.get("customerId") ?? ""}
              onChange={(event) => filter("customerId", event.target.value)}
              className="max-w-[240px] cursor-pointer rounded-md bg-white px-3 py-2.5 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
            >
              <option value="">Minden partner</option>
              {partners.map((partner) => (
                <option key={partner.customerId} value={partner.customerId}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <PilotButton
          variant={mineOnly ? "primary" : "secondary"}
          size="regular"
          disabled={!userId}
          onClick={() => filter("assigneeId", mineOnly ? "" : userId)}
        >
          {mineOnly ? "Minden munkalap" : "Csak amit rám osztottak"}
        </PilotButton>
        {canHide ? (
          <PilotButton
            variant={includeHidden ? "primary" : "secondary"}
            size="regular"
            onClick={() => filter("includeHidden", includeHidden ? "" : "true")}
          >
            {includeHidden ? "Rejtettek nélkül" : "Rejtettek is"}
          </PilotButton>
        ) : null}
        {hasFilters ? (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              filter("customerId", "");
            }}
            className="cursor-pointer text-xs text-pilot-grey-500 transition hover:text-pilot-grey-800"
          >
            Szűrők törlése
          </button>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : data?.items.length ? (
        <PilotCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-pilot-grey-100">
                  {[
                    "Munkalap",
                    "Partner / helyszín",
                    "Felelős",
                    "Állapot",
                    "Munkaóra",
                    "Hibajegy",
                  ].map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-4 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-500"
                    >
                      {col}
                    </th>
                  ))}
                  <th className="w-10" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((worksheet) => (
                  <tr
                    key={worksheet.id}
                    onClick={() =>
                      router.push(`/szerviz/munkalapok/${worksheet.id}`)
                    }
                    className={`group cursor-pointer border-b border-pilot-grey-100 align-top transition-colors last:border-0 hover:bg-pilot-aqua-50/40 ${
                      worksheet.hidden ? "opacity-50" : ""
                    }`}
                  >
                    <td className="max-w-[280px] px-4 py-5">
                      <p
                        className={`text-sm font-semibold transition-colors group-hover:text-pilot-aqua-700 ${
                          worksheet.number
                            ? "font-mono text-pilot-grey-900"
                            : "text-pilot-grey-500"
                        }`}
                      >
                        {worksheet.number ?? "Még nincs száma"}
                      </p>
                      <p className="mt-1 break-words text-xs text-pilot-grey-600">
                        {worksheet.subject}
                        {worksheet.versionCount > 1
                          ? ` · ${worksheet.versionCount} verzió`
                          : ""}
                      </p>
                      {worksheet.hidden ? (
                        <span className="mt-1 inline-block">
                          <PilotBadge variant="amber">Rejtett</PilotBadge>
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[280px] px-4 py-5">
                      <p className="break-words text-pilot-grey-900">
                        {worksheet.customerName}
                      </p>
                      <p className="mt-1 break-words text-xs text-pilot-grey-500">
                        {worksheet.departmentPath?.length
                          ? worksheet.departmentPath.join(" / ")
                          : worksheet.departmentCode}
                      </p>
                    </td>
                    <td className="px-4 py-5">
                      {worksheet.assigneeNames.length > 0 ? (
                        <span className="text-pilot-grey-900">
                          {worksheet.assigneeNames.join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-pilot-grey-400">
                          Nincs kiosztva
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-5">
                      <PilotBadge
                        variant={worksheetDisplayPilotVariant(
                          worksheet.status,
                          worksheet.lineCount ?? 0,
                        )}
                      >
                        {worksheetDisplayLabel(
                          worksheet.status,
                          worksheet.lineCount ?? 0,
                        )}
                      </PilotBadge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 text-pilot-grey-900">
                      {worksheetHoursCell(worksheet)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-5">
                      {worksheet.serviceJob ? (
                        <Link
                          href={`/szerviz/hibajegyek/${worksheet.serviceJob.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-mono text-xs text-pilot-aqua-700 hover:text-pilot-aqua-800"
                        >
                          {worksheet.serviceJob.jobNumber}
                        </Link>
                      ) : (
                        <span className="text-pilot-grey-400">—</span>
                      )}
                    </td>
                    <td className="px-2 py-5 text-pilot-grey-500">
                      <Icon
                        name="chevron-left"
                        size={16}
                        className="rotate-180"
                        aria-hidden="true"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pilot-grey-100 px-4 py-3 text-xs text-pilot-grey-500">
            <span>
              {data.items.length} / {data.pagination.totalItems} munkalap
            </span>
            <Pagination
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={goToPage}
            />
          </div>
        </PilotCard>
      ) : data ? (
        <EmptyState
          title={hasFilters ? "Nincs találat" : "Nincs munkalap"}
          description={
            hasFilters
              ? "Módosítsd a keresést, vagy töröld a szűrőket."
              : mineOnly
                ? "Rád jelenleg nincs munkalap kiosztva."
                : "Vegyél fel új munkalapot."
          }
          action={
            !hasFilters && canManage ? (
              <Link href="/szerviz/munkalapok/uj">
                <PilotButton variant="primary">
                  <Icon name="plus" size={13} />
                  Új munkalap
                </PilotButton>
              </Link>
            ) : undefined
          }
        />
      ) : null}
    </PilotThemeRoot>
  );
}
