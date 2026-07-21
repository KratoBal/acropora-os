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
  type UserListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { usersApi } from "@/lib/api/users";
import { ROLE_LABELS, ROLE_OPTIONS } from "./role-labels";

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
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
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
            <div className="grid gap-3 sm:grid-cols-3">
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
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Név</th>
                    <th>E-mail</th>
                    <th>Szerepkör</th>
                    <th>Státusz</th>
                    <th>Jelszó</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="p-3">
                        <Link
                          className="font-semibold text-teal-700"
                          href={`/admin/users/${item.id}`}
                        >
                          {item.lastName} {item.firstName}
                        </Link>
                      </td>
                      <td>{item.email}</td>
                      <td>
                        <Badge>{ROLE_LABELS[item.role]}</Badge>
                      </td>
                      <td>
                        <Badge variant={item.isActive ? "success" : "neutral"}>
                          {item.isActive ? "Aktív" : "Inaktív"}
                        </Badge>
                      </td>
                      <td>{item.hasPassword ? "Beállítva" : "—"}</td>
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
