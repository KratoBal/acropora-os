"use client";
import {
  Alert,
  EmptyState,
  PageHeader,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
  PilotBadge,
  PilotButton,
  PilotCard,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type SeoLandingPage,
} from "@acropora/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { seoLandingPagesApi } from "@/lib/api/seo-landing-pages";
import { sortRows, type RowGetters } from "@/lib/navigation/sort-rows";
import { useUrlSort } from "@/lib/navigation/use-url-sort";

export const SEO_LANDING_LIST_PATH = "/admin/valogatasok";

export const SEO_LANDING_TABLE_MIN_WIDTH = 640;

/*
  A VÁLOGATÁS-LISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a válogatás címe (a szerkesztőre mutató link) a kártya címe, a többi oszlop a
  felirata mellett. A cím oszlop rugalmas, a többi fix; a frissítés dátuma nem törhet sorba.
*/
export const SEO_LANDING_COLUMNS: PilotTableColumn<SeoLandingPage>[] = [
  {
    id: "title",
    sortable: true,
    header: "Válogatás",
    cell: (page) => (
      <Link
        className="font-semibold text-brand-700"
        href={`${SEO_LANDING_LIST_PATH}/${page.id}`}
      >
        {page.title}
      </Link>
    ),
  },
  {
    id: "slug",
    sortable: true,
    header: "Cím a webshopban",
    width: "240px",
    cell: (page) => (
      <span className="break-all text-dusk-600">/hu/valogatas/{page.slug}</span>
    ),
  },
  {
    id: "status",
    sortable: true,
    header: "Állapot",
    width: "130px",
    cell: (page) => (
      <PilotBadge variant={page.isPublished ? "success" : "grey"}>
        {page.isPublished ? "Közzétéve" : "Vázlat"}
      </PilotBadge>
    ),
  },
  {
    id: "updated",
    sortable: true,
    header: "Frissítve",
    width: "130px",
    nowrap: true,
    cell: (page) => new Date(page.updatedAt).toLocaleDateString("hu-HU"),
  },
];

/**
 * A LISTA RENDEZÉSE (Balázs kérése, kártya 2f6369a4): a lista minden válogatást betölt, ezért a böngészőben rendezünk. A táblázat
 * oszlop-azonosítója -> az URL rendezési kulcsa; az "Állapot" a közzétett jelző szerint rendez (a vázlat előbb), a "Frissítve" időként.
 */
export const SEO_LANDING_SORT_COLUMNS = {
  title: "title",
  slug: "slug",
  status: "status",
  updated: "updated",
} as const;

export const SEO_LANDING_SORT_GETTERS: RowGetters<SeoLandingPage> = {
  title: (page) => page.title,
  slug: (page) => page.slug,
  status: (page) => (page.isPublished ? 1 : 0),
  updated: (page) => new Date(page.updatedAt),
};

/**
 * THE SEO LANDING PAGES (SEO P1-14): each one a curated product list at
 * `/hu/valogatas/{slug}` in the shop. The list shows the address and whether
 * it is published; editing is on the page itself.
 */
export function SeoLandingListPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const [pages, setPages] = useState<SeoLandingPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { sort, onSort } = useUrlSort(SEO_LANDING_SORT_COLUMNS);
  const sortedPages = useMemo(
    () => (pages ? sortRows(pages, sort, SEO_LANDING_SORT_GETTERS) : pages),
    [pages, sort],
  );

  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    seoLandingPagesApi
      .list(token, controller.signal)
      .then(setPages)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError")
          return;
        setError(
          cause instanceof Error
            ? cause.message
            : "A válogatások nem tölthetők be.",
        );
      });
    return () => controller.abort();
  }, [canView, token]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed"
        description="products.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webshop válogatások"
        description="Kiemelt termékválogatások saját címmel a webshopban: /hu/valogatas/…"
        actions={
          canManage ? (
            <Link href={`${SEO_LANDING_LIST_PATH}/new`}>
              <PilotButton>Új válogatás</PilotButton>
            </Link>
          ) : null
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A válogatások nem tölthetők be"
          description={error}
        />
      ) : null}
      {!pages && !error ? <Skeleton className="h-48" /> : null}
      {pages && !pages.length ? (
        <EmptyState
          title="Még nincs válogatás"
          description="Egy válogatás néhány kategória vagy márka termékeit mutatja saját címen."
        />
      ) : null}
      {pages && pages.length ? (
        <PilotCard>
          <PilotDataTable
            columns={SEO_LANDING_COLUMNS}
            sort={sort}
            onSort={onSort}
            rows={sortedPages ?? []}
            rowKey={(page) => page.id}
            rowTestId="seo-landing-row"
            minWidth={SEO_LANDING_TABLE_MIN_WIDTH}
          />
        </PilotCard>
      ) : null}
    </div>
  );
}
