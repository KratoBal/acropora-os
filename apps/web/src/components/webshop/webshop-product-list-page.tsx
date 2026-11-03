"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  PilotDataTable,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type ProductListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { productApi } from "@/lib/api/products";

const PAGE_SIZE = 25;

function formatHuf(value: string | null): string {
  if (value === null) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} Ft`;
}

function formatStock(value: string | null): string {
  if (value === null) return "—";
  return Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 });
}

/**
 * The webshop's own view of the catalogue: the products carried on the shop,
 * with what the shop says about them.
 *
 * Narrowed by the listing, not by publication. A listing row is written for
 * every product the sync carries over; `isPublished` is nobody's to write yet
 * and is false on every row, so filtering on it would empty a shop full of
 * products. The channel's status is shown instead, raw - the repository
 * deliberately keeps that value unmapped, because its meaning is the shop's to
 * define and inventing one here would be a guess on screen.
 *
 * This is not the catalogue editor. /products keeps that job, with the barcode
 * editor and the filters that go with it.
 */
type ProductRow = ProductListResponse["items"][number];

export const PRODUCT_TABLE_MIN_WIDTH = 880;

/*
  A WEBSHOP-TERMÉKLISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a terméknév a kártya címe, a többi oszlop a felirata mellett (az ár, a készlet
  és a webshop-állapot nem tűnik el). A név oszlop rugalmas, a többi fix.

  A webshop státusza NYERSEN áll, szándékosan: a bolt státusz-kódjainak nincs megállapodott jelentése
  ebben a repóban, és a termékoldal ugyanazt az értéket ugyanígy mutatja. Egy itt kitalált felirat
  tényként olvasódna.
*/
export const PRODUCT_COLUMNS: PilotTableColumn<ProductRow>[] = [
  {
    id: "name",
    header: "Név",
    cell: (item) => (
      <span className="font-semibold text-dusk-900">
        <Link href={`/products/${item.id}`} className="hover:underline">
          {item.name}
        </Link>
        {item.isActive ? null : (
          <Badge className="ml-2" variant="warning">
            Inaktív
          </Badge>
        )}
      </span>
    ),
  },
  {
    id: "sku",
    header: "Cikkszám",
    width: "150px",
    cell: (item) => (
      <span className="font-mono text-xs text-dusk-600">
        {item.primarySku ?? "—"}
      </span>
    ),
  },
  {
    id: "price",
    header: "Bruttó ár",
    width: "170px",
    nowrap: true,
    cell: (item) => (
      <>
        {formatHuf(item.saleGrossPrice ?? item.grossPrice)}
        {item.saleGrossPrice ? (
          <span className="ml-2 text-xs text-dusk-400 line-through">
            {formatHuf(item.grossPrice)}
          </span>
        ) : null}
      </>
    ),
  },
  {
    id: "stock",
    header: "Készlet",
    width: "110px",
    cell: (item) => formatStock(item.stockOnHand),
  },
  {
    id: "status",
    header: "Webshop státusz",
    width: "150px",
    cell: (item) => (
      <span className="font-mono text-xs text-dusk-600">
        {item.unasListing?.externalStatus ?? "—"}
      </span>
    ),
  },
  {
    id: "open",
    header: "Megnyitás",
    width: "120px",
    cell: (item) =>
      item.unasListing?.productUrl ? (
        <a
          href={item.unasListing.productUrl}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline"
        >
          Webshopban
        </a>
      ) : (
        "—"
      ),
  },
];

export function WebshopProductListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");

  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const token = session?.token ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const searchParam = params.get("search") ?? "";

  const query = useMemo(
    () => ({
      listedOn: "UNAS" as const,
      page,
      pageSize: PAGE_SIZE,
      ...(searchParam ? { search: searchParam } : {}),
    }),
    [page, searchParam],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      setData(await productApi.list(token, query));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A terméklista nem tölthető be.",
      );
    } finally {
      setLoading(false);
    }
  }, [canView, query, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search === searchParam) return;
      const next = new URLSearchParams(params.toString());
      if (search) next.set("search", search);
      else next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search, searchParam]);

  const goToPage = (next: number) => {
    const query = new URLSearchParams(params.toString());
    query.set("page", String(next));
    router.replace(`${pathname}?${query}`);
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a termékekhez"
        description="products.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webshop termékek"
        description="A webshopban szereplő termékek. A teljes belső katalógus a Termékek menüpontban van, a vonalkódokkal és a szerkesztéssel együtt."
      />

      {error ? (
        <Alert
          variant="danger"
          title="Betöltési hiba"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      {loading && !data ? (
        <div aria-label="Termékek betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data ? (
        <>
          <Card className="p-4">
            <Input
              aria-label="Termék keresése"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Terméknév vagy cikkszám"
            />
          </Card>

          {data.items.length ? (
            <Card>
              <PilotDataTable
                columns={PRODUCT_COLUMNS}
                rows={data.items}
                rowKey={(item) => item.id}
                rowTestId="webshop-product-row"
                minWidth={PRODUCT_TABLE_MIN_WIDTH}
              />
            </Card>
          ) : (
            /*
              An empty screen has to say which of the two emptinesses it is.
              A search that matched nothing is one thing; a shop with no
              synchronised product at all is another, and that one is not the
              reader's doing - it means the sync has not carried anything over
              yet, and no amount of retyping will help.
            */
            <EmptyState
              title={
                searchParam
                  ? "Nincs találat erre a keresésre"
                  : "Egy termék sem szerepel a webshopban"
              }
              description={
                searchParam
                  ? "Próbáld más névvel vagy cikkszámmal. A lista csak a webshopban szereplő termékeket mutatja."
                  : "Ez a lista abból dolgozik, amit a UNAS szinkron áthozott. Ha a szinkron még nem futott le, a webshop tele lehet, ez a lista mégis üres. A szinkron állapota a Beállítások alatt, az UNAS résznél látszik."
              }
              action={
                searchParam ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch("");
                      router.replace(pathname);
                    }}
                  >
                    Keresés törlése
                  </Button>
                ) : undefined
              }
            />
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={data.pagination.page <= 1}
              onClick={() => goToPage(data.pagination.page - 1)}
            >
              Előző
            </Button>
            <span className="self-center text-sm">
              {data.pagination.page} / {Math.max(1, data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => goToPage(data.pagination.page + 1)}
            >
              Következő
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
