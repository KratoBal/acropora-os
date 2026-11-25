"use client";
import {
  Alert,
  EmptyState,
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
  type SupplierListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { suppliersApi } from "@/lib/api/suppliers";
import { sortFromParams, useUrlSort } from "@/lib/navigation/use-url-sort";
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

type SupplierRow = SupplierListResponse["items"][number];

export const SUPPLIER_TABLE_MIN_WIDTH = 870;
export const SUPPLIER_TABLE_MIN_WIDTH_WITHOUT_CONTACT = 610;

/*
  A PARTNERLISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a partner neve a kártya címe (a Kód oszlop marad az első, ahogy volt), a többi oszlop a
  felirata mellett.

  The four-character code, not the internal `SZALL-20260731-204153-07DA` identifier: this column is
  read by people, and it is the one that appears on the worksheet number. A service partner without
  one is marked rather than left blank: it cannot be offered on a worksheet until it has a code, so
  the gap is a task somebody has to finish. A partner we only buy from needs no code at all.
  Both labels (supplier, service) can show at once, because a partner can be both; a partner that
  is neither shows no label rather than a made-up one.
*/
export const SUPPLIER_COLUMNS: PilotTableColumn<SupplierRow>[] = [
  {
    id: "code",
    sortable: true,
    header: "Kód",
    width: "110px",
    cell: (item) => (
      <span className="font-mono text-xs text-pilot-grey-900">
        {item.worksheetPartnerCode ??
          (item.isService ? (
            <PilotBadge variant="amber">Nincs kód</PilotBadge>
          ) : (
            <span className="text-pilot-grey-300">—</span>
          ))}
      </span>
    ),
  },
  {
    id: "name",
    sortable: true,
    header: "Név",
    width: "280px",
    phone: "title",
    cell: (item) => (
      <>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-pilot-grey-900">{item.name}</span>
          {item.isSupplier ? (
            <PilotBadge variant="blue">Beszállító</PilotBadge>
          ) : null}
          {item.isService ? (
            <PilotBadge variant="amber">Szerviz</PilotBadge>
          ) : null}
        </div>
        {item.taxNumber ? (
          <p className="mt-0.5 text-xs text-pilot-grey-400">{item.taxNumber}</p>
        ) : null}
      </>
    ),
  },
  {
    id: "country",
    sortable: true,
    header: "Ország",
    width: "130px",
    cell: (item) => (
      <>
        <p className="font-medium text-pilot-grey-900">{item.country}</p>
        {item.city ? (
          <p className="text-xs text-pilot-grey-400">{item.city}</p>
        ) : null}
      </>
    ),
  },
  {
    // AZ ÜGYINTÉZŐ ÉS AZ ELÉRHETŐSÉG EGY OSZLOP (Picasso 3.6, acrobot 61991): két oszlop volt, és tíz sorból kilencben mindkettő "—". Egy cellában
    // a név (rendezhető), alatta az e-mail és a telefon; ha az oldal egyetlen sorában sincs semmi, az oszlop el is tűnik (`supplierColumnsFor`).
    id: "contact",
    sortable: true,
    header: "Kapcsolattartó",
    width: "260px",
    cell: (item) => (
      <>
        {item.contactPersonName ? (
          <p className="text-pilot-grey-900">{item.contactPersonName}</p>
        ) : null}
        {item.email ? (
          <p className="break-all text-xs text-pilot-grey-700">{item.email}</p>
        ) : null}
        {item.phone ? (
          <p className="text-xs text-pilot-grey-500">{item.phone}</p>
        ) : null}
        {!item.contactPersonName && !item.email && !item.phone ? (
          <span className="text-pilot-grey-300">—</span>
        ) : null}
      </>
    ),
  },
  {
    id: "status",
    header: "Státusz",
    width: "90px",
    cell: (item) => (
      <PilotBadge variant={item.isActive ? "teal" : "grey"}>
        {item.isActive ? "Aktív" : "Inaktív"}
      </PilotBadge>
    ),
  },
];

/**
 * A KAPCSOLATTARTÓ OSZLOP CSAK AKKOR ÁLL, HA VAN MIT MONDANIA (Picasso 3.6, acrobot 61991): ha az oldal egyetlen partnerének sincs ügyintézője,
 * e-mailje és telefonja, az oszlop minden sorban "—" lenne, és helyet visz. Üres oldalon a teljes oszlopkészlet marad.
 */
export function supplierColumnsFor(
  items: readonly SupplierRow[],
  /** A rendezett oszlop azonosítója: ha éppen a kapcsolattartóra rendez a lista, az oszlop marad (a rendezés-jelzővel), különben a felhasználó nem látná, mi szerint áll a lista (barracuda, #2913). */
  sortedBy?: string | null,
): PilotTableColumn<SupplierRow>[] {
  const noneHasContact =
    sortedBy !== "contact" &&
    items.length > 0 &&
    items.every(
      (item) => !item.contactPersonName && !item.email && !item.phone,
    );
  return noneHasContact
    ? SUPPLIER_COLUMNS.filter((column) => column.id !== "contact")
    : SUPPLIER_COLUMNS;
}

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- LISTA KÉPERNYŐ.
 *
 * Forrás: `exchange/figma-partnerek-make-13/src/PartnersScreen.tsx`
 * `PartnersListPage` (446-672. sor). Az adat, a szűrés, a lapozás és a
 * jogosultság a mai `SupplierListPage`-ből jön VÁLTOZATLANUL (URL-alapú
 * szűrők, debounce-olt keresés) -- csak a kártya-szerkezet és a stílus a
 * tervé, ahogy a brief kéri ("a kártyák és a sorrendjük... nem csak a
 * színek").
 *
 * A TERV "Demo" GOMBJAI (Betöltés/Hiba/Nincs jog kapcsolók) NEM KERÜLTEK
 * ÁT: azok a Make előnézet saját, mock-állapotváltói, nem valódi funkció --
 * a mai kód a VALÓDI betöltési/hiba/jogosultsági állapotot mutatja, ami
 * pontosan ugyanezt a három esetet fedi.
 *
 * EGY PAGINÁCIÓ, NEM KETTŐ: a terv a lapozót csak a táblázat ALATT adja,
 * a korábbi (nem pilot) `SupplierListPage` viszont a kártya tetején ÉS
 * alján is mutatta -- ez utóbbi itt megszűnt, a terv szerint.
 */
/** A lista rendezhető oszlopai: a táblázat oszlop-azonosítója -> a szerver rendezési mezeje (`SUPPLIER_LIST_SORT_FIELDS`). */
export const SUPPLIER_SORT_COLUMNS = {
  code: "code",
  name: "name",
  country: "country",
  contact: "contactPersonName",
} as const;

/**
 * A kérés az oldal URL-jéből. Az oldal az URL paramétereit továbbadja az API-nak, ezért a rendezés CSAK akkor marad benne, ha ismert
 * mezőre és érvényes irányra szól: egy régi vagy kézzel írt link ne törje el a listát 400-zal.
 */
export function supplierListQuery(params: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(params.toString());
  q.delete("sort");
  q.delete("direction");
  const sort = sortFromParams(params, SUPPLIER_SORT_COLUMNS);
  if (sort) {
    q.set(
      "sort",
      SUPPLIER_SORT_COLUMNS[sort.id as keyof typeof SUPPLIER_SORT_COLUMNS],
    );
    q.set("direction", sort.direction);
  }
  if (!q.has("page")) q.set("page", "1");
  if (!q.has("pageSize")) q.set("pageSize", "25");
  return q;
}

export function PilotSupplierListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<SupplierListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_MANAGE),
  );
  const token = session?.token ?? "";
  const { sort, onSort } = useUrlSort(SUPPLIER_SORT_COLUMNS);
  const query = useMemo(() => supplierListQuery(params), [params]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await suppliersApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A partnerlista nem tölthető be.",
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

  /**
   * Paging has to bypass `filter`: that helper ends by resetting the page
   * to 1 (correct for a filter change - page 4 of a different filter
   * usually does not exist), so paging through it sent every click back to
   * the first page and nothing past the first page was reachable at all.
   */
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };

  if (!canView)
    return (
      <PilotThemeRoot>
        <Alert
          variant="danger"
          title="Nincs hozzáférésed a partnerkezeléshez"
          description="partners.view jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  const tableColumns = supplierColumnsFor(data?.items ?? [], sort?.id);

  return (
    <PilotThemeRoot bleed>
      <div className="flex min-h-full flex-col">
        <PageHeader
          className={`${PAGE_GUTTER_X} pt-6`}
          title="Partnerek"
          description="Beszállítók és szerviz partnerek törzsadatai: kód, kapcsolattartó és elérhetőség."
          actions={
            canManage ? (
              <Link href="/partnerek/uj">
                <PilotButton type="button" variant="primary">
                  <Icon name="plus" size={14} />
                  Új felvitele
                </PilotButton>
              </Link>
            ) : null
          }
        />

        <div className={`flex flex-1 flex-col gap-4 ${PAGE_GUTTER_X} py-6`}>
          <PilotCard>
            <div className="flex flex-wrap items-center gap-3 p-4">
              {/* EGY SORBAN 1440 PX-EN (Picasso 3.6): a kereső legfeljebb 300 px, a két választó fix szélességű és nem zsugorodik; keskenyen tördel */}
              <div className="min-w-52 flex-[1_1_208px] sm:max-w-[300px]">
                <PilotInput
                  aria-label="Partner keresése"
                  value={search}
                  onChange={setSearch}
                  placeholder="Név, kód, adószám, ügyintéző"
                />
              </div>
              <PilotSelect
                chevron
                aria-label="Státusz"
                value={params.get("status") ?? "ACTIVE"}
                onChange={(value) => filter("status", value)}
                className="w-full shrink-0 sm:w-[150px]"
              >
                <option value="ACTIVE">Aktív</option>
                <option value="INACTIVE">Inaktív</option>
                <option value="ALL">Minden státusz</option>
              </PilotSelect>
              {/* "Mind" is the absence of the parameter rather than a third
                  value: a partner can be both kinds at once, so SUPPLIER and
                  SERVICE are not a partition and an "ALL" value would suggest
                  they are. */}
              <PilotSelect
                chevron
                aria-label="Partner típusa"
                value={params.get("kind") ?? ""}
                onChange={(value) => filter("kind", value)}
                className="w-full shrink-0 sm:w-[170px]"
              >
                <option value="">Minden típus</option>
                <option value="SUPPLIER">Beszállító</option>
                <option value="SERVICE">Szerviz</option>
              </PilotSelect>
            </div>
          </PilotCard>

          {error ? (
            <Alert
              variant="danger"
              title="Betöltési hiba"
              description={error}
              action={
                <PilotButton
                  type="button"
                  variant="secondary"
                  onClick={() => void load()}
                >
                  Újrapróbálás
                </PilotButton>
              }
            />
          ) : null}

          {loading && !data ? (
            <div aria-label="Partnerek betöltése" className="space-y-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-64" />
            </div>
          ) : null}

          {data ? (
            data.items.length ? (
              <PilotCard className="overflow-x-auto">
                <PilotDataTable
                  columns={tableColumns}
                  sort={sort}
                  onSort={onSort}
                  rows={data.items}
                  rowKey={(item) => item.id}
                  rowTestId="supplier-row"
                  minWidth={
                    tableColumns.length === SUPPLIER_COLUMNS.length
                      ? SUPPLIER_TABLE_MIN_WIDTH
                      : SUPPLIER_TABLE_MIN_WIDTH_WITHOUT_CONTACT
                  }
                  onRowActivate={(item) => router.push(`/partnerek/${item.id}`)}
                  rowLabel={(item) => `${item.name} megnyitása`}
                />
                <div className="flex items-center justify-between border-t border-pilot-grey-100 px-4 py-3">
                  <p className="text-xs text-pilot-grey-400">
                    {data.pagination.totalItems.toLocaleString("hu-HU")}{" "}
                    partnerből{" "}
                    {(
                      (data.pagination.page - 1) * data.pagination.pageSize +
                      1
                    ).toLocaleString("hu-HU")}
                    –
                    {Math.min(
                      data.pagination.page * data.pagination.pageSize,
                      data.pagination.totalItems,
                    ).toLocaleString("hu-HU")}{" "}
                    látható
                  </p>
                  {/*
                    "‹ ELŐZŐ" / SZÁMOZOTT GOMBOK / "KÖVETKEZŐ ›", A SAJÁT
                    TERVKÖR SZERINT (2026-09-25, acrobot döntése): a web
                    Partner lista terve (`PartnersScreen.tsx` 653-663.
                    sor) így adja, teal (aktív) gombbal -- ez a lista
                    saját mintája, nem a "prevNext" alapértelmezés.
                  */}
                  <Pagination
                    variant="numberedTeal"
                    page={data.pagination.page}
                    totalPages={data.pagination.totalPages}
                    onPageChange={goToPage}
                  />
                </div>
              </PilotCard>
            ) : (
              <EmptyState
                title={
                  data.pagination.totalItems
                    ? "Nincs találat"
                    : "Nincsenek partnerek"
                }
                description="Módosítsd a szűrőket vagy rögzíts új partnert."
                action={
                  data.pagination.totalItems ? (
                    <PilotButton
                      type="button"
                      variant="secondary"
                      onClick={() => router.replace(pathname)}
                    >
                      Szűrők törlése
                    </PilotButton>
                  ) : undefined
                }
              />
            )
          ) : null}
        </div>
      </div>
    </PilotThemeRoot>
  );
}
