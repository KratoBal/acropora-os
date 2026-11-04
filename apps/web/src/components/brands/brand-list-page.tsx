"use client";
import {
  Alert,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  PilotDataTable,
  type PilotTableColumn,
  Select,
  Skeleton,
  PilotButton,
  PilotBadge,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type BrandListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { brandsApi } from "@/lib/api/brands";
import { CatalogActionsPanel } from "./catalog-actions-panel";

type BrandRow = BrandListResponse["items"][number];

// The shared table: on the phone every row is a card with the brand as its title.
const columns: PilotTableColumn<BrandRow>[] = [
  {
    id: "name",
    header: "Márka",
    cell: (brand) => (
      <>
        <Link
          className="font-semibold text-brand-700"
          href={`/admin/brands/${brand.id}`}
        >
          {brand.name}
        </Link>
        <span className="block text-xs font-normal text-dusk-500">
          {brand.slug}
        </span>
      </>
    ),
  },
  {
    id: "status",
    header: "Státusz",
    cell: (brand) => (
      <PilotBadge variant={brand.isActive ? "success" : "grey"}>
        {brand.isActive ? "Aktív" : "Archivált"}
      </PilotBadge>
    ),
  },
  {
    id: "aliases",
    header: "Aliasok",
    cell: (brand) =>
      brand.aliases.map((alias) => alias.alias).join(", ") || "—",
  },
  {
    id: "products",
    header: "Termékek",
    cell: (brand) => brand.usage.productCount,
  },
  {
    id: "unas",
    header: "UNAS",
    cell: (brand) =>
      brand.externalMappings.some((mapping) => mapping.system === "UNAS")
        ? "Kapcsolva"
        : "—",
  },
  {
    id: "updated",
    header: "Frissítve",
    nowrap: true,
    cell: (brand) => new Date(brand.updatedAt).toLocaleDateString("hu-HU"),
  },
];

export function BrandListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<BrandListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  // the catalog operations are a settings-level action (as the Medusa connection)
  const canRunCatalogActions = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SETTINGS_MANAGE),
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
        setData(await brandsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A márkalista nem tölthető be.",
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
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a márkákhoz"
        description="products.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Márkák"
        description="Kanonikus márkaadatok, aliasok és UNAS megfeleltetések."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/brands/import-assistant">
              <PilotButton variant="secondary">Import asszisztens</PilotButton>
            </Link>
            {canManage ? (
              <Link href="/admin/brands/new">
                <PilotButton>Új márka</PilotButton>
              </Link>
            ) : null}
          </div>
        }
      />
      {canRunCatalogActions ? <CatalogActionsPanel token={token} /> : null}
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
        <div aria-label="Márkák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Input
                aria-label="Márka keresése"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Név, alias, slug"
              />
              <Select
                aria-label="Státusz"
                value={params.get("status") ?? "ACTIVE"}
                onChange={(event) => filter("status", event.target.value)}
              >
                <option value="ACTIVE">Aktív</option>
                <option value="ARCHIVED">Archivált</option>
                <option value="ALL">Mind</option>
              </Select>
              <Select
                aria-label="Forrás"
                value={params.get("source") ?? ""}
                onChange={(event) => filter("source", event.target.value)}
              >
                <option value="">Minden forrás</option>
                <option value="UNAS">UNAS</option>
                <option value="MANUAL">Manuális</option>
              </Select>
              <Select
                aria-label="Termékhasználat"
                value={params.get("hasProducts") ?? ""}
                onChange={(event) => filter("hasProducts", event.target.value)}
              >
                <option value="">Minden használat</option>
                <option value="true">Van termék</option>
                <option value="false">Nincs termék</option>
              </Select>
            </div>
          </Card>
          {data.items.length ? (
            <Card className="overflow-x-auto">
              <div className="flex justify-end px-3 py-2">
                <Pagination
                  position="top"
                  page={data.pagination.page}
                  totalPages={data.pagination.totalPages}
                  onPageChange={goToPage}
                />
              </div>
              <PilotDataTable
                columns={columns}
                rows={data.items}
                rowKey={(brand) => brand.id}
                rowTestId="brand-row"
                minWidth={800}
              />
            </Card>
          ) : (
            <EmptyState
              title={
                data.pagination.totalItems
                  ? "Nincs találat"
                  : "Nincsenek márkák"
              }
              description="Módosítsd a szűrőket vagy hozz létre új márkát."
              action={
                data.pagination.totalItems ? (
                  <PilotButton
                    variant="secondary"
                    onClick={() => router.replace(pathname)}
                  >
                    Szűrők törlése
                  </PilotButton>
                ) : undefined
              }
            />
          )}
          <Pagination
            position="bottom"
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onPageChange={goToPage}
          />
        </>
      ) : null}
    </div>
  );
}
