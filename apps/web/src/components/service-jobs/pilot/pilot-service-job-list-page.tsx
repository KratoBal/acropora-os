"use client";
import { Alert, Icon, Skeleton } from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListResponse,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
// A DÁTUMFORMÁZÓ A MUNKALAPOKNÁL ÉL, UGYANÚGY, MINT A MAI LISTÁN -- nem
// másolom ide, két formázó egy felületen előbb-utóbb két alakot adna
// ugyanarra az időpontra.
import { formatDateTime } from "@/components/worksheets/worksheet-labels";
import { serviceJobStatusLabel } from "../service-job-labels";
import {
  PilotAvatarStack,
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import {
  pilotItemsForTab,
  pilotTabCounts,
  pilotTabDef,
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

export function PilotServiceJobListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<PilotTab>("open");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [includeHidden, setIncludeHidden] = useState(false);
  const [partner, setPartner] = useState(ALL_PARTNERS);
  const [location, setLocation] = useState(ALL_LOCATIONS);
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
     magyarázat nélkül. */
  useEffect(() => {
    setPartner(ALL_PARTNERS);
    setLocation(ALL_LOCATIONS);
  }, [tab]);

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
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
        <div>
          <p className="mb-1 text-xs text-pilot-grey-400">
            Szerviz /{" "}
            <span className="font-medium text-pilot-grey-700">Hibajegyek</span>
          </p>
          <h1 className="text-xl font-semibold text-pilot-grey-900">
            Hibajegyek
          </h1>
        </div>
        {canManage ? (
          <Link href="/szerviz/hibajegyek/uj">
            <PilotButton variant="primary">
              <Icon name="plus" size={14} />
              Új hibajegy
            </PilotButton>
          </Link>
        ) : null}
      </div>

      <div className="border-b border-pilot-grey-100 bg-white px-8">
        <div className="flex gap-0">
          {PILOT_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`flex cursor-pointer items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-colors ${
                tab === entry.id
                  ? "border-pilot-aqua-600 text-pilot-aqua-700"
                  : "border-transparent text-pilot-grey-500 hover:text-pilot-grey-800"
              }`}
            >
              {entry.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  tab === entry.id
                    ? "bg-pilot-aqua-100 text-pilot-aqua-700"
                    : "bg-pilot-grey-100 text-pilot-grey-500"
                }`}
              >
                {counts ? counts[entry.id] : "…"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-pilot-grey-100 bg-white px-8 py-3">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Hibajegy keresése"
            placeholder="Hibajegy keresése…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-60 rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-pilot-grey-400">Partner:</span>
          <select
            aria-label="Partner szűrő"
            value={partner}
            onChange={(event) => setPartner(event.target.value)}
            className="cursor-pointer appearance-none rounded-md py-1.5 pl-2.5 pr-6 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          >
            <option>{ALL_PARTNERS}</option>
            {partnerOptions.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-pilot-grey-400">Helyszín:</span>
          <select
            aria-label="Helyszín szűrő"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className="cursor-pointer appearance-none rounded-md py-1.5 pl-2.5 pr-6 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          >
            <option>{ALL_LOCATIONS}</option>
            {locationOptions.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {/* A JELÖLŐ CSAK ANNAK LÁTSZIK, aki vissza is tudja állítani a
            rejtett jegyeket -- ugyanaz a szabály, mint a mai listán. */}
        {canHide ? (
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-pilot-grey-600">
            <button
              type="button"
              onClick={() => setIncludeHidden((current) => !current)}
              className={`relative h-4 w-8 cursor-pointer rounded-full transition-colors ${
                includeHidden ? "bg-pilot-aqua-600" : "bg-pilot-grey-200"
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                  includeHidden ? "left-4" : "left-0.5"
                }`}
              />
            </button>
            Rejtettek is
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="px-8 py-4">
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
        </div>
      ) : null}

      {loading && !data ? (
        <div aria-label="Hibajegyek betöltése" className="space-y-3 px-8 py-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data && filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
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
        </div>
      ) : null}

      {data && filtered.length > 0 ? (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100 bg-white">
                {[
                  "Hibajegy",
                  "Partner",
                  "Helyszín",
                  "Állapot",
                  "Delegálva",
                  "Munkalap",
                  "Létrehozva",
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
              {filtered.map((item, index) => (
                <tr
                  key={item.id}
                  onClick={() => router.push(`/szerviz/hibajegyek/${item.id}`)}
                  className={`group cursor-pointer border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                    index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                  } ${item.hidden ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-pilot-grey-400">
                      {item.jobNumber}
                    </p>
                    <p className="mt-0.5 max-w-[260px] truncate text-sm font-medium text-pilot-grey-900 transition-colors group-hover:text-pilot-aqua-700">
                      {item.title}
                    </p>
                    {item.hidden ? (
                      <PilotBadge variant="amber">Rejtett</PilotBadge>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-600">
                    {item.customerName ?? "Nincs megadva"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {item.departmentPath?.length ? (
                      <>
                        {item.departmentCode ? (
                          <span className="font-mono text-xs text-pilot-grey-400">
                            {item.departmentCode}
                          </span>
                        ) : null}
                        <span className="ml-1 text-xs text-pilot-grey-500">
                          {item.departmentCode ? "· " : ""}
                          {item.departmentPath[item.departmentPath.length - 1]}
                        </span>
                      </>
                    ) : (
                      <span className="text-pilot-grey-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <PilotBadge variant={STATUS_BADGE_VARIANT[item.status]}>
                      {serviceJobStatusLabel[item.status]}
                    </PilotBadge>
                  </td>
                  <td className="px-4 py-3">
                    <PilotAvatarStack people={item.assignees} />
                  </td>
                  <td className="px-4 py-3 text-xs text-pilot-grey-500">
                    {item.worksheetCount > 0 ? (
                      `${item.worksheetCount} munkalap`
                    ) : (
                      <span className="text-pilot-grey-300">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-500">
                    {formatDateTime(item.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/*
            A VÁGÁS JELZÉSE MEGMARAD -- a mai lista is megmondja, ha van
            több sor, mint amennyit a szerver egy körben ad
            (`ServiceListFooter`, `LIST_LIMIT` a repository-ban).
          */}
          {data.truncated ? (
            <p className="border-t border-pilot-grey-100 bg-white px-4 py-2 text-xs text-pilot-grey-400">
              Csak az első 200 hibajegy látszik ezen a fülön. Szűkítsd a
              keresést a további sorokhoz.
            </p>
          ) : null}
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}
