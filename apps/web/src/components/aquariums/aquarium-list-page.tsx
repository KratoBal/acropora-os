"use client";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AquariumListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { aquariumsApi } from "@/lib/api/aquariums";
import { OWNERSHIP_LABEL } from "./aquarium-labels";

const litersFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 0,
});

export function AquariumListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<AquariumListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.AQUARIUMS_MANAGE),
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
        setData(await aquariumsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az akvárium-lista nem tölthető be.",
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
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(page));
    router.replace(`${pathname}?${next}`);
  };
  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az akváriumokhoz"
        description="aquariums.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Akváriumok"
        description="Saját és ügyfél akváriumok/tavak, a felszerelt berendezéseikkel."
        actions={
          canManage ? (
            <Link href="/akvariumok/uj">
              <Button>Új felvitele</Button>
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
        <div aria-label="Akváriumok betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                aria-label="Akvárium keresése"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Név, akváriumszám, ügyfél"
              />
              <Select
                aria-label="Tulajdon"
                value={params.get("ownershipType") ?? ""}
                onChange={(event) =>
                  filter("ownershipType", event.target.value)
                }
              >
                <option value="">Mind</option>
                <option value="OWN">{OWNERSHIP_LABEL.OWN}</option>
                <option value="CUSTOMER">{OWNERSHIP_LABEL.CUSTOMER}</option>
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
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b bg-dusk-50 text-xs uppercase text-dusk-500">
                  <tr>
                    <th className="p-3">Név</th>
                    <th>Tulajdon</th>
                    <th>Ügyfél</th>
                    <th>Liter</th>
                    <th>Berendezések</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-dusk-50"
                      onClick={() => router.push(`/akvariumok/${item.id}`)}
                    >
                      <td className="p-3 font-semibold text-dusk-900">
                        {item.name}
                        <div className="text-xs font-normal text-dusk-500">
                          {item.aquariumNumber}
                        </div>
                      </td>
                      <td>
                        <Badge
                          variant={
                            item.ownershipType === "OWN" ? "neutral" : "info"
                          }
                        >
                          {OWNERSHIP_LABEL[item.ownershipType]}
                        </Badge>
                      </td>
                      <td>{item.customerName ?? "—"}</td>
                      <td>
                        {item.systemVolumeLiters != null
                          ? `${litersFormatter.format(item.systemVolumeLiters)} l`
                          : "—"}
                      </td>
                      <td>{item.equipmentCount}</td>
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
                  : "Nincsenek akváriumok"
              }
              description="Módosítsd a szűrőket vagy rögzíts új akváriumot."
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
