"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
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
          <div className="flex gap-2">
            <Link href="/admin/brands/import-assistant">
              <Button variant="secondary">Import asszisztens</Button>
            </Link>
            {canManage ? (
              <Link href="/admin/brands/new">
                <Button>Új márka</Button>
              </Link>
            ) : null}
          </div>
        }
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
        <div aria-label="Márkák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-4">
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
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Márka</th>
                    <th>Státusz</th>
                    <th>Aliasok</th>
                    <th>Termékek</th>
                    <th>UNAS</th>
                    <th>Frissítve</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((brand) => (
                    <tr key={brand.id} className="border-b last:border-0">
                      <td className="p-3">
                        <Link
                          className="font-semibold text-teal-700"
                          href={`/admin/brands/${brand.id}`}
                        >
                          {brand.name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {brand.slug}
                        </div>
                      </td>
                      <td>
                        <Badge variant={brand.isActive ? "success" : "neutral"}>
                          {brand.isActive ? "Aktív" : "Archivált"}
                        </Badge>
                      </td>
                      <td>
                        {brand.aliases.map((alias) => alias.alias).join(", ") ||
                          "—"}
                      </td>
                      <td>{brand.usage.productCount}</td>
                      <td>
                        {brand.externalMappings.some(
                          (mapping) => mapping.system === "UNAS",
                        )
                          ? "Kapcsolva"
                          : "—"}
                      </td>
                      <td>
                        {new Date(brand.updatedAt).toLocaleDateString("hu-HU")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                  <Button
                    variant="secondary"
                    onClick={() => router.replace(pathname)}
                  >
                    Szűrők törlése
                  </Button>
                ) : undefined
              }
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={data.pagination.page <= 1}
              onClick={() => filter("page", String(data.pagination.page - 1))}
            >
              Előző
            </Button>
            <span className="self-center text-sm">
              {data.pagination.page} / {Math.max(1, data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => filter("page", String(data.pagination.page + 1))}
            >
              Következő
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
