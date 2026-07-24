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
  type SupplierListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { suppliersApi } from "@/lib/api/suppliers";

export function SupplierListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<SupplierListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
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
  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a partnerkezeléshez"
        description="purchasing.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Partnerek"
        description="Beszállítói törzsadatok: elérhetőség, bankszámla és kapcsolattartó."
        actions={
          canManage ? (
            <Link href="/partnerek/uj">
              <Button>Új beszállító</Button>
            </Link>
          ) : undefined
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
        <div aria-label="Partnerek betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="Beszállító keresése"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Név, kód, adószám, ügyintéző"
              />
              <Select
                aria-label="Státusz"
                value={params.get("status") ?? "ACTIVE"}
                onChange={(event) => filter("status", event.target.value)}
              >
                <option value="ACTIVE">Aktív</option>
                <option value="INACTIVE">Inaktív</option>
                <option value="ALL">Mind</option>
              </Select>
            </div>
          </Card>
          {data.items.length ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Kód</th>
                    <th>Név</th>
                    <th>Ország</th>
                    <th>Ügyintéző</th>
                    <th>Elérhetőség</th>
                    <th>Státusz</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => router.push(`/partnerek/${item.id}`)}
                    >
                      <td className="p-3 font-mono text-xs text-slate-600">
                        {item.code}
                      </td>
                      <td className="font-semibold text-slate-900">
                        {item.name}
                        {item.taxNumber ? (
                          <div className="text-xs font-normal text-slate-500">
                            {item.taxNumber}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {item.country}
                        {item.city ? (
                          <div className="text-xs font-normal text-slate-500">
                            {item.city}
                          </div>
                        ) : null}
                      </td>
                      <td>{item.contactPersonName ?? "—"}</td>
                      <td>{item.email ?? item.phone ?? "—"}</td>
                      <td>
                        <Badge variant={item.isActive ? "success" : "neutral"}>
                          {item.isActive ? "Aktív" : "Inaktív"}
                        </Badge>
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
                  : "Nincsenek beszállítók"
              }
              description="Módosítsd a szűrőket vagy rögzíts új beszállítót."
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
