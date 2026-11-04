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
  PilotDataTable,
  type PilotTableColumn,
  Select,
  Skeleton,
  PilotButton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type UserListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { usersApi } from "@/lib/api/users";
import { ROLE_LABELS, ROLE_OPTIONS } from "./role-labels";
import { personDisplayName } from "@acropora/types";

type UserRow = UserListResponse["items"][number];

// The shared table: on the phone every row is a card with the name as its title.
const columns: PilotTableColumn<UserRow>[] = [
  {
    id: "name",
    header: "Név",
    cell: (item) => (
      <Link
        className="font-semibold text-brand-700"
        href={`/admin/users/${item.id}`}
      >
        {personDisplayName(item)}
      </Link>
    ),
  },
  { id: "email", header: "E-mail", cell: (item) => item.email },
  {
    id: "role",
    header: "Szerepkör",
    cell: (item) => <Badge>{ROLE_LABELS[item.role]}</Badge>,
  },
  {
    id: "status",
    header: "Státusz",
    cell: (item) => (
      <Badge variant={item.isActive ? "success" : "neutral"}>
        {item.isActive ? "Aktív" : "Inaktív"}
      </Badge>
    ),
  },
  {
    id: "password",
    header: "Jelszó",
    cell: (item) => (item.hasPassword ? "Beállítva" : "—"),
  },
];

export function UserListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<UserListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.USERS_MANAGE),
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
      if (!canManage) return;
      setLoading(true);
      setError(null);
      try {
        setData(await usersApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A felhasználólista nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canManage, query, token],
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
  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a felhasználókezeléshez"
        description="users.manage jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Felhasználók"
        description="Munkatársak adatai, szerepkörök és jogosultságok kezelése."
        actions={
          <Link href="/admin/users/new">
            <Button>Új felhasználó</Button>
          </Link>
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
        <div aria-label="Felhasználók betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                aria-label="Felhasználó keresése"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Név, e-mail"
              />
              <Select
                aria-label="Szerepkör"
                value={params.get("role") ?? ""}
                onChange={(event) => filter("role", event.target.value)}
              >
                <option value="">Minden szerepkör</option>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
                rowTestId="user-row"
                minWidth={700}
              />
            </Card>
          ) : (
            <EmptyState
              title={
                data.pagination.totalItems
                  ? "Nincs találat"
                  : "Nincsenek felhasználók"
              }
              description="Módosítsd a szűrőket vagy hozz létre új felhasználót."
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
