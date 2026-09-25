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
import {
  ServiceListStats,
  type ServiceStatTile,
} from "@/components/service/service-list-stats";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  formatDateTime,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
  worksheetStatusPilotVariant,
} from "../worksheet-labels";
import {
  PilotBadge,
  PilotButton,
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
 * === A CÍM/SZÁM SORREND A CELLÁBAN SZÁNDÉKOSAN FORDÍTOTT A TERVHEZ
 *     KÉPEST ===
 *
 * A terv a számot teszi elsőre, a tárgyat alá. A mai kód ezt egy korábbi
 * Balázs-döntés miatt MEGFORDÍTOTTA (lásd a kódkomment a cellánál): a
 * tárgyra emlékszik a kolléga, nem a sorszámra. Ez a pilot lista is a mai
 * sorrendet tartja.
 */

const FIGMA_TAB_ORDER: {
  key: "" | WorksheetVersionStatus;
  label: string;
}[] = [
  { key: "DRAFT", label: "Piszkozat" },
  { key: "AWAITING_SIGNATURE", label: "Aláírásra vár" },
  { key: "SIGNED", label: "Aláírva" },
  { key: "REJECTED", label: "Elutasítva" },
  { key: "", label: "Összes" },
];

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

  const tiles: ServiceStatTile[] = [
    {
      key: "DRAFT",
      icon: "edit",
      tone: "purple",
      label: "Szerkesztés alatt",
      count: counts?.DRAFT ?? null,
    },
    {
      key: "AWAITING_SIGNATURE",
      icon: "clock",
      tone: "amber",
      label: "Aláírásra vár",
      count: counts?.AWAITING_SIGNATURE ?? null,
    },
    {
      key: "SIGNED",
      icon: "checkCircle",
      tone: "green",
      label: "Aláírt munkalap",
      count: counts?.SIGNED ?? null,
    },
  ];

  const hasFilters = Boolean(search || params.get("customerId"));

  return (
    <PilotThemeRoot className="-m-6 min-h-screen bg-pilot-grey-50">
      <div className="border-b border-pilot-grey-200 bg-white px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="mb-1 text-xs text-pilot-grey-400">
              Szerviz / Munkalapok
            </p>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              Munkalapok
            </h1>
          </div>
          {canManage ? (
            <Link href="/szerviz/munkalapok/uj">
              <PilotButton variant="primary">
                <Icon name="plus" size={13} />
                Új munkalap
              </PilotButton>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="px-8 pt-6">
        <ServiceOfflineNotice
          state={data ? { kind: "loaded" } : { kind: "empty" }}
          pilot
        />
        {error ? (
          <Alert
            className="mb-4"
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
        <ServiceListStats
          tiles={tiles}
          active={activeStatus}
          onSelect={selectStatus}
          label="Munkalapok állapot szerint"
        />
      </div>

      <div className="border-b border-pilot-grey-200 bg-white px-8">
        <div className="flex gap-0">
          {FIGMA_TAB_ORDER.map((tab) => {
            const active = activeStatus === tab.key;
            return (
              <button
                key={tab.key || "all"}
                type="button"
                onClick={() => selectStatus(tab.key)}
                className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-all ${
                  active
                    ? "border-pilot-aqua-600 text-pilot-aqua-700"
                    : "border-transparent text-pilot-grey-500 hover:text-pilot-grey-700"
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    active
                      ? "bg-pilot-aqua-100 text-pilot-aqua-700"
                      : "bg-pilot-grey-100 text-pilot-grey-400"
                  }`}
                >
                  {tabCount(tab.key) ?? "–"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-pilot-grey-200 bg-white px-8 py-3">
        <div className="relative min-w-52 flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Munkalap keresése"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Munkalap keresése"
            title="Munkalapszám, partner vagy tárgy"
            className="w-full rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
        {partners.length ? (
          <label>
            <span className="sr-only">Partner szűrő</span>
            <select
              value={params.get("customerId") ?? ""}
              onChange={(event) => filter("customerId", event.target.value)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
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
          disabled={!userId}
          onClick={() => filter("assigneeId", mineOnly ? "" : userId)}
        >
          {mineOnly ? "Minden munkalap" : "Csak amit rám osztottak"}
        </PilotButton>
        {canHide ? (
          <PilotButton
            variant={includeHidden ? "primary" : "secondary"}
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
            className="cursor-pointer text-xs text-pilot-grey-400 transition hover:text-pilot-grey-700"
          >
            Szűrők törlése
          </button>
        ) : null}
      </div>

      {loading && !data ? (
        <div className="space-y-3 p-8">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : data?.items.length ? (
        <>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-pilot-grey-100 bg-white">
                  {[
                    "Munkalap",
                    "Partner",
                    "Felelős",
                    "Állapot",
                    "Módosítva",
                  ].map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((worksheet, index) => (
                  <tr
                    key={worksheet.id}
                    onClick={() =>
                      router.push(`/szerviz/munkalapok/${worksheet.id}`)
                    }
                    className={`group cursor-pointer border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                      index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                    }`}
                  >
                    <td className="px-4 py-3">
                      {/*
                        A CÍM/SZÁM SORREND SZÁNDÉKOSAN A MAI KÓDÉ, NEM A
                        TERVÉ -- lásd a fájl fejlécét.
                      */}
                      <p className="max-w-[260px] truncate text-sm font-medium text-pilot-grey-900 transition-colors group-hover:text-pilot-aqua-700">
                        {worksheet.subject}
                      </p>
                      <p className="mt-0.5 text-[11px] text-pilot-grey-400">
                        {worksheetLabelOrDraft(worksheet.label)}
                        {worksheet.versionCount > 1
                          ? ` · ${worksheet.versionCount} verzió`
                          : ""}
                      </p>
                      {worksheet.hidden ? (
                        <span className="mt-1 inline-block rounded-full bg-pilot-amber-100 px-2 py-0.5 text-[10px] font-medium text-pilot-amber-700">
                          Rejtett
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-600">
                      {worksheet.customerName}
                      <div className="text-[11px] text-pilot-grey-400">
                        {worksheet.departmentPath?.length
                          ? worksheet.departmentPath.join(" / ")
                          : worksheet.departmentCode}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-600">
                      {worksheet.assigneeNames.length > 0 ? (
                        worksheet.assigneeNames.join(", ")
                      ) : (
                        <span className="text-pilot-grey-300">
                          Nincs kiosztva
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PilotBadge
                        variant={worksheetStatusPilotVariant(worksheet.status)}
                      >
                        {worksheetStatusLabel[worksheet.status]}
                      </PilotBadge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-400">
                      {formatDateTime(worksheet.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end px-8 py-4">
            <Pagination
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={goToPage}
            />
          </div>
        </>
      ) : data ? (
        <div className="p-8">
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
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
