"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type NavIncomingInvoiceListResponse,
  type NavIncomingInvoiceStatus,
} from "@acropora/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { navIncomingInvoicesApi } from "@/lib/api/nav-incoming-invoices";

function formatAmount(value: string | undefined, currency: string): string {
  if (!value) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

function statusBadge(status: NavIncomingInvoiceStatus) {
  switch (status) {
    case "RECEIVED":
      return <Badge variant="success">Bevételezve</Badge>;
    case "ERROR":
      return <Badge variant="danger">Hiba</Badge>;
    case "DATA_FETCHED":
      return <Badge variant="info">Betöltve</Badge>;
    default:
      return <Badge variant="neutral">Új</Badge>;
  }
}

export function NavIncomingInvoiceListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<NavIncomingInvoiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
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
        setData(await navIncomingInvoicesApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A NAV számlák nem tölthetők be.",
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

  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const result = await navIncomingInvoicesApi.sync(token);
      setSyncNotice(
        result.createdCount > 0
          ? `${result.createdCount} új számla letöltve.`
          : "Nincs új számla.",
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A NAV szinkron nem sikerült.",
      );
    } finally {
      setSyncing(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a listához"
        description="A megtekintéshez purchasing.view jogosultság szükséges."
      />
    );

  const status = params.get("status") ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="NAV számla lekérés"
        description="A NAV Online Számla rendszerből letöltött belföldi bejövő számlák - válassz egyet a bevételezéshez."
        actions={
          canManage ? (
            <Button onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? "Frissítés..." : "Frissítés"}
            </Button>
          ) : undefined
        }
      />
      {syncNotice ? (
        <Alert variant="info" title="Szinkron kész" description={syncNotice} />
      ) : null}
      {error ? (
        <Alert
          variant="danger"
          title="Hiba történt"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      <Card className="flex flex-wrap gap-2 p-4">
        {(
          [
            ["", "Összes"],
            ["NEW", "Új"],
            ["DATA_FETCHED", "Betöltve"],
            ["RECEIVED", "Bevételezve"],
            ["ERROR", "Hiba"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value || "all"}
            variant={status === value ? "primary" : "secondary"}
            onClick={() => filter("status", value)}
          >
            {label}
          </Button>
        ))}
      </Card>
      {loading && !data ? (
        <div aria-label="NAV számlák betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          {data.items.length ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Számlaszám</th>
                    <th>Beszállító</th>
                    <th>Kelte</th>
                    <th>Összeg</th>
                    <th>Állapot</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-slate-50"
                      onClick={() =>
                        router.push(`/beszerzes/nav-szamlak/${item.id}`)
                      }
                    >
                      <td className="p-3 font-mono text-xs text-slate-600">
                        {item.navInvoiceNumber}
                      </td>
                      <td className="font-semibold text-slate-900">
                        {item.supplierName}
                      </td>
                      <td>
                        {new Date(item.invoiceIssueDate).toLocaleDateString(
                          "hu-HU",
                        )}
                      </td>
                      <td>
                        {formatAmount(item.invoiceNetAmount, item.currency)}
                      </td>
                      <td>{statusBadge(item.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <EmptyState
              title="Nincs letöltött NAV számla"
              description="Nyomd meg a Frissítés gombot az új belföldi bejövő számlák lekéréséhez."
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
