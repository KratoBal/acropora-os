"use client";
import {
  Alert,
  Icon,
  PageHeader,
  Pagination,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
  PAGE_GUTTER_X,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AquariumListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { aquariumsApi } from "@/lib/api/aquariums";
import { sortFromParams, useUrlSort } from "@/lib/navigation/use-url-sort";
import {
  ownershipLabel,
  WATER_BODY_LABEL,
  WATER_TYPE_LABEL,
} from "../aquarium-labels";
import {
  PilotAvatar,
  PilotBadge,
  PilotButton,
  PilotSelect,
  PilotThemeRoot,
  pilotAvatarColor,
  pilotInitials,
} from "@/components/pilot/pilot-ui";

const lastMeasuredFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const litersFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 0,
});

type AquariumRow = AquariumListResponse["items"][number];

/*
  A TÁBLA 1440 PX-EN GÖRGETÉS NÉLKÜL ELFÉR (Picasso 3.15, acrobot 62134): a minimum 1240 volt, a tartalom szélessége 1440 px-en 1216, ezért a tábla vízszintesen görgetett, és az
  "Utolsó vízmérés" oszlop a képernyő szélén, jobb oldali margó nélkül állt. A Név és az Ügyfél oszlop 20-20 px-szel keskenyebb (a hosszú név úgyis két sorba tör).
*/
export const AQUARIUM_TABLE_MIN_WIDTH = 1200;

/** A lista rendezhető oszlopai: a táblázat oszlop-azonosítója -> a szerver rendezési mezeje (`AQUARIUM_LIST_SORT_FIELDS`). */
export const AQUARIUM_SORT_COLUMNS = {
  name: "name",
  customer: "customerName",
  liters: "systemVolumeLiters",
} as const;

/**
 * A kérés az oldal URL-jéből. Az oldal az URL paramétereit továbbadja az API-nak, ezért a rendezés CSAK akkor marad benne, ha ismert
 * mezőre és érvényes irányra szól: egy régi vagy kézzel írt link ne törje el a listát 400-zal.
 */
export function aquariumListQuery(params: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(params.toString());
  q.delete("sort");
  q.delete("direction");
  const sort = sortFromParams(params, AQUARIUM_SORT_COLUMNS);
  if (sort) {
    q.set(
      "sort",
      AQUARIUM_SORT_COLUMNS[sort.id as keyof typeof AQUARIUM_SORT_COLUMNS],
    );
    q.set("direction", sort.direction);
  }
  if (!q.has("page")) q.set("page", "1");
  if (!q.has("pageSize")) q.set("pageSize", "25");
  return q;
}

/*
  AZ AKVÁRIUMLISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: az akvárium neve a kártya címe (alatta a száma), a többi oszlop a felirata
  mellett. Az "Utolsó vízmérés" és a "Liter" nem törhet sorba (a stage-fotón a dátum a kártya szélén
  levágva állt).
*/
export const AQUARIUM_COLUMNS: PilotTableColumn<AquariumRow>[] = [
  {
    id: "name",
    sortable: true,
    header: "Név",
    width: "180px",
    cell: (item) => (
      <>
        <span className="font-medium text-pilot-grey-900">{item.name}</span>
        <div className="text-xs font-normal text-pilot-grey-500">
          {item.aquariumNumber}
        </div>
      </>
    ),
  },
  {
    id: "ownership",
    header: "Tulajdon",
    width: "120px",
    cell: (item) => (
      <PilotBadge variant={item.ownershipType === "OWN" ? "teal" : "grey"}>
        {ownershipLabel(item)}
      </PilotBadge>
    ),
  },
  {
    id: "customer",
    sortable: true,
    header: "Ügyfél",
    width: "150px",
    cell: (item) => (
      <span className="text-pilot-grey-500">{item.customerName ?? "—"}</span>
    ),
  },
  {
    id: "waterBody",
    header: "Típus",
    width: "110px",
    cell: (item) => (
      <span className="text-pilot-grey-600">
        {WATER_BODY_LABEL[item.waterBodyType]}
      </span>
    ),
  },
  {
    id: "water",
    header: "Víz",
    width: "100px",
    cell: (item) =>
      item.waterType ? (
        <span className="text-pilot-grey-600">
          {WATER_TYPE_LABEL[item.waterType]}
        </span>
      ) : (
        <span className="text-pilot-grey-300">—</span>
      ),
  },
  {
    id: "liters",
    sortable: true,
    header: "Liter",
    width: "110px",
    align: "right",
    nowrap: true,
    cell: (item) => (
      <span className="font-mono tabular-nums text-pilot-grey-700">
        {item.systemVolumeLiters != null
          ? `${litersFormatter.format(item.systemVolumeLiters)} l`
          : "—"}
      </span>
    ),
  },
  {
    id: "equipment",
    header: "Berendezések",
    width: "120px",
    cell: (item) => (
      <span className="text-pilot-grey-500">{item.equipmentCount}</span>
    ),
  },
  {
    id: "maintainers",
    header: "Karbantartók",
    width: "140px",
    cell: (item) => (
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
    ),
  },
  {
    id: "lastMeasured",
    header: "Utolsó vízmérés",
    width: "170px",
    nowrap: true,
    cell: (item) => (
      <span className="text-pilot-grey-500">
        {item.lastMeasuredAt ? (
          lastMeasuredFormatter.format(new Date(item.lastMeasuredAt))
        ) : (
          <span className="italic text-pilot-grey-300">nincs</span>
        )}
      </span>
    ),
  },
];

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- LISTA KÉPERNYŐ.
 *
 * Balázs döntése (2026-09-24 18:14 UTC, Eldöntendő szál, message_id
 * 1552714695515840575), szó szerint: "és a figma lesz a default, leveheted
 * a Mai felület választót és használd a figmat." A korábbi, egymás melletti
 * "mai"/"kísérleti" váltó (`PilotToggle`) és a régi `AquariumListPage`
 * ezért TÖRÖLVE -- ez a komponens az EGYETLEN, ami az `/akvariumok`
 * útvonalon fut.
 *
 * A "KARBANTARTÓK" ÉS "UTOLSÓ VÍZMÉRÉS" OSZLOP MÁR TELJES (acrobot kérése,
 * 2026-09-24 16:19): a lista-végpont (`AquariumSummary`) mostantól
 * soronként adja ezt is, két BATCH-ELT (nem soronkénti) lekérdezéssel --
 * lásd `AquariumsRepository`-ban a `listInclude` fejlécét.
 *
 * A "TÍPUS" SZŰRŐ ÚJ: a mai lista csak tulajdon szerint szűr. A
 * `waterBodyType` viszont MEGLÉVŐ mező minden akváriumon, a szűrés hozzáadása
 * a listaLekérdezéshez ugyanaz a minta, mint az `ownershipType`-nál --- ez
 * NEM kitalált adat, csak egy már létező mezőre írt új szűrő.
 */
export function PilotAquariumListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<AquariumListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_MANAGE),
  );
  const token = session?.token ?? "";
  const { sort, onSort } = useUrlSort(AQUARIUM_SORT_COLUMNS);
  const query = useMemo(() => aquariumListQuery(params), [params]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await aquariumsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az akvárium-lista nem tölthető be.",
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
    const timer = window.setTimeout(() => {
      if (search === (params.get("search") ?? "")) return;
      const next = new URLSearchParams(params.toString());
      search ? next.set("search", search) : next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search]);
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
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
        title="Nincs hozzáférésed az akváriumokhoz"
        description="aquariums.view jogosultság szükséges."
      />
    );

  return (
    <PilotThemeRoot
      bleed
      className="flex min-h-screen flex-col bg-pilot-grey-50"
    >
      <PageHeader
        className={`${PAGE_GUTTER_X} pb-5 pt-6`}
        title="Akváriumok"
        description={
          data ? `${data.pagination.totalItems} bejegyzés összesen` : " "
        }
        actions={
          canManage ? (
            <Link href="/akvariumok/uj">
              <PilotButton variant="primary">
                <Icon name="plus" size={14} />
                Új akvárium
              </PilotButton>
            </Link>
          ) : undefined
        }
      />

      <div
        className={`flex flex-wrap items-center gap-4 border-b border-pilot-grey-100 bg-white ${PAGE_GUTTER_X} py-4`}
      >
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Akvárium keresése"
            placeholder="Keresés neve vagy ügyfél alapján…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-72 rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
        {/* SZEGMENTÁLT SZŰRŐK HELYETT LEGÖRDÜLŐK (Picasso 3.15): a többi lista így szűr; ugyanazok az URL-szűrők (ownershipType, waterBodyType), ugyanazok az értékek */}
        <PilotSelect
          chevron
          aria-label="Tulajdon"
          value={params.get("ownershipType") ?? ""}
          onChange={(value) => filter("ownershipType", value)}
          className="w-full shrink-0 sm:w-[160px]"
        >
          <option value="">Minden tulajdon</option>
          <option value="OWN">Saját</option>
          <option value="CUSTOMER">Ügyfél</option>
        </PilotSelect>
        <PilotSelect
          chevron
          aria-label="Típus"
          value={params.get("waterBodyType") ?? ""}
          onChange={(value) => filter("waterBodyType", value)}
          className="w-full shrink-0 sm:w-[160px]"
        >
          <option value="">Minden típus</option>
          <option value="AKVARIUM">Akvárium</option>
          <option value="TO">Tó</option>
        </PilotSelect>
      </div>

      {error ? (
        <div className={`${PAGE_GUTTER_X} py-4`}>
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
        <div
          aria-label="Akváriumok betöltése"
          className={`space-y-3 ${PAGE_GUTTER_X} py-6`}
        >
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
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
                ? "Módosítsd a szűrőket."
                : "Adj hozzá egy akváriumot, és itt láthatod az összes nyilvántartott példányt."}
            </p>
          </div>
          {canManage && !data.pagination.totalItems ? (
            <Link href="/akvariumok/uj">
              <PilotButton variant="primary">
                <Icon name="plus" size={14} />
                Új akvárium
              </PilotButton>
            </Link>
          ) : data.pagination.totalItems ? (
            <PilotButton
              variant="secondary"
              onClick={() => router.replace(pathname)}
            >
              Szűrők törlése
            </PilotButton>
          ) : null}
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          {/*
            A "VÍZ" OSZLOP (2026-09-25, terv-összevetés): a terv a "Típus"
            (akvárium/tó) mellett egy külön oszlopot ad a víztípusnak
            (tengeri/édesvízi) is -- ez az adat eddig csak az adatlapon volt
            elérhető (`AquariumDetail.waterType`), a listaválasz nem hozta.
          */}
          <div className="flex-1">
            <PilotDataTable
              sort={sort}
              onSort={onSort}
              columns={AQUARIUM_COLUMNS}
              rows={data.items}
              rowKey={(item) => item.id}
              rowTestId="aquarium-row"
              minWidth={AQUARIUM_TABLE_MIN_WIDTH}
              onRowActivate={(item) => router.push(`/akvariumok/${item.id}`)}
              rowLabel={(item) => `${item.name} megnyitása`}
            />
          </div>
          <div className="flex justify-end border-t border-pilot-grey-100 bg-white px-4 py-2">
            <Pagination
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={goToPage}
            />
          </div>
        </>
      ) : null}
    </PilotThemeRoot>
  );
}
