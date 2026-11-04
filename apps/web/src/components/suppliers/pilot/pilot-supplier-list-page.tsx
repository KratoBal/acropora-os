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
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

type SupplierRow = SupplierListResponse["items"][number];

export const SUPPLIER_TABLE_MIN_WIDTH = 950;

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
    id: "contact",
    header: "Ügyintéző",
    width: "150px",
    cell: (item) => (
      <span className="text-pilot-grey-700">
        {item.contactPersonName ?? (
          <span className="text-pilot-grey-300">—</span>
        )}
      </span>
    ),
  },
  {
    id: "reach",
    header: "Elérhetőség",
    width: "190px",
    cell: (item) => (
      <>
        {item.email ? (
          <p className="break-all text-xs text-pilot-grey-700">{item.email}</p>
        ) : null}
        {item.phone ? (
          <p className="text-xs text-pilot-grey-500">{item.phone}</p>
        ) : null}
        {!item.email && !item.phone ? (
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
  const query = useMemo(() => {
    const q = new URLSearchParams(params.toString());
    if (!q.has("page")) q.set("page", "1");
    if (!q.has("pageSize")) q.set("pageSize", "25");
    return q;
  }, [params]);
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
              : "A beszállítólista nem tölthető be.",
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

  return (
    <PilotThemeRoot bleed>
      <div className="flex min-h-full flex-col">
        <PageHeader
          className={`${PAGE_GUTTER_X} pt-6`}
          title="Partnerek"
          description="Beszállítói törzsadatok: elérhetőség, bankszámla és kapcsolattartó."
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
            <div className="flex flex-wrap items-center gap-3 p-5">
              <PilotInput
                aria-label="Beszállító keresése"
                value={search}
                onChange={setSearch}
                placeholder="Név, kód, adószám, ügyintéző"
              />
              <PilotSelect
                aria-label="Státusz"
                value={params.get("status") ?? "ACTIVE"}
                onChange={(value) => filter("status", value)}
              >
                <option value="ACTIVE">Aktív</option>
                <option value="INACTIVE">Inaktív</option>
                <option value="ALL">Mind</option>
              </PilotSelect>
              {/* "Mind" is the absence of the parameter rather than a third
                  value: a partner can be both kinds at once, so SUPPLIER and
                  SERVICE are not a partition and an "ALL" value would suggest
                  they are. */}
              <PilotSelect
                aria-label="Partner típusa"
                value={params.get("kind") ?? ""}
                onChange={(value) => filter("kind", value)}
              >
                <option value="">Mind</option>
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
                  columns={SUPPLIER_COLUMNS}
                  rows={data.items}
                  rowKey={(item) => item.id}
                  rowTestId="supplier-row"
                  minWidth={SUPPLIER_TABLE_MIN_WIDTH}
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
                    : "Nincsenek beszállítók"
                }
                description="Módosítsd a szűrőket vagy rögzíts új beszállítót."
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
