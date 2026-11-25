"use client";
import {
  Alert,
  Icon,
  PageHeader,
  Skeleton,
  PilotDataTable,
  PilotDateField,
  Pagination,
  PilotSelect,
  type PilotTableColumn,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ServiceJobListFacets,
  type ServiceJobListResponse,
  type ServiceJobListSortField,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { serviceJobsApi } from "@/lib/api/service-jobs";
import { useUrlSort } from "@/lib/navigation/use-url-sort";
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
 * === LAPOZÁS, RENDEZÉS, FÜLEK ÉS SZŰRŐK A SZERVEREN (f0b70dbd, (b) kör) ===
 *
 * Eddig a lista a legújabb 200 sort kapta, és a fülek, a partner és a helyszín a betöltött soron szűrtek, tehát a fül száma és a
 * látható sorok eltérhettek. Mostantól MINDEN a szerveren megy: egy oldal 25 sor (`page`, `pageSize`), a fül az állapot-szűrő
 * (`statuses`), a partner és a helyszín az azonosítójukkal (`customerId`, `departmentId`), a rendezés a kód és a Létrehozva (`sort`,
 * `direction`). A legördülők opciói a szűrt halmaz partnerei és helyszínei (`/service/jobs/facets`), a saját szűrőjük nélkül.
 * A fül -> állapotok megfeleltetés EGY helyen áll (`PILOT_TABS` a view fájlban): ha a közös állapot-lista (D1) megváltozik, ott cserélődik.
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
  createdFrom: string;
  createdTo: string;
} {
  const tab = params.get("tab") as PilotTab | null;
  return {
    tab: tab && PILOT_TAB_VALUES.includes(tab) ? tab : "open",
    search: params.get("q") ?? "",
    includeHidden: params.get("hidden") === "1",
    partner: params.get("partner") || ALL_PARTNERS,
    location: params.get("location") || ALL_LOCATIONS,
    createdFrom: params.get("createdFrom") ?? "",
    createdTo: params.get("createdTo") ?? "",
  };
}

export function serviceJobListQuery(state: {
  tab: PilotTab;
  search: string;
  includeHidden: boolean;
  partner: string;
  location: string;
  createdFrom?: string;
  createdTo?: string;
}): string {
  const query = new URLSearchParams();
  if (state.tab !== "open") query.set("tab", state.tab);
  if (state.search.trim()) query.set("q", state.search.trim());
  if (state.includeHidden) query.set("hidden", "1");
  if (state.partner !== ALL_PARTNERS) query.set("partner", state.partner);
  if (state.location !== ALL_LOCATIONS) query.set("location", state.location);
  if (state.createdFrom) query.set("createdFrom", state.createdFrom);
  if (state.createdTo) query.set("createdTo", state.createdTo);
  return query.toString();
}

type JobRow = ServiceJobListResponse["items"][number];

/**
 * A LISTA OLDALMÉRETE ÉS RENDEZHETŐ OSZLOPAI (f0b70dbd, (b) kör). A lista szerveroldali lapozású: egy oldal 25 sor, a rendezés a szerveren
 * megy (az oszlop-azonosító -> `SERVICE_JOB_LIST_SORT_FIELDS`). Két oszlop rendezhető: a hibajegy (a kódja szerint) és a Létrehozva.
 * AZ ÁLLAPOT NEM, amíg Balázs a közös állapot-listáról nem dönt (D1): akkor a sorrend a folyamat sorrendje lesz, nem a felirat betűrendje.
 */
export const JOB_PAGE_SIZE = 25;
export const JOB_SORT_COLUMNS = {
  job: "jobNumber",
  createdAt: "createdAt",
} as const;

/** Az URL oldalszáma: pozitív egész, egyébként az első oldal (egy kézzel átírt érték nem üres listát ad). */
export function serviceJobListPageFromUrl(params: URLSearchParams): number {
  const page = Number(params.get("page"));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** Két lekérdezés-szöveg egyezése a kulcsok sorrendjétől függetlenül (az URL-t más író más sorrendben írhatja). */
function sameQuery(a: string, b: string): boolean {
  const canon = (query: string) =>
    Array.from(new URLSearchParams(query).entries())
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("&");
  return canon(a) === canon(b);
}

/*
  A HIBAJEGYLISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a
  tábla kártyalistává alakul (a hibajegy címe a kártya címe); a sor végi nyíl csak asztali jelzés.
  A cím tördelődik, a hibajegy száma alatta áll (a terv kétsoros címet rajzol, itt a hosszú cím a
  számot lejjebb tolja, nem fedi el).

  A TÁBLA 1440 PX-EN NEM FÉRT BELE A KÁRTYÁBA, MOSTANTÓL BELEFÉR (acrobot képe, 2026-11-03, stage 6f221c3d: az utolsó
  oszlop levágva, belső görgetéssel). A rögzített szélességek összege 1220 volt, a kártya 1440 px-en
  1152 (1440 - 224 oldalsáv - 2 x 32 lapszél), tehát a betűtípustól függetlenül görgetett. Mostantól
  a Hibajegy és a Partner oszlop kapja a maradékot (nincs rögzített szélességük), a rögzítettek
  összege 620, a tábla minimuma 980: ez még egy 1280 px-es képernyő 992 px-es kártyájába is belefér.
*/
export const JOB_TABLE_MIN_WIDTH = 980;

export const JOB_COLUMNS: PilotTableColumn<JobRow>[] = [
  {
    id: "job",
    header: "Hibajegy",
    sortable: true,
    cell: (item) => (
      <>
        {/*
          A HOSSZÚ CÍM LEGFELJEBB KÉT SOR (picasso, f0b70dbd, 4. pont): a teljes szöveg a `title` tooltipben áll, a végén "…". A cím az
          automatikus jegyeknél az eszköz kódját is tartalmazza; azt a listaelem nem hordozza külön mezőben, ezért itt nem szedjük szét.
        */}
        <p
          title={item.title}
          className="line-clamp-2 break-words font-semibold text-pilot-grey-900"
        >
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
      </>
    ),
  },
  {
    id: "customer",
    header: "Partner / helyszín",
    cell: (item) => (
      <>
        <p className="break-words text-pilot-grey-900">
          {item.customerName ?? "Nincs megadva"}
        </p>
        <p className="mt-1 break-words text-xs text-pilot-grey-500">
          {item.departmentPath?.length ? item.departmentPath.join(" / ") : "—"}
        </p>
      </>
    ),
  },
  {
    id: "assignees",
    header: "Felelős",
    width: "130px",
    cell: (item) => {
      const names = assigneeNames(item.assignees ?? []);
      return names ? (
        <span className="text-pilot-grey-900">{names}</span>
      ) : (
        <span className="text-xs text-pilot-grey-400">{NO_ASSIGNEE}</span>
      );
    },
  },
  // A PARTNER ÁLLAPOTA NEM áll a lista soraiban (picasso, f0b70dbd, 2. pont: mind a sorban ugyanazt mondta, zaj); az adatlapon marad.
  {
    id: "status",
    header: "Állapot",
    width: "190px",
    cell: (item) => (
      <>
        <PilotBadge variant={STATUS_BADGE_VARIANT[item.status]}>
          {serviceJobStatusLabel[item.status]}
        </PilotBadge>
      </>
    ),
  },
  {
    id: "worksheets",
    header: "Munkalap",
    width: "120px",
    nowrap: true,
    // A "0 munkalap" NEM JELVÉNY (picasso, f0b70dbd, 5. pont): ahol nincs munkalap, halvány kötőjel áll; csak a van munkalap kap jelvényt
    cell: (item) =>
      item.worksheetCount > 0 ? (
        <span className="rounded-full bg-pilot-grey-100 px-3 py-1 text-xs text-pilot-grey-700">
          {item.worksheetCount} munkalap
        </span>
      ) : (
        <span className="text-pilot-grey-300" aria-label="Nincs munkalap">
          —
        </span>
      ),
  },
  {
    id: "createdAt",
    header: "Létrehozva",
    sortable: true,
    width: "140px",
    nowrap: true,
    cell: (item) => (
      <span className="text-xs text-pilot-grey-600">
        {formatDateTime(item.createdAt)}
      </span>
    ),
  },
  {
    id: "open",
    header: "",
    width: "40px",
    phone: "hide",
    cell: () => (
      <Icon
        name="chevron-left"
        size={16}
        className="rotate-180 text-pilot-grey-500"
        aria-hidden="true"
      />
    ),
  },
];

/**
 * AZ URL-BŐL JÖVŐ PARTNER ÉS HELYSZÍN ELLENŐRZÉSE az első szűrő-lehetőségek ellen. Ismert azonosító: marad. Régi, NEVET hordozó érték:
 * a partner neve egyértelműen megadja az azonosítót; a helyszín régi értéke az útvonal volt ("Cápárium / Nagy medence"), ennek az utolsó
 * tagja egyértelműen egy lehetőség feliratának végére esik ("CAP · Nagy medence"). Ami így sem azonosítható, eldobódik (`dropped`),
 * és a lap kimondja, mert egy üres lista itt a hibát nyugtatónak mutatná.
 */
export function resolveUrlFilters(
  facets: ServiceJobListFacets,
  partner: string,
  location: string,
): { partner: string; location: string; dropped: boolean } {
  let dropped = false;
  let nextPartner = partner;
  if (
    partner !== ALL_PARTNERS &&
    !facets.partners.some((entry) => entry.id === partner)
  ) {
    const byName = facets.partners.filter((entry) => entry.name === partner);
    if (byName.length === 1) nextPartner = byName[0]!.id;
    else {
      nextPartner = ALL_PARTNERS;
      dropped = true;
    }
  }
  let nextLocation = location;
  if (
    location !== ALL_LOCATIONS &&
    !facets.locations.some((entry) => entry.id === location)
  ) {
    const leaf = location.split(" / ").pop() ?? location;
    const byLeaf = facets.locations.filter(
      (entry) => entry.label === leaf || entry.label.endsWith(` · ${leaf}`),
    );
    if (byLeaf.length === 1) nextLocation = byLeaf[0]!.id;
    else {
      nextLocation = ALL_LOCATIONS;
      dropped = true;
    }
  }
  return { partner: nextPartner, location: nextLocation, dropped };
}

/**
 * TELEFON-E A KÉPERNYŐ (639 px és alatta, a Tailwind `sm` alatt). Telefonon a szűrősorban csak a kereső és a "Továbbiak szűrők" gomb marad,
 * a partner- és helyszín-szűrő a gomb mögé kerül. Ahol nincs `matchMedia` (szerver, tesztkörnyezet), az asztali nézet áll.
 */
const PHONE_QUERY = "(max-width: 639px)";
function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () =>
      typeof window === "undefined" || !window.matchMedia
        ? false
        : window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * A LEGÖRDÜLŐ OPCIÓI A KIVÁLASZTOTT ÉRTÉKKEL: az opciók a fülre és a keresésre szűrtek, a kiválasztott partner vagy helyszín viszont lehet,
 * hogy azon a fülön nem szerepel (nincs ott hibajegye). Ilyenkor az ellenőrzés fül nélküli listájából kerül be, hogy a választó ne
 * mutasson üres vagy más értéket, miközben a szűrő él.
 */
function withChosen<T extends { id: string }>(
  options: readonly T[] | undefined,
  known: readonly T[] | undefined,
  chosen: string,
): T[] {
  const list = [...(options ?? [])];
  if (chosen === ALL_PARTNERS || list.some((entry) => entry.id === chosen))
    return list;
  const extra = known?.find((entry) => entry.id === chosen);
  return extra ? [...list, extra] : list;
}

/**
 * AZ ÜRES SZŰRT LISTA MONDATA: ha CSAK a partner (vagy CSAK a helyszín) szűr, a mondat kimondja, hogy az ő hibajegyei hiányoznak ezen a
 * fülön, nem azt, hogy más keresést kellene próbálni (acrobot 61769: egy érvényes partner üres listája nem hiba, és nem is a teljes lista).
 */
export function emptyFilterSentence(
  search: string,
  partnerFilter: boolean,
  locationFilter: boolean,
): string {
  if (!search && partnerFilter && !locationFilter)
    return "Ennek a partnernek ezen a fülön nincs hibajegye.";
  if (!search && locationFilter && !partnerFilter)
    return "Ezen a helyszínen ezen a fülön nincs hibajegy.";
  return "Próbálj más keresési feltételt.";
}

/** A lábléc sor-tartománya: "26–50 / 61" a lapozott válaszra, "7" a lapozatlanra. */
function pageRange(data: ServiceJobListResponse, page: number): string {
  if (!data.pagination) return String(data.items.length);
  const first = (page - 1) * data.pagination.pageSize + 1;
  return `${first}–${first + data.items.length - 1} / ${data.pagination.totalItems}`;
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
  const [createdFrom, setCreatedFrom] = useState(initial.createdFrom);
  const [createdTo, setCreatedTo] = useState(initial.createdTo);
  const reversedRange =
    Boolean(createdFrom && createdTo) && createdFrom > createdTo;
  const [data, setData] = useState<ServiceJobListResponse | null>(null);
  const [facets, setFacets] = useState<ServiceJobListFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /*
    A RÉGI URL-EK (Luca könyvjelzői): a partner és a helyszín régen NEVET hordozott, ma azonosítót. Egy ismeretlen érték üres listát adna,
    ami itt a hibát nyugtatónak mutatná. Ezért ha az URL-ből jön partner vagy helyszín, a lista kérése megvárja az első szűrő-lehetőségeket
    (`filtersChecked`), és ott az érték vagy átíródik azonosítóra (a név egyértelműen egy partnert, illetve egy helyszínt jelöl), vagy
    eldobódik, és a lap kimondja (`staleFilter`). CSAK AZ ELSŐ válaszra fut: később a lehetőségek a kereséssel szűkülnek, és egy
    gépeléssel nem szabad kidobni a kiválasztott partnert.
  */
  const [filtersChecked, setFiltersChecked] = useState(
    initial.partner === ALL_PARTNERS && initial.location === ALL_LOCATIONS,
  );
  const [staleFilter, setStaleFilter] = useState(false);
  const phone = usePhone();
  /* A "Továbbiak szűrők" panel nyitva indul, ha az URL már hordoz ilyen szűrőt: a szűrt lista ne tűnjön szűretlennek. */
  const [moreOpen, setMoreOpen] = useState(
    Boolean(initial.includeHidden || initial.createdFrom || initial.createdTo),
  );
  const checkedRef = useRef(filtersChecked);
  const [known, setKnown] = useState<ServiceJobListFacets | null>(null);
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
  const { scope, statuses: tabStatuses } = pilotTabDef(tab);
  const { sort, onSort, apiSort } = useUrlSort(JOB_SORT_COLUMNS);
  /*
    AZ OLDALSZÁM AZ URL-BŐL JÖN, DE EGY SZŰRŐVÁLTÁS AZ ELSŐ OLDALRA VISZ. A szűrő (fül, keresés, partner, helyszín, nap) helyi állapot,
    amit az effekt ír vissza az URL-be; amíg a kettő nem egyezik, szűrőváltás van folyamatban, és az oldal 1. Így a kérés EGYSZER megy
    el, az új szűrővel és az 1. oldallal, nem kétszer (előbb a régi oldalszámmal).
  */
  const stateQuery = serviceJobListQuery({
    tab,
    search: appliedSearch,
    includeHidden,
    partner,
    location,
    createdFrom,
    createdTo,
  });
  const urlQuery = serviceJobListQuery(serviceJobListStateFromUrl(params));
  const filtersSettled = stateQuery === urlQuery;
  const page = filtersSettled ? serviceJobListPageFromUrl(params) : 1;

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
      if (!canView || !filtersChecked) return;
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
            undefined,
            { from: createdFrom, to: createdTo },
            {
              page,
              pageSize: JOB_PAGE_SIZE,
              sort: apiSort?.sort as ServiceJobListSortField | undefined,
              direction: apiSort?.direction,
              statuses: tabStatuses,
              customerId: partner === ALL_PARTNERS ? undefined : partner,
              departmentId: location === ALL_LOCATIONS ? undefined : location,
            },
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
    [
      apiSort,
      appliedSearch,
      canView,
      createdFrom,
      createdTo,
      filtersChecked,
      includeHidden,
      location,
      page,
      partner,
      scope,
      tabStatuses,
      token,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /*
    AZ URL-BŐL JÖVŐ PARTNER ÉS HELYSZÍN ELLENŐRZÉSE, EGYSZER (acrobot 61769). Az érvényességet a FÜL- ÉS KERESÉS-NÉLKÜLI lehetőségekből
    döntjük el (minden hatókör, nincs állapot, nincs keresés, nincs nap), nem a fülre szűrtekből: egy érvényes partner, akinek az adott fülön
    nincs hibajegye, érvényes marad, és üres listát kap (nem a teljes listát egy másik partner jegyeivel az ő neve alatt). Az ellenőrzés
    lehetőségei a legördülőben is megmaradnak (`known`), hogy a kiválasztott partner akkor is látsszon, ha a fülön nincs.
  */
  useEffect(() => {
    if (!canView || checkedRef.current) return;
    const controller = new AbortController();
    serviceJobsApi
      .facets(token, "all", controller.signal, "", true, undefined, undefined)
      .then((all) => {
        checkedRef.current = true;
        const fixed = resolveUrlFilters(all, partner, location);
        setKnown(all);
        setPartner(fixed.partner);
        setLocation(fixed.location);
        if (fixed.dropped) setStaleFilter(true);
        setFiltersChecked(true);
      })
      .catch(() => {
        // az ellenőrzés hiánya nem akasztja a listát: az URL szűrője marad
        if (controller.signal.aborted) return;
        checkedRef.current = true;
        setFiltersChecked(true);
      });
    return () => controller.abort();
    // a partner és a helyszín szándékosan nincs a függésben: csak az ELSŐ válasznál számítanak (`checkedRef`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, token]);

  /*
    A SZŰRŐ-LEHETŐSÉGEK KÜLÖN KÉRÉS: a szűrt halmaz (keresés, fül, nap, rejtettek) partnerei és helyszínei, a partner- és helyszín-szűrő
    nélkül, hogy a kiválasztott partner mellett ne ő maradjon az egyetlen opció. Az oldalszám és a rendezés nem érinti.
  */
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    serviceJobsApi
      .facets(
        token,
        scope,
        controller.signal,
        appliedSearch,
        includeHidden,
        { from: createdFrom, to: createdTo },
        tabStatuses ?? undefined,
      )
      .then(setFacets)
      .catch(() => {
        // a szűrő-lehetőségek hiánya nem akasztja a listát: a legördülők csak a "Minden"-t kínálják
        if (!controller.signal.aborted)
          setFacets({ partners: [], locations: [] });
      });
    return () => controller.abort();
  }, [
    appliedSearch,
    canView,
    createdFrom,
    createdTo,
    includeHidden,
    scope,
    tabStatuses,
    token,
  ]);

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

  /*
    Az állapot visszaírása az URL-be, csak ha tényleg változott. A rendezés (`sort`, `direction`) és az oldalszám (`page`) NEM a helyi
    állapoté, hanem az URL-é: a visszaírás megtartja őket, az oldalszámot viszont csak akkor, ha a szűrők nem változtak (szűrőváltás az
    1. oldalra visz).
  */
  useEffect(() => {
    const next = new URLSearchParams(stateQuery);
    for (const key of ["sort", "direction"]) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    if (filtersSettled && page > 1) next.set("page", String(page));
    const nextQuery = next.toString();
    if (sameQuery(nextQuery, params.toString())) return;
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [filtersSettled, page, params, pathname, router, stateQuery]);

  /** Lapozás: csak az `page` kulcs változik; a szűrő- és rendezés-kulcsok maradnak. */
  const goToPage = (target: number) => {
    const next = new URLSearchParams(params.toString());
    if (target > 1) next.set("page", String(target));
    else next.delete("page");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  /* Ha a lista rövidült (törlés, másik szűrő), és az URL oldala már nincs, az utolsó oldalra visz, nem üres listára. */
  const lastPage = data?.pagination?.totalPages;
  const pageGone =
    data !== null &&
    data.items.length === 0 &&
    (data.pagination?.totalItems ?? 0) > 0 &&
    lastPage !== undefined &&
    page > lastPage;
  useEffect(() => {
    if (pageGone && lastPage !== undefined) goToPage(lastPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageGone, lastPage]);

  const counts = data ? pilotTabCounts(data.counts) : null;
  const hasActiveFilters =
    partner !== ALL_PARTNERS || location !== ALL_LOCATIONS;
  /*
    A "TOVÁBBIAK SZŰRŐK" GOMB SZÁMA: a panelben álló, éppen aktív szűrők. A létrehozás napjának tól-ig tartománya EGY szűrő (akkor is, ha
    mindkét határ ki van töltve), a "Rejtettek is" egy. Telefonon a partner és a helyszín is a panelben áll, ott ők is számítanak.
  */
  const moreCount =
    (createdFrom || createdTo ? 1 : 0) +
    (includeHidden ? 1 : 0) +
    (phone
      ? (partner !== ALL_PARTNERS ? 1 : 0) +
        (location !== ALL_LOCATIONS ? 1 : 0)
      : 0);
  // a fordított tartomány hibaüzenete a panelben áll: zárt panel mögött nem maradhat észrevétlen
  const moreVisible = moreOpen || reversedRange;

  const selectClass = phone ? "w-full" : "max-w-[240px]";
  const partnerSelect = (
    <PilotSelect
      aria-label="Partner szűrő"
      value={partner}
      onChange={(nextValue) => setPartner(nextValue)}
      className={selectClass}
      chevron
    >
      <option value={ALL_PARTNERS}>Minden partner</option>
      {withChosen(facets?.partners, known?.partners, partner).map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </PilotSelect>
  );
  const locationSelect = (
    <PilotSelect
      aria-label="Helyszín szűrő"
      value={location}
      onChange={(nextValue) => setLocation(nextValue)}
      className={selectClass}
      chevron
    >
      <option value={ALL_LOCATIONS}>Minden helyszín</option>
      {withChosen(facets?.locations, known?.locations, location).map(
        (entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ),
      )}
    </PilotSelect>
  );

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a hibajegyekhez"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot
      bleed
      className={`flex min-h-screen flex-col gap-6 bg-pilot-grey-50 ${PAGE_GUTTER_X} py-8`}
    >
      {/*
        THE HEADER OF THE SERVICE REDESIGN (Figma 423:20): eyebrow, title, one
        sentence on what the list is for, and the primary action at the right.
      */}
      <PageHeader
        eyebrow="Szerviz / Munkatér"
        title="Hibajegyek"
        // telefonon a három soros leírás nélkül: a lista első sora így 600 helyett kb. 440 px-nél kezdődik (mérve a stage-en, picasso terv 5. pont)
        description={
          phone
            ? undefined
            : "Minden bejelentésnek legyen következő lépése. A hibajegy a lánc első eleme; mögötte állnak a munkalapok."
        }
        actions={
          canManage ? (
            <Link href="/szerviz/hibajegyek/uj">
              <PilotButton variant="primary" size="regular">
                <Icon name="plus" size={14} />
                Új hibajegy
              </PilotButton>
            </Link>
          ) : undefined
        }
      />

      {/*
        THE STAT TILES come back (the redesign brief keeps them), from the
        server's counts only; see `pilotStatTiles` for what is left out.
      */}
      <div
        aria-label="Összesítés"
        className="grid grid-cols-3 gap-2 sm:gap-4 lg:max-w-[780px]"
      >
        {(data ? pilotStatTiles(data.counts) : []).map((tile) => (
          <PilotCard key={tile.key} className="px-3 py-3 sm:px-4 sm:py-4">
            <p className="text-xs text-pilot-grey-600 sm:text-sm">
              {tile.label}
            </p>
            <p className="mt-1 flex items-baseline gap-4 sm:mt-2">
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
                <span className="hidden text-xs text-pilot-grey-500 sm:inline">
                  {tile.detail}
                </span>
              ) : null}
            </p>
          </PilotCard>
        ))}
      </div>

      <div className="flex flex-wrap gap-0.5 sm:gap-1" role="tablist">
        {PILOT_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => selectTab(entry.id)}
            className={`cursor-pointer rounded-md px-2.5 py-2 text-sm transition-colors sm:px-4 ${
              tab === entry.id
                ? "bg-pilot-aqua-50 font-semibold text-pilot-aqua-700"
                : "text-pilot-grey-600 hover:text-pilot-grey-900"
            }`}
          >
            {entry.label}
            {/* A FÜL SZÁMA UGYANABBÓL A `counts`-BÓL, mint a csempék (egy függvény, két megjelenítés: pilotTabCounts) */}
            {counts ? (
              <span
                className={`ml-1.5 tabular-nums ${tab === entry.id ? "" : "text-pilot-grey-400"}`}
              >
                {counts[entry.id]}
              </span>
            ) : null}
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
          className="min-w-0 flex-[1_1_10rem] rounded-md bg-white px-3 py-2.5 sm:w-full sm:max-w-[390px] sm:flex-none text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-400 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        />
        {/*
          THE PARTNER AND LOCATION FILTERS are not in the design, but they exist today and stay (the brief: nothing working is lost).
          On the phone they move behind "Továbbiak szűrők" (the plan: only the search and that button stay in the row).
        */}
        {phone ? null : (
          <>
            {partnerSelect}
            {locationSelect}
          </>
        )}
        <button
          type="button"
          aria-expanded={moreVisible}
          aria-controls="service-job-more-filters"
          onClick={() => setMoreOpen((current) => !current)}
          className={`h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-md px-4 text-sm font-semibold ring-1 transition-colors ${
            moreCount > 0
              ? "bg-pilot-aqua-50 text-pilot-aqua-700 ring-pilot-aqua-200"
              : "bg-white text-pilot-grey-900 ring-pilot-grey-200 hover:bg-pilot-grey-50"
          }`}
        >
          Továbbiak szűrők{moreCount > 0 ? ` · ${moreCount}` : ""}
        </button>
      </div>
      {moreVisible ? (
        <div
          id="service-job-more-filters"
          className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 ring-1 ring-pilot-grey-200"
        >
          {phone ? (
            <>
              {partnerSelect}
              {locationSelect}
            </>
          ) : null}
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
          {/*
          A LÉTREHOZÁS NAPJÁNAK TÓL-IG SZŰRŐJE (Luca, 2026-11-20): a felirat kimondja, melyik dátumra szűr (a jegy létrehozására,
          ugyanaz, mint a Létrehozva oszlop), mindkét határnap benne van, bármelyik elhagyható. A szerver szűr, és a csempék száma
          is a szűrt listáé. A sor TÖRHET: 390 pixelen a két 160 pixeles mező a felirattal nem fér egy sorba (a munkalap-lista
          ugyanitt lógott ki, OS hibakör 2026-11-19).
        */}
          <div
            className="flex flex-wrap items-center gap-2 text-sm text-pilot-grey-700"
            role="group"
            aria-label="Létrehozás napja"
          >
            <span>Létrehozva</span>
            <PilotDateField
              aria-label="Létrehozva ettől a naptól"
              value={createdFrom}
              max={createdTo || undefined}
              onChange={(day) => {
                // gépelés közben a félig beírt nap üres értéket ad: az nem szűrőváltozás
                if (day !== createdFrom) setCreatedFrom(day);
              }}
              className="w-40"
            />
            <span aria-hidden="true">–</span>
            <PilotDateField
              aria-label="Létrehozva eddig a napig"
              value={createdTo}
              min={createdFrom || undefined}
              onChange={(day) => {
                if (day !== createdTo) setCreatedTo(day);
              }}
              className="w-40"
            />
            {reversedRange ? (
              <span role="alert" className="text-xs font-medium text-red-600">
                A kezdő dátum a záró dátum után van.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {staleFilter ? (
        <Alert
          variant="info"
          title="A régi szűrő nem érvényes, a teljes lista látszik"
          description="A hivatkozásban álló partner vagy helyszín nem azonosítható (nincs hibajegye), ezért nem szűr."
        />
      ) : null}

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
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-20" />
          ))}
        </div>
      ) : null}

      {data && data.items.length === 0 && !pageGone ? (
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
                ? emptyFilterSentence(
                    appliedSearch,
                    partner !== ALL_PARTNERS,
                    location !== ALL_LOCATIONS,
                  )
                : "Hozz létre egy új hibajegyet a bejelentett problémák nyomon követéséhez."}
            </p>
          </div>
          {appliedSearch || hasActiveFilters ? (
            <PilotButton
              variant="secondary"
              onClick={() => {
                setSearch("");
                setAppliedSearch("");
                setPartner(ALL_PARTNERS);
                setLocation(ALL_LOCATIONS);
              }}
            >
              Szűrők törlése
            </PilotButton>
          ) : null}
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

      {data && data.items.length > 0 ? (
        <PilotCard className="overflow-hidden">
          <PilotDataTable
            columns={JOB_COLUMNS}
            sort={sort}
            onSort={onSort}
            rows={data.items}
            rowKey={(item) => item.id}
            rowTestId="service-job-row"
            minWidth={JOB_TABLE_MIN_WIDTH}
            onRowActivate={(item) =>
              router.push(`/szerviz/hibajegyek/${item.id}`)
            }
            rowLabel={(item) => `${item.jobNumber} ${item.title} megnyitása`}
            rowClassName={(item) => (item.hidden ? "opacity-50" : "")}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pilot-grey-100 px-4 py-3 text-xs text-pilot-grey-500">
            <span>
              {/* a találatszám a SZŰRT halmazé (a szerver adja), a sor-tartomány az oldalé */}
              {pageRange(data, page)} {PILOT_TAB_NOUN[tab]}
            </span>
            {/* a régi, lapozatlan válasz vágott jelzése: a lapozott kérésnél nincs, de a szerver alakja még ismeri */}
            {data.truncated ? (
              <span>
                Csak az első 200 hibajegy látszik ezen a fülön. Szűkítsd a
                keresést a további sorokhoz.
              </span>
            ) : null}
          </div>
          {data.pagination && data.pagination.totalPages > 1 ? (
            <Pagination
              variant="directionF"
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={goToPage}
            />
          ) : null}
        </PilotCard>
      ) : null}
    </PilotThemeRoot>
  );
}
