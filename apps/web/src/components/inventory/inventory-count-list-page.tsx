"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type InventoryCountListResponse,
  type InventoryCountStatus,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { inventoryApi } from "@/lib/api/inventory";

const STATUS_LABEL: Record<InventoryCountStatus, string> = {
  DRAFT: "Piszkozat",
  UPLOADED: "Feltöltve",
  CORRECTED: "Korrigálva",
};

const STATUS_BADGE: Record<
  InventoryCountStatus,
  "warning" | "info" | "success"
> = {
  DRAFT: "warning",
  UPLOADED: "info",
  CORRECTED: "success",
};

function InventoryCountTableSkeleton() {
  return (
    <Card className="overflow-hidden" aria-label="Leltárak betöltése">
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="ml-auto h-5 w-20" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function InventoryCountListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_MANAGE),
  );

  const [status, setStatus] = useState<InventoryCountStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InventoryCountListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!canView || !token) return;
    let active = true;
    setError(null);
    setLoading(true);
    void inventoryApi
      .list(token, {
        page,
        pageSize: 20,
        status: status === "all" ? undefined : status,
      })
      .then((response) => {
        if (active) setData(response);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "A leltárlista betöltése nem sikerült.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [canView, page, requestVersion, status, token]);

  const startNewCount = () => {
    if (!token || creating) return;
    setCreating(true);
    void inventoryApi
      .create(token)
      .then((detail) => router.push(`/raktar/${detail.id}`))
      .catch((cause: unknown) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "A leltár indítása nem sikerült.",
        );
        setCreating(false);
      });
  };

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a raktárhoz"
        description="A megnyitáshoz inventory.view jogosultság szükséges."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Raktár"
        description="Készletleltárak indítása, nyomon követése és korrekciója."
        actions={
          canManage ? (
            <Button onClick={startNewCount} disabled={creating}>
              {creating ? "Indítás…" : "Új leltár"}
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4">
        <div className="max-w-xs">
          <Select
            aria-label="Állapot szűrő"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as InventoryCountStatus | "all");
              setPage(1);
            }}
          >
            <option value="all">Minden állapot</option>
            <option value="DRAFT">Piszkozat</option>
            <option value="UPLOADED">Feltöltve</option>
            <option value="CORRECTED">Korrigálva</option>
          </Select>
        </div>
      </Card>

      {error ? (
        <Alert
          variant="danger"
          title="A leltárlista nem tölthető be"
          description={error}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRequestVersion((value) => value + 1)}
            >
              Újrapróbálás
            </Button>
          }
        />
      ) : null}

      {loading && !data ? <InventoryCountTableSkeleton /> : null}

      {!loading && data && data.items.length === 0 ? (
        <EmptyState
          icon={<Icon name="warehouse" />}
          title="Még nincs egyetlen leltár sem"
          description="Az 'Új leltár' gombbal indíthatod el az elsőt."
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] border-collapse text-left">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Leltárszám</th>
                  <th className="px-4 py-3">Raktár</th>
                  <th className="px-4 py-3">Indította</th>
                  <th className="px-4 py-3">Létrehozva</th>
                  <th className="px-4 py-3">Tételek</th>
                  <th className="px-4 py-3">Állapot</th>
                  <th className="px-5 py-3 text-right">Művelet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((count) => (
                  <tr
                    key={count.id}
                    tabIndex={0}
                    className="cursor-pointer transition hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500"
                    onClick={() => router.push(`/raktar/${count.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        router.push(`/raktar/${count.id}`);
                      }
                    }}
                  >
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-700">
                      {count.countNumber}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">
                      {count.warehouseName}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">
                      {count.startedByName ?? "—"}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">
                      {new Date(count.createdAt).toLocaleString("hu-HU")}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-slate-600">
                      {count.lineCount.toLocaleString("hu-HU")}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={STATUS_BADGE[count.status]}>
                        {STATUS_LABEL[count.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          router.push(`/raktar/${count.id}`);
                        }}
                      >
                        Megnyitás
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center border-t border-slate-200 px-5 py-4 sm:justify-end">
            <Pagination
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
