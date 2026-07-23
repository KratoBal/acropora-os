"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type PurchaseInvoiceListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { purchasingApi } from "@/lib/api/purchasing";

function formatMoney(value: string, currency: string): string {
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

export function PurchaseInvoiceListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<PurchaseInvoiceListResponse | null>(null);
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
        setData(await purchasingApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A beszerzési számlák nem tölthetők be.",
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
        title="Nincs hozzáférésed a beszerzéshez"
        description="A megtekintéshez purchasing.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beszerzés"
        description="Beérkezett beszállítói számlák: EU-s és belföldi bevételezés."
        actions={
          canManage ? (
            <Link href="/beszerzes/uj">
              <Button>Új EU-s számla</Button>
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
        <div aria-label="Beszerzési számlák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <Input
              aria-label="Számla keresése"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Bizonylatszám, számlaszám, beszállító neve"
            />
          </Card>
          {data.items.length ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Bizonylatszám</th>
                    <th>Beszállító</th>
                    <th>Számlaszám</th>
                    <th>Kelte</th>
                    <th>Összeg</th>
                    <th>Fizetve</th>
                    <th>Forrás</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() => router.push(`/beszerzes/${item.id}`)}
                    >
                      <td className="p-3 font-mono text-xs text-slate-600">
                        {item.documentNumber}
                      </td>
                      <td className="font-semibold text-slate-900">
                        {item.supplierName}
                      </td>
                      <td>{item.supplierInvoiceNumber}</td>
                      <td>
                        {new Date(item.invoiceDate).toLocaleDateString("hu-HU")}
                      </td>
                      <td>{formatMoney(item.totalNet, item.currency)}</td>
                      <td>
                        <Badge variant={item.isPaid ? "success" : "neutral"}>
                          {item.isPaid ? "Fizetve" : "Nyitott"}
                        </Badge>
                      </td>
                      <td>
                        <Badge
                          variant={item.source === "EU" ? "info" : "neutral"}
                        >
                          {item.source === "EU" ? "EU" : "Belföldi"}
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
                  : "Még nincs rögzített beszerzési számla"
              }
              description="Módosítsd a keresést vagy rögzíts új EU-s számlát."
              action={
                canManage && !data.pagination.totalItems ? (
                  <Link href="/beszerzes/uj">
                    <Button variant="secondary">Új EU-s számla</Button>
                  </Link>
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
