"use client";

import {
  Alert,
  EmptyState,
  Icon,
  PageHeader,
  Pagination,
  Skeleton,
  PilotDataTable,
  PilotDateField,
  PilotSelect,
  type PilotTableColumn,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type WorksheetListResponse,
  type WorksheetSelectablePartner,
  type WorksheetVersionStatus,
  worksheetListLines,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceOfflineNotice } from "@/components/service/service-offline-notice";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  BULK_SELECTION_MAX,
  bulkSummary,
  pageSelection,
  toggleSelected,
  togglePage,
} from "../worksheet-bulk";
import { serviceJobRef } from "../service-job-ref";
import {
  formatDay,
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

/**
 * A sor második sora: a szám (ha a tárgy áll a fő sorban) és a verziók száma,
 * ha több van. Üres, ha egyik sincs: akkor a sor el is marad.
 */
function worksheetRowDetail(worksheet: {
  number: string | null;
  subject: string;
  versionCount: number;
}): string {
  return [
    worksheetListLines(worksheet).detail,
    worksheet.versionCount > 1 ? `${worksheet.versionCount} verzió` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

type WorksheetRow = WorksheetListResponse["items"][number];

/*
  A MUNKALAPLISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a munkalap tárgya a kártya címe, a többi oszlop a felirata mellett; a sor
  végi nyíl csak asztali jelzés. A fő sor a munkalap TÁRGYA, alatta a szám (Balázs, 2026-10-26
  12:48 UTC, OS szál, msg 1564259312728150148): mindenhol egyformán.
*/
/** A kijelölő pipa oszlopának szélessége (a `WORKSHEET_COLUMNS` mellé kerül, kártya a785e580). */
export const WORKSHEET_SELECT_COLUMN_WIDTH = 40;
/** A tábla legkisebb szélessége: a főág oszlopai (1140, a Megnyitva oszloppal, #2745) és a kijelölő oszlop. */
export const WORKSHEET_TABLE_MIN_WIDTH = 1140 + WORKSHEET_SELECT_COLUMN_WIDTH;

export const WORKSHEET_COLUMNS: PilotTableColumn<WorksheetRow>[] = [
  {
    id: "worksheet",
    header: "Munkalap",
    width: "260px",
    cell: (worksheet) => (
      <>
        <p className="break-words text-sm font-semibold text-pilot-grey-900">
          {worksheetListLines(worksheet).main}
        </p>
        {worksheetRowDetail(worksheet) ? (
          <p
            className={`mt-1 text-xs ${
              worksheet.number && worksheetListLines(worksheet).detail
                ? "font-mono text-pilot-grey-600"
                : "text-pilot-grey-500"
            }`}
          >
            {worksheetRowDetail(worksheet)}
          </p>
        ) : null}
        {worksheet.hidden ? (
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
    width: "220px",
    cell: (worksheet) => (
      <>
        <p className="break-words text-pilot-grey-900">
          {worksheet.customerName}
        </p>
        <p className="mt-1 break-words text-xs text-pilot-grey-500">
          {worksheet.departmentPath?.length
            ? worksheet.departmentPath.join(" / ")
            : worksheet.departmentCode}
        </p>
      </>
    ),
  },
  {
    id: "assignees",
    header: "Felelős",
    width: "140px",
    cell: (worksheet) =>
      worksheet.assigneeNames.length > 0 ? (
        <span className="text-pilot-grey-900">
          {worksheet.assigneeNames.join(", ")}
        </span>
      ) : (
        <span className="text-xs text-pilot-grey-400">Nincs kiosztva</span>
      ),
  },
  {
    id: "status",
    header: "Állapot",
    width: "130px",
    cell: (worksheet) => (
      <PilotBadge
        variant={worksheetDisplayPilotVariant(
          worksheet.status,
          worksheet.lineCount ?? 0,
        )}
      >
        {worksheetDisplayLabel(worksheet.status, worksheet.lineCount ?? 0)}
      </PilotBadge>
    ),
  },
  {
    id: "createdAt",
    // a megnyitás (létrehozás) napja, budapesti naptári nap (kártya a785e580, Luca 2026-11-19)
    header: "Megnyitva",
    width: "110px",
    nowrap: true,
    cell: (worksheet) => (
      <span className="text-pilot-grey-900">
        {formatDay(worksheet.createdAt)}
      </span>
    ),
  },
  {
    id: "hours",
    header: "Munkaóra",
    width: "100px",
    nowrap: true,
    cell: (worksheet) => (
      <span className="text-pilot-grey-900">
        {worksheetHoursCell(worksheet)}
      </span>
    ),
  },
  {
    id: "serviceJob",
    // a sorban hibajegy (HJ-) és karbantartási lap (KT-) száma is áll: a fejléc semleges
    header: "Jegy / lap",
    width: "110px",
    nowrap: true,
    cell: (worksheet) =>
      worksheet.serviceJob ? (
        <Link
          href={serviceJobRef(worksheet.serviceJob).href}
          onClick={(event) => event.stopPropagation()}
          className="font-mono text-xs text-pilot-aqua-700 hover:text-pilot-aqua-800"
        >
          {worksheet.serviceJob.jobNumber}
        </Link>
      ) : (
        <span className="text-pilot-grey-400">—</span>
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

/** A kapcsolt munka fajtájának szűrője: a `value` a `jobKind` kérés-paraméter, az üres a Mind. */
const JOB_KIND_FILTERS: readonly { label: string; value: string }[] = [
  { label: "Mind", value: "" },
  { label: "Hibajegyes", value: "REPAIR" },
  { label: "Karbantartási", value: "MAINTENANCE" },
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
  // a bepipált lapok azonosítói: a lapozás és a szűrés között is megmaradnak (kártya a785e580, 2. szelet)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<"download" | "print" | null>(null);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
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
  const activeJobKind = params.get("jobKind") ?? "";

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

  const pageIds = useMemo(
    () => (data?.items ?? []).map((worksheet) => worksheet.id),
    [data],
  );
  const pageState = pageSelection(selected, pageIds);
  const limitNote = `Legfeljebb ${BULK_SELECTION_MAX} munkalap jelölhető ki egyszerre.`;

  const toggleOne = (id: string) => {
    setBulkError(null);
    const result = toggleSelected(selected, id);
    setBulkNote(result.full ? limitNote : null);
    setSelected(result.selected);
  };

  const togglePageAll = () => {
    setBulkError(null);
    const result = togglePage(selected, pageIds);
    setBulkNote(result.full ? limitNote : null);
    setSelected(result.selected);
  };

  const columns = useMemo<PilotTableColumn<WorksheetRow>[]>(
    () => [
      {
        id: "select",
        header: (
          <span onClick={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              aria-label="Az oldal összes munkalapjának kijelölése"
              className="h-4 w-4 cursor-pointer"
              checked={pageState === "all"}
              ref={(input) => {
                if (input) input.indeterminate = pageState === "some";
              }}
              onChange={togglePageAll}
            />
          </span>
        ),
        width: `${WORKSHEET_SELECT_COLUMN_WIDTH}px`,
        phone: "hide",
        cell: (worksheet) => (
          <span
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              aria-label={`Kijelölés: ${worksheetListLines(worksheet).main}`}
              className="h-4 w-4 cursor-pointer"
              checked={selected.has(worksheet.id)}
              onChange={() => toggleOne(worksheet.id)}
            />
          </span>
        ),
      },
      ...WORKSHEET_COLUMNS,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageState, selected, pageIds],
  );

  /** A kijelölt lapok kiadott PDF-jei: letöltés zipben, vagy egy összefűzött PDF új lapon (nyomtatáshoz). */
  const runBulk = async (action: "download" | "print") => {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(action);
    setBulkNote(null);
    setBulkError(null);
    // a nyomtatáshoz az új lapot a kattintás pillanatában nyitjuk (a várakozás utáni megnyitást a böngésző tiltja)
    const printWindow = action === "print" ? window.open("", "_blank") : null;
    try {
      const result = await worksheetsApi.bulkSheets(
        token,
        [...selected],
        action === "download" ? "zip" : "merged",
      );
      const url = URL.createObjectURL(result.blob);
      if (action === "print" && printWindow) {
        printWindow.location.href = url;
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = result.fileName;
        document.body.appendChild(link);
        link.click();
        // removeChild: the confirm guard reads the element's own remove call as the api clients' delete method
        document.body.removeChild(link);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setBulkNote(
        bulkSummary({
          action,
          included: result.included,
          skipped: result.skipped,
          skippedNumbers: result.skippedNumbers,
        }) +
          (action === "print" && !printWindow
            ? " Az új lap nem nyílt meg (a böngésző letiltotta), ezért a PDF letöltődött."
            : ""),
      );
    } catch (cause) {
      printWindow?.close();
      setBulkError(
        cause instanceof Error
          ? cause.message
          : "A kijelölt munkalapok PDF-je nem készült el.",
      );
    } finally {
      setBulkBusy(null);
    }
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

  const createdFrom = params.get("createdFrom") ?? "";
  const createdTo = params.get("createdTo") ?? "";
  const hasFilters = Boolean(
    search ||
    params.get("customerId") ||
    activeJobKind ||
    createdFrom ||
    createdTo,
  );
  // a fordított tartomány a szerveren 400: itt előbb kimondjuk, mi a baj (a lista addig a hibaüzenetet mutatja)
  const reversedRange =
    Boolean(createdFrom && createdTo) && createdFrom > createdTo;

  return (
    <PilotThemeRoot
      bleed
      className={`flex min-h-screen flex-col gap-6 bg-pilot-grey-50 ${PAGE_GUTTER_X} py-8`}
    >
      <PageHeader
        eyebrow="Szerviz / Munkatér"
        title="Munkalapok"
        description="A helyszíni munka teljes életútja: kiosztás, tételek, napló, átadás és aláírás."
        actions={
          canManage ? (
            <Link href="/szerviz/munkalapok/uj">
              <PilotButton variant="primary" size="regular">
                <Icon name="plus" size={13} />
                Új munkalap
              </PilotButton>
            </Link>
          ) : null
        }
      />

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
            <PilotSelect
              value={params.get("customerId") ?? ""}
              onChange={(nextValue) => filter("customerId", nextValue)}
              className="max-w-[240px]"
              chevron
            >
              <option value="">Minden partner</option>
              {partners.map((partner) => (
                <option key={partner.customerId} value={partner.customerId}>
                  {partner.name}
                </option>
              ))}
            </PilotSelect>
          </label>
        ) : null}
        {/* A MEGNYITÁS NAPJÁNAK TÓL-IG SZŰRŐJE (kártya a785e580): mindkét határnap benne van, bármelyik elhagyható */}
        <div
          className="flex items-center gap-2 text-sm text-pilot-grey-700"
          role="group"
          aria-label="Megnyitás napja"
        >
          <span>Megnyitva</span>
          <PilotDateField
            aria-label="Megnyitva ettől a naptól"
            value={createdFrom}
            max={createdTo || undefined}
            onChange={(day) => {
              // gépelés közben a félig beírt nap üres értéket ad: az nem szűrőváltozás
              if (day !== createdFrom) filter("createdFrom", day);
            }}
            className="w-40"
          />
          <span aria-hidden="true">–</span>
          <PilotDateField
            aria-label="Megnyitva eddig a napig"
            value={createdTo}
            min={createdFrom || undefined}
            onChange={(day) => {
              if (day !== createdTo) filter("createdTo", day);
            }}
            className="w-40"
          />
          {reversedRange ? (
            <span role="alert" className="text-xs font-medium text-red-600">
              A kezdő dátum a záró dátum után van.
            </span>
          ) : null}
        </div>
        {/*
          A KAPCSOLT MUNKA FAJTÁJA (kártya 8219e7d6): a szűrést a szerver végzi (`jobKind`), a lista lapozott. A hibajegy nélküli (önálló) lap csak a Mind alatt áll.
        */}
        <div
          className="flex gap-1"
          role="group"
          aria-label="Kapcsolt munka fajtája"
        >
          {JOB_KIND_FILTERS.map((option) => (
            <PilotButton
              key={option.label}
              variant={activeJobKind === option.value ? "primary" : "secondary"}
              size="regular"
              aria-pressed={activeJobKind === option.value}
              onClick={() => filter("jobKind", option.value)}
            >
              {option.label}
            </PilotButton>
          ))}
        </div>
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
              // EGY lépésben: két `filter` hívás ugyanarra a kiindulásra építene, és az utolsó felülírná az elsőt
              const next = new URLSearchParams(params.toString());
              next.delete("customerId");
              next.delete("jobKind");
              next.delete("createdFrom");
              next.delete("createdTo");
              next.set("page", "1");
              router.replace(`${pathname}?${next}`);
            }}
            className="cursor-pointer text-xs text-pilot-grey-500 transition hover:text-pilot-grey-800"
          >
            Szűrők törlése
          </button>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div
          role="region"
          aria-label="Kijelölt munkalapok"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-pilot-aqua-500"
        >
          <span className="text-sm font-medium text-pilot-grey-900">
            {selected.size} munkalap kijelölve
          </span>
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={bulkBusy !== null}
            onClick={() => void runBulk("download")}
          >
            {bulkBusy === "download" ? "Készül…" : "Letöltés (zip)"}
          </PilotButton>
          <PilotButton
            variant="secondary"
            size="regular"
            disabled={bulkBusy !== null}
            onClick={() => void runBulk("print")}
          >
            {bulkBusy === "print" ? "Készül…" : "Nyomtatás"}
          </PilotButton>
          <button
            type="button"
            className="cursor-pointer text-xs text-pilot-grey-500 transition hover:text-pilot-grey-800"
            onClick={() => {
              setSelected(new Set());
              setBulkNote(null);
              setBulkError(null);
            }}
          >
            Kijelölés törlése
          </button>
        </div>
      ) : null}
      {bulkNote ? (
        <p role="status" className="text-sm text-pilot-grey-700">
          {bulkNote}
        </p>
      ) : null}
      {bulkError ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          {bulkError}
        </p>
      ) : null}

      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : data?.items.length ? (
        <PilotCard className="overflow-hidden">
          <PilotDataTable
            columns={columns}
            rows={data.items}
            rowKey={(worksheet) => worksheet.id}
            rowTestId="worksheet-row"
            minWidth={WORKSHEET_TABLE_MIN_WIDTH}
            onRowActivate={(worksheet) =>
              router.push(`/szerviz/munkalapok/${worksheet.id}`)
            }
            rowLabel={(worksheet) =>
              `${worksheetListLines(worksheet).main} megnyitása`
            }
            rowClassName={(worksheet) => (worksheet.hidden ? "opacity-50" : "")}
          />
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
