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
  type WorksheetListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { worksheetsApi } from "@/lib/api/worksheets";
import {
  formatAmount,
  formatDateTime,
  worksheetLabelOrDraft,
  worksheetStatusLabel,
  worksheetStatusVariant,
} from "./worksheet-labels";

export function WorksheetListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<WorksheetListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.SERVICE_MANAGE),
  );
  const token = session?.token ?? "";
  const userId = session?.user.id ?? "";
  const mineOnly = params.get("assigneeId") === userId && Boolean(userId);

  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", "25");
    return value;
  }, [params]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await worksheetsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A munkalapok nem tölthetők be.",
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
      if (search) next.set("search", search);
      else next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, pathname, router, search]);

  /** Szűrő váltása mindig az első oldalra ugrik: a 4. oldal egy másik
   * szűrővel általában nem is létezik. */
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  /** A lapozás KÜLÖN függvény, és ez nem stílus: a `filter` a végén
   * mindig `page=1`-et ír, tehát rajta keresztül lapozva a "Következő"
   * gomb csendben az első oldalra vinne. */
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a munkalapokhoz"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz"
        title="Munkalapok"
        description="Kiszállások és javítások munkalapjai. A sorszám a lezáráskor keletkezik, piszkozatnak nincs száma."
        actions={
          canManage ? (
            <Link href="/szerviz/munkalapok/uj">
              <Button>Új munkalap</Button>
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
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            aria-label="Munkalap keresése"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Munkalapszám, partner vagy tárgy"
          />
          {/* Állapot szerinti szűrő szándékosan nincs: az állapot a legutolsó
              verzióé, és a szerver ma nem tud rá helyes szűrőt adni. Egy
              olyan szűrő, ami csendben mást jelent, rosszabb, mint a hiánya. */}
          <Button
            variant={mineOnly ? "primary" : "secondary"}
            disabled={!userId}
            onClick={() => filter("assigneeId", mineOnly ? "" : userId)}
          >
            {mineOnly ? "Minden munkalap" : "Csak amit rám osztottak"}
          </Button>
        </div>
      </Card>
      {loading && !data ? (
        <div className="space-y-3" aria-label="Munkalapok betöltése">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data?.items.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Munkalap</th>
                <th>Partner</th>
                <th>Felelős</th>
                <th>Állapot</th>
                <th className="text-right">Bruttó</th>
                <th className="p-3">Módosítva</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((worksheet) => (
                <tr key={worksheet.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/szerviz/munkalapok/${worksheet.id}`}
                      className="font-semibold text-slate-950 hover:text-teal-700"
                    >
                      {worksheetLabelOrDraft(worksheet.label)}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {worksheet.subject}
                    </div>
                  </td>
                  <td>
                    <div className="font-medium">{worksheet.customerName}</div>
                    <div className="text-xs text-slate-500">
                      {worksheet.departmentCode}
                    </div>
                  </td>
                  <td>
                    {worksheet.assigneeNames.length
                      ? worksheet.assigneeNames.join(", ")
                      : "Nincs kiosztva"}
                  </td>
                  <td>
                    <Badge variant={worksheetStatusVariant(worksheet.status)}>
                      {worksheetStatusLabel[worksheet.status]}
                    </Badge>
                    {worksheet.versionCount > 1 ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        {worksheet.versionCount} verzió
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatAmount(worksheet.grossAmount)}
                  </td>
                  <td className="p-3 text-xs text-slate-500">
                    {formatDateTime(worksheet.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : data ? (
        <EmptyState
          title="Nincs munkalap"
          description={
            mineOnly
              ? "Rád jelenleg nincs munkalap kiosztva."
              : "Módosítsd a keresést, vagy vegyél fel új munkalapot."
          }
        />
      ) : null}
      {data ? (
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
      ) : null}
    </div>
  );
}
