"use client";
import { Alert, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
// A DÁTUMFORMÁZÓ A MUNKALAPOKNÁL ÉL, UGYANÚGY, MINT A MAI LISTÁN -- nem
// másolom ide, két formázó egy felületen előbb-utóbb két alakot adna
// ugyanarra az időpontra.
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { serviceJobStatusLabel } from "../service-job-labels";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import {
  assigneeNames,
  NO_ASSIGNEE,
  pilotItemsForTab,
  pilotStatTiles,
  pilotTabCounts,
  pilotTabDef,
  PILOT_TAB_NOUN,
  PILOT_TABS,
  STATUS_BADGE_VARIANT,
  type PilotTab,
} from "./pilot-service-job-list-view";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- HIBAJEGYEK LISTA KÉPERNYŐ.
 *
 * Acrobot kérése (msg 23137, 2026-09-24 19:11 UTC): "Atultetes a Szerviz /
 * Hibajegyek harom oldalara..., ugyanugy, mint az Akvariumoknal: a Figma
 * lesz az EGYETLEN kinezet, valaszto nelkul." Ez az ELSŐ a három oldalból
 * (lista, adatlap, új hibajegy) -- a másik kettő KÜLÖN körben, mert a
 * hibajegy adatlapja jóval nagyobb felületet fed (14+ önálló alrendszer:
 * leírás-szerkesztés, csatolmányok, munkalap csatolás, átadás-kiküldés
 * stb.), és a ház szabálya szerint egy túl nagy feature-t fel kell bontani
 * ("Kis, felülvizsgálható PR-ok").
 *
 * EZ CSAK A HIBAJEGYEKET (Szerviz / Hibajegyek) ÉRINTI, A KARBANTARTÁST
 * NEM: a `ServiceJobListPage` (a régi, közös komponens) `kind="MAINTENANCE"`
 * paraméterrel VÁLTOZATLANUL fut a `/szerviz/karbantartas` útvonalon -- ez a
 * komponens NEM veszi át azt a szerepet, saját fájl, saját route.
 *
 * === A DELEGÁLÁS BENNE VAN, ÉS EZ NEM ÚJ HATÓKÖR ===
 *
 * A Figma-kör előkészítő anyagai között egy KÉSŐBBI kiegészítés
 * (`figma-leiras-5b-hibajegy-delegalas...md`, a hatodik Make-export) egy
 * "Delegálva" oszlopot ad a listához. Elsőre új funkciónak tűnt, de a
 * `ServiceJobAssigneeEditor`/`serviceJobsApi.setAssignees` -- tehát maga a
 * delegálás -- MÁR LÉTEZIK (Balázs kérése, 2026-09-14), csak a LISTA eddig
 * nem mutatta. A `ServiceJobListItem.assignees` mező és a hozzá tartozó
 * kötegelt lekérdezés (`service-jobs.repository.ts`) ennek a PR-nak a
 * része -- meglévő adat felszínre hozása, nem új képesség.
 *
 * === PARTNER ÉS HELYSZÍN SZŰRŐ: A BETÖLTÖTT LAPON BELÜL ===
 *
 * A keresés a szerveren megy (mint eddig), a Partner/Helyszín szűrő viszont
 * a MÁR BETÖLTÖTT (fülre + keresésre + rejtettségre szűrt, legfeljebb
 * 200 soros) listán belül válogat, és az opciók is ebből a halmazból
 * származnak. Ez a mai 200-as korláttal (`LIST_LIMIT`) egyező hatókör --
 * nem tágabb és nem szűkebb ígéret, mint amit a lista amúgy is hordoz.
 *
 * === AZ "ÖSSZES" FÜL MEGMARADT, A FIGMA NEM MUTATJA ===
 *
 * A terv három fület ír le (Nyitott / Válaszra-vagy-alkatrészre vár /
 * Lezárt). A mai lista negyediket is ismer ("Összes"), és ez a képesség
 * megmarad -- a ház szabálya szerint amit a Figma nem mutat, de ma megvan,
 * az nem tűnik el csendben.
 *
 * === AZ ÁLLAPOT-JELVÉNY SZÍNE HÁROM TÓNUSRA EGYSZERŰSÖDIK ===
 *
 * A valódi rendszer NYOLC belső állapotot ismer (lásd `serviceJobStatusLabel`),
 * a Figma-terv viszont csak négy szín köré épült, és abból is csak három
 * token áll rendelkezésre ebben a repóban (`pilot-aqua`, `pilot-amber`,
 * `pilot-grey` -- lásd `figma-theme.css` fejlécét: "Use ONLY those
 * tokens"). A CÍMKE SZÖVEGE ezért a nyolc valódi név marad (nem vész el
 * részlet), csak a SZÍN egyszerűsödik három csoportra.
 */

const ALL_LOCATIONS = "Mind";
const ALL_PARTNERS = "Mind";

/**
 * A LISTA ÁLLAPOTA AZ URL-BEN (Balázs kérése, 2026-09-30 12:29 UTC: egy
 * szűrt listáról az adatlapra, majd vissza, a szűrés maradjon meg). A fül,
 * a keresés, a rejtettek, a partner és a helyszín az URL-ből indul, és
 * minden változás oda íródik vissza; az alapérték nem kerül a címbe.
 */
const PILOT_TAB_VALUES: readonly PilotTab[] = [
  "all",
  "open",
  "waiting",
  "closed",
];

export function serviceJobListStateFromUrl(params: URLSearchParams): {
  tab: PilotTab;
  search: string;
  includeHidden: boolean;
  partner: string;
  location: string;
} {
  const tab = params.get("tab") as PilotTab | null;
  return {
    tab: tab && PILOT_TAB_VALUES.includes(tab) ? tab : "open",
    search: params.get("q") ?? "",
    includeHidden: params.get("hidden") === "1",
    partner: params.get("partner") || ALL_PARTNERS,
    location: params.get("location") || ALL_LOCATIONS,
  };
}

export function serviceJobListQuery(state: {
  tab: PilotTab;
  search: string;
  includeHidden: boolean;
  partner: string;
  location: string;
}): string {
  const query = new URLSearchParams();
  if (state.tab !== "open") query.set("tab", state.tab);
  if (state.search.trim()) query.set("q", state.search.trim());
  if (state.includeHidden) query.set("hidden", "1");
  if (state.partner !== ALL_PARTNERS) query.set("partner", state.partner);
  if (state.location !== ALL_LOCATIONS) query.set("location", state.location);
  return query.toString();
}

export function PilotServiceJobListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [initial] = useState(() => serviceJobListStateFromUrl(params));
  const [tab, setTab] = useState<PilotTab>(initial.tab);
  const [search, setSearch] = useState(initial.search);
  const [appliedSearch, setAppliedSearch] = useState(initial.search);
  const [includeHidden, setIncludeHidden] = useState(initial.includeHidden);
  const [partner, setPartner] = useState(initial.partner);
  const [location, setLocation] = useState(initial.location);
  const [data, setData] = useState<ServiceJobListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const { scope } = pilotTabDef(tab);

  /*
    A GÉPELÉS NEM KÉRÉSENKÉNT MEGY LE, UGYANÚGY, MINT A MAI LISTÁN: a keresés
    a SZERVEREN szűr, tehát minden leütés egy lekérdezés lenne.
  */
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(
          await serviceJobsApi.list(
            token,
            scope,
            signal,
            appliedSearch,
            includeHidden,
            "REPAIR",
          ),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A hibajegyek nem tölthetők be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [appliedSearch, canView, includeHidden, scope, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /* A FÜLVÁLTÁS A PARTNER/HELYSZÍN SZŰRŐT IS NULLÁZZA -- egy korábban
     kiválasztott partner/helyszín az ÚJ fülön lehet, hogy nem is szerepel
     az opciók között, és egy láthatatlanul aktív szűrő üres listát adna
     magyarázat nélkül. A kattintásban történik, nem effektben: induláskor
     a partner/helyszín az URL-ből jön, és azt nem szabad nullázni. */
  const selectTab = (next: PilotTab) => {
    if (next === tab) return;
    setTab(next);
    setPartner(ALL_PARTNERS);
    setLocation(ALL_LOCATIONS);
  };

  /* Az állapot visszaírása az URL-be, csak ha tényleg változott. */
  useEffect(() => {
    const next = serviceJobListQuery({
      tab,
      search: appliedSearch,
      includeHidden,
      partner,
      location,
    });
    if (next === params.toString()) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [
    appliedSearch,
    includeHidden,
    location,
    params,
    partner,
    pathname,
    router,
    tab,
  ]);

  const tabItems = useMemo(
    () => (data ? pilotItemsForTab(data.items, tab) : []),
    [data, tab],
  );

  const partnerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tabItems
            .map((item) => item.customerName)
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort((a, b) => a.localeCompare(b, "hu")),
    [tabItems],
  );

  const locationOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of tabItems) {
      if (!item.departmentPath?.length) continue;
      const key = item.departmentPath.join(" / ");
      const leaf = item.departmentPath[item.departmentPath.length - 1]!;
      const label = item.departmentCode
        ? `${item.departmentCode} · ${leaf}`
        : leaf;
      map.set(key, label);
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], "hu"),
    );
  }, [tabItems]);

  const filtered = useMemo(
    () =>
      tabItems.filter((item) => {
        if (partner !== ALL_PARTNERS && item.customerName !== partner)
          return false;
        if (
          location !== ALL_LOCATIONS &&
          (item.departmentPath?.join(" / ") ?? "") !== location
        )
          return false;
        return true;
      }),
    [tabItems, partner, location],
  );

  const counts = data ? pilotTabCounts(data.counts) : null;
  const hasActiveFilters =
    partner !== ALL_PARTNERS || location !== ALL_LOCATIONS;

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col gap-6 bg-pilot-grey-50 px-8 py-8">
      {/*
        THE HEADER OF THE SERVICE REDESIGN (Figma 423:20): eyebrow, title, one
        sentence on what the list is for, and the primary action at the right.
      */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-pilot-aqua-700">
            Szerviz / Munkatér
          </p>
          <h1 className="text-3xl font-semibold text-pilot-grey-900">
            Hibajegyek
          </h1>
          <p className="mt-2 text-sm text-pilot-grey-500">
            Minden bejelentésnek legyen következő lépése. A hibajegy a lánc első
            eleme; mögötte állnak a munkalapok.
          </p>
        </div>
        {canManage ? (
          <Link href="/szerviz/hibajegyek/uj">
            <PilotButton variant="primary" size="regular">
              <Icon name="plus" size={14} />
              Új hibajegy
            </PilotButton>
          </Link>
        ) : null}
      </div>

      {/*
        THE STAT TILES come back (the redesign brief keeps them), from the
        server's counts only; see `pilotStatTiles` for what is left out.
      */}
      <div
        aria-label="Összesítés"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:max-w-[780px]"
      >
        {(data ? pilotStatTiles(data.counts) : []).map((tile) => (
          <PilotCard key={tile.key} className="px-4 py-4">
            <p className="text-sm text-pilot-grey-600">{tile.label}</p>
            <p className="mt-2 flex items-baseline gap-4">
              <span
                className={`text-2xl font-semibold ${
                  tile.tone === "amber"
                    ? "text-pilot-amber-700"
                    : tile.tone === "teal"
                      ? "text-pilot-aqua-700"
                      : "text-pilot-grey-900"
                }`}
              >
                {tile.value}
              </span>
              {tile.detail ? (
                <span className="text-xs text-pilot-grey-500">
                  {tile.detail}
                </span>
              ) : null}
            </p>
          </PilotCard>
        ))}
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {PILOT_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => selectTab(entry.id)}
            className={`cursor-pointer rounded-md px-4 py-2 text-sm transition-colors ${
              tab === entry.id
                ? "bg-pilot-aqua-50 font-semibold text-pilot-aqua-700"
                : "text-pilot-grey-600 hover:text-pilot-grey-900"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          aria-label="Hibajegy keresése"
          placeholder="Hibajegyszám, partner vagy hiba"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full max-w-[390px] rounded-md bg-white px-3 py-2.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-400 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        />
        {/*
          THE PARTNER AND LOCATION FILTERS are not in the design, but they
          exist today and stay (the brief: nothing working is lost).
        */}
        <select
          aria-label="Partner szűrő"
          value={partner}
          onChange={(event) => setPartner(event.target.value)}
          className="max-w-[240px] cursor-pointer rounded-md bg-white px-3 py-2.5 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        >
          <option value={ALL_PARTNERS}>Minden partner</option>
          {partnerOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Helyszín szűrő"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          className="max-w-[240px] cursor-pointer rounded-md bg-white px-3 py-2.5 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        >
          <option value={ALL_LOCATIONS}>Minden helyszín</option>
          {locationOptions.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {/* A JELÖLŐ CSAK ANNAK LÁTSZIK, aki vissza is tudja állítani a
            rejtett jegyeket -- ugyanaz a szabály, mint a mai listán. */}
        {canHide ? (
          <button
            type="button"
            aria-pressed={includeHidden}
            onClick={() => setIncludeHidden((current) => !current)}
            className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-4 text-sm font-semibold ring-1 transition-colors ${
              includeHidden
                ? "bg-pilot-aqua-50 text-pilot-aqua-700 ring-pilot-aqua-200"
                : "bg-white text-pilot-grey-900 ring-pilot-grey-200 hover:bg-pilot-grey-50"
            }`}
          >
            Rejtettek is
          </button>
        ) : null}
      </div>

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

      {loading && !data ? (
        <div aria-label="Hibajegyek betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data && filtered.length === 0 ? (
        <PilotCard className="flex flex-col items-center justify-center gap-4 py-20">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="clipboard" size={24} className="text-pilot-aqua-600" />
          </div>
          <div className="text-center">
            <p className="mb-1 text-sm font-semibold text-pilot-grey-700">
              {appliedSearch || hasActiveFilters
                ? "Nincs találat"
                : "Még nincs hibajegy"}
            </p>
            <p className="max-w-xs text-xs text-pilot-grey-400">
              {appliedSearch || hasActiveFilters
                ? "Próbálj más keresési feltételt."
                : "Hozz létre egy új hibajegyet a bejelentett problémák nyomon követéséhez."}
            </p>
          </div>
          {!appliedSearch && !hasActiveFilters && canManage ? (
            <Link href="/szerviz/hibajegyek/uj">
              <PilotButton variant="primary">
                <Icon name="plus" size={14} />
                Új hibajegy
              </PilotButton>
            </Link>
          ) : null}
        </PilotCard>
      ) : null}

      {data && filtered.length > 0 ? (
        <PilotCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-pilot-grey-100">
                  {[
                    "Hibajegy",
                    "Partner / helyszín",
                    "Felelős",
                    "Állapot",
                    "Munkalap",
                    "Létrehozva",
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
                {filtered.map((item) => {
                  const names = assigneeNames(item.assignees ?? []);
                  return (
                    <tr
                      key={item.id}
                      onClick={() =>
                        router.push(`/szerviz/hibajegyek/${item.id}`)
                      }
                      className={`group cursor-pointer border-b border-pilot-grey-100 align-top transition-colors last:border-0 hover:bg-pilot-aqua-50/40 ${
                        item.hidden ? "opacity-50" : ""
                      }`}
                    >
                      {/*
                        THE TITLE WRAPS AND THE NUMBER STANDS UNDER IT. The
                        design draws a two-line title over the number; here
                        each is its own line, so a long title pushes the
                        number down instead of covering it.
                      */}
                      <td className="max-w-[280px] px-4 py-5">
                        <p className="break-words font-semibold text-pilot-grey-900 transition-colors group-hover:text-pilot-aqua-700">
                          {item.title}
                        </p>
                        <p className="mt-1 font-mono text-xs text-pilot-grey-500">
                          {item.jobNumber}
                        </p>
                        {item.reporterPersonName && item.reporterName ? (
                          <p className="mt-1 text-xs text-pilot-grey-600">
                            Bejelentő: {item.reporterName}
                          </p>
                        ) : null}
                        {item.hidden ? (
                          <span className="mt-1 inline-block">
                            <PilotBadge variant="amber">Rejtett</PilotBadge>
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[280px] px-4 py-5">
                        <p className="break-words text-pilot-grey-900">
                          {item.customerName ?? "Nincs megadva"}
                        </p>
                        <p className="mt-1 break-words text-xs text-pilot-grey-500">
                          {item.departmentPath?.length
                            ? item.departmentPath.join(" / ")
                            : "—"}
                        </p>
                      </td>
                      <td className="px-4 py-5">
                        {names ? (
                          <span className="text-pilot-grey-900">{names}</span>
                        ) : (
                          <span className="text-xs text-pilot-grey-400">
                            {NO_ASSIGNEE}
                          </span>
                        )}
                      </td>
                      {/*
                        THE PARTNER'S STATUS STAYS UNDER THE INTERNAL ONE, as
                        a separate fact (the brief, point 1).
                      */}
                      <td className="px-4 py-5">
                        <PilotBadge variant={STATUS_BADGE_VARIANT[item.status]}>
                          {serviceJobStatusLabel[item.status]}
                        </PilotBadge>
                        <p className="mt-2 text-xs text-pilot-grey-500">
                          A partner ezt látja: {item.partnerStatusLabel}
                        </p>
                      </td>
                      <td className="px-4 py-5">
                        <span className="whitespace-nowrap rounded-full bg-pilot-grey-100 px-3 py-1 text-xs text-pilot-grey-700">
                          {item.worksheetCount} munkalap
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-5 text-xs text-pilot-grey-600">
                        {formatDateTime(item.createdAt)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pilot-grey-100 px-4 py-3 text-xs text-pilot-grey-500">
            <span>
              {filtered.length} / {counts ? counts[tab] : filtered.length}{" "}
              {PILOT_TAB_NOUN[tab]}
            </span>
            {/*
              A VÁGÁS JELZÉSE MEGMARAD -- a lista nem lapoz (decision E10), és
              kimondja, ha több sor van, mint amennyit a szerver egy körben ad
              (`LIST_LIMIT` a repository-ban).
            */}
            {data.truncated ? (
              <span>
                Csak az első 200 hibajegy látszik ezen a fülön. Szűkítsd a
                keresést a további sorokhoz.
              </span>
            ) : null}
          </div>
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
