"use client";
import { plainText } from "@/lib/format/plain-text";
import {
  Alert,
  Badge,
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
} from "@acropora/ui";
import {
  CUSTOMER_LIST_ROLES,
  hasPermission,
  PERMISSIONS,
  type CustomerListResponse,
  type CustomerPartnerRole,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { customersApi } from "@/lib/api/customers";

type CustomerRow = CustomerListResponse["items"][number];

/** A szerep jelvénye a soron (egy partnertörzs): a Supplier-kötésből származtatva, külön oszlop nélkül. */
const ROLE_BADGE: Record<CustomerPartnerRole, string> = {
  SUPPLIER: "Beszállító",
  SERVICE: "Szerviz-partner",
};

/** A szerep-szűrő választéka, a lista a `role` URL-kulcson át szűr (hiányzó: mindenki). */
const ROLE_FILTER_LABEL: Record<(typeof CUSTOMER_LIST_ROLES)[number], string> =
  {
    ALL: "Minden szerep",
    BUYER: "Csak vevők",
    PARTNER: "Minden partner",
    SUPPLIER: "Beszállítók",
    SERVICE: "Szerviz-partnerek",
  };

// The shared table: on the phone every row is a card with the name as its title.
const columns: PilotTableColumn<CustomerRow>[] = [
  {
    id: "name",
    header: "Név",
    cell: (item) => (
      <span className="font-semibold text-dusk-900">
        {item.displayName}
        {item.companyName ? (
          <span className="block text-xs font-normal text-dusk-500">
            {item.companyName}
          </span>
        ) : null}
        {item.partnerMirror ? (
          <span className="mt-1 flex flex-wrap gap-1" data-testid="role-badges">
            {(item.partnerRoles?.length ? item.partnerRoles : []).map(
              (role) => (
                <Badge key={role} variant="info">
                  {ROLE_BADGE[role]}
                </Badge>
              ),
            )}
            {item.partnerRoles?.length ? null : (
              <Badge variant="info">Partner</Badge>
            )}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    id: "partnerCode",
    header: "Partnerkód",
    width: "140px",
    cell: (item) => (
      <span className="font-mono text-xs text-dusk-600">
        {item.partnerCode}
      </span>
    ),
  },
  {
    id: "address",
    header: "Cím",
    cell: (item) => plainText(item.address) || "—",
  },
  {
    id: "source",
    header: "Forrás",
    width: "180px",
    cell: (item) => (
      <Badge variant={item.source === "UNAS" ? "info" : "neutral"}>
        {item.source === "UNAS" ? "Webshopos" : "Általunk rögzített"}
      </Badge>
    ),
  },
];

export function CustomerListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<CustomerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.CUSTOMERS_MANAGE),
  );
  const token = session?.token ?? "";
  const query = useMemo(() => {
    const q = new URLSearchParams(params.toString());
    // egy lista a vevőkkel és a partnerekkel: szerep nélkül mindenki jön (a szerep-szűrő szűkít)
    if (!q.has("role")) q.set("role", "ALL");
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
        setData(await customersApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A vevőlista nem tölthető be.",
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
        title="Nincs hozzáférésed a vevőkezeléshez"
        description="customers.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vevők és partnerek"
        description="Egy lista: a UNAS webshopból szinkronizált és a kézzel rögzített vevők, és a partnerek (beszállítók, szerviz-partnerek), a szerep jelvénye a soron. Szűrhető szerepre."
        actions={
          canManage ? (
            <Link href="/vevok/uj">
              <PilotButton>Új vevő</PilotButton>
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
            <PilotButton variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </PilotButton>
          }
        />
      ) : null}
      {loading && !data ? (
        <div aria-label="Vevők betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <Input
                aria-label="Vevő keresése"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Név, cégnév, email, partnerkód"
              />
              <Select
                aria-label="Szerep"
                value={params.get("role") ?? ""}
                onChange={(event) => filter("role", event.target.value)}
              >
                <option value="">{ROLE_FILTER_LABEL.ALL}</option>
                {CUSTOMER_LIST_ROLES.filter((role) => role !== "ALL").map(
                  (role) => (
                    <option key={role} value={role}>
                      {ROLE_FILTER_LABEL[role]}
                    </option>
                  ),
                )}
              </Select>
              <Select
                aria-label="Forrás"
                value={params.get("source") ?? ""}
                onChange={(event) => filter("source", event.target.value)}
              >
                <option value="">Minden forrás</option>
                <option value="UNAS">Webshop (UNAS)</option>
                <option value="MANUAL">Általunk rögzített</option>
              </Select>
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
                rowKey={(item) => item.id}
                rowTestId="customer-row"
                rowLabel={(item) => `${item.displayName} megnyitása`}
                onRowActivate={(item) => router.push(`/vevok/${item.id}`)}
                minWidth={720}
              />
            </Card>
          ) : (
            <EmptyState
              title={
                data.pagination.totalItems ? "Nincs találat" : "Nincsenek vevők"
              }
              description="Módosítsd a szűrőket vagy rögzíts új vevőt."
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
