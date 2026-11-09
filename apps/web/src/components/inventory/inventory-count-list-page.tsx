"use client";

import {
  Alert,
  EmptyState,
  Icon,
  PageHeader,
  Pagination,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotDataTable,
  PilotSelect,
  Skeleton,
  type PilotTableColumn,
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
import {
  urlChoice,
  urlPage,
  useUrlQuery,
} from "@/lib/navigation/use-url-query";
import { inventoryApi } from "@/lib/api/inventory";

const STATUS_LABEL: Record<InventoryCountStatus, string> = {
  DRAFT: "Piszkozat",
  UPLOADED: "Feltöltve",
  CORRECTED: "Korrigálva",
};

const STATUS_BADGE: Record<InventoryCountStatus, "amber" | "blue" | "success"> =
  {
    DRAFT: "amber",
    UPLOADED: "blue",
    CORRECTED: "success",
  };

function InventoryCountTableSkeleton() {
  return (
    <PilotCard className="overflow-hidden">
      <div className="border-b border-dusk-200 bg-dusk-50 px-5 py-3">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="divide-y divide-dusk-100">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="ml-auto h-5 w-20" />
          </div>
        ))}
      </div>
    </PilotCard>
  );
}

type CountRow = InventoryCountListResponse["items"][number];

export const INVENTORY_TABLE_MIN_WIDTH = 950;

/*
  A LELTÁRLISTA OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a leltárszám a kártya címe, a többi oszlop a felirata mellett; a sor végi
  "Megnyitás" gomb telefonon kimarad (a kártya maga nyílik). A létrehozás ideje nem törhet sorba.
*/
export const countColumns = (
  open: (href: string) => void,
): PilotTableColumn<CountRow>[] => [
  {
    id: "number",
    header: "Leltárszám",
    width: "150px",
    cell: (count) => (
      <span className="font-mono text-xs text-dusk-700">
        {count.countNumber}
      </span>
    ),
  },
  {
    id: "warehouse",
    header: "Raktár",
    width: "150px",
    cell: (count) => (
      <span className="text-dusk-600">{count.warehouseName}</span>
    ),
  },
  {
    id: "startedBy",
    header: "Indította",
    width: "150px",
    cell: (count) => (
      <span className="text-dusk-600">{count.startedByName ?? "—"}</span>
    ),
  },
  {
    id: "createdAt",
    header: "Létrehozva",
    width: "170px",
    nowrap: true,
    cell: (count) => (
      <span className="text-dusk-600">
        {new Date(count.createdAt).toLocaleString("hu-HU")}
      </span>
    ),
  },
  {
    id: "lines",
    header: "Tételek",
    width: "90px",
    cell: (count) => (
      <span className="text-dusk-600">
        {count.lineCount.toLocaleString("hu-HU")}
      </span>
    ),
  },
  {
    id: "status",
    header: "Állapot",
    width: "130px",
    cell: (count) => (
      <PilotBadge variant={STATUS_BADGE[count.status]}>
        {STATUS_LABEL[count.status]}
      </PilotBadge>
    ),
  },
  {
    id: "open",
    header: "Művelet",
    width: "110px",
    align: "right",
    phone: "hide",
    cell: (count) => (
      <PilotButton
        variant="ghost"
        onClick={(event) => {
          event.stopPropagation();
          open(`/raktar/${count.id}`);
        }}
      >
        Megnyitás
      </PilotButton>
    ),
  },
];

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

  /*
    AZ ÁLLAPOT-SZŰRŐ ÉS A LAP AZ URL-BEN (Balázs kérése, 2026-09-30): a leltárból
    visszalépve a lista ugyanott áll. A szűrő-váltás a lapot is nullázza, egy
    írásban.
  */
  const { params, update } = useUrlQuery();
  const status = urlChoice<InventoryCountStatus | "all">(
    params,
    "status",
    ["all", "DRAFT", "UPLOADED", "CORRECTED"],
    "all",
  );
  const page = urlPage(params);
  const setPage = (next: number) =>
    update({ page: next === 1 ? null : String(next) });
  const [data, setData] = useState<InventoryCountListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (!canView) return;
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
    // Matches the button's own `canManage ? ... : undefined` rendering guard.
    if (!canManage || creating) return;
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
        title="Leltár"
        description="Készletleltárak indítása, nyomon követése és korrekciója."
        actions={
          canManage ? (
            <PilotButton onClick={startNewCount} disabled={creating}>
              {creating ? "Indítás…" : "Új leltár"}
            </PilotButton>
          ) : undefined
        }
      />

      <PilotCard className="p-4">
        <div className="max-w-xs">
          <PilotSelect
            aria-label="Állapot szűrő"
            value={status}
            onChange={(next) =>
              update({ status: next === "all" ? null : next, page: null })
            }
          >
            <option value="all">Minden állapot</option>
            <option value="DRAFT">Piszkozat</option>
            <option value="UPLOADED">Feltöltve</option>
            <option value="CORRECTED">Korrigálva</option>
          </PilotSelect>
        </div>
      </PilotCard>

      {error ? (
        <Alert
          variant="danger"
          title="A leltárlista nem tölthető be"
          description={error}
          action={
            <PilotButton
              variant="secondary"
              onClick={() => setRequestVersion((value) => value + 1)}
            >
              Újrapróbálás
            </PilotButton>
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
        <PilotCard className="overflow-hidden">
          <div className="flex justify-end px-5 py-3">
            <Pagination
              position="top"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
          <PilotDataTable
            columns={countColumns(router.push)}
            rows={data.items}
            rowKey={(count) => count.id}
            rowTestId="inventory-count-row"
            minWidth={INVENTORY_TABLE_MIN_WIDTH}
            onRowActivate={(count) => router.push(`/raktar/${count.id}`)}
            rowLabel={(count) => `${count.countNumber} megnyitása`}
          />

          <Pagination
            position="bottom"
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            onPageChange={setPage}
          />
        </PilotCard>
      ) : null}
    </div>
  );
}
