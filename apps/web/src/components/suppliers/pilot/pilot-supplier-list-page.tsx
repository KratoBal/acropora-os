"use client";
import { Alert, EmptyState, Icon, Pagination, Skeleton } from "@acropora/ui";
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
import {
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- LISTA KÉPERNYŐ.
 *
 * Forrás: `exchange/figma-partnerek-make-13/src/PartnersScreen.tsx`
 * `PartnersListPage` (446-672. sor). Az adat, a szűrés, a lapozás és a
 * jogosultság a mai `SupplierListPage`-ből jön VÁLTOZATLANUL (URL-alapú
 * szűrők, debounce-olt keresés) -- csak a kártya-szerkezet és a stílus a
 * tervé, ahogy a brief kéri ("a kártyák és a sorrendjük... nem csak a
 * színek").
 *
 * A TERV "Demo" GOMBJAI (Betöltés/Hiba/Nincs jog kapcsolók) NEM KERÜLTEK
 * ÁT: azok a Make előnézet saját, mock-állapotváltói, nem valódi funkció --
 * a mai kód a VALÓDI betöltési/hiba/jogosultsági állapotot mutatja, ami
 * pontosan ugyanezt a három esetet fedi.
 *
 * EGY PAGINÁCIÓ, NEM KETTŐ: a terv a lapozót csak a táblázat ALATT adja,
 * a korábbi (nem pilot) `SupplierListPage` viszont a kártya tetején ÉS
 * alján is mutatta -- ez utóbbi itt megszűnt, a terv szerint.
 */
export function PilotSupplierListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<SupplierListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PARTNERS_MANAGE),
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
      <PilotThemeRoot>
        <Alert
          variant="danger"
          title="Nincs hozzáférésed a partnerkezeléshez"
          description="partners.view jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot>
      <div className="flex min-h-full flex-col">
        <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
          <div>
            <h1 className="text-xl font-semibold text-pilot-grey-900">
              Partnerek
            </h1>
            <p className="mt-0.5 text-sm text-pilot-grey-400">
              Beszállítói törzsadatok: elérhetőség, bankszámla és
              kapcsolattartó.
            </p>
          </div>
          {canManage ? (
            <Link href="/partnerek/uj">
              <PilotButton type="button" variant="primary">
                <Icon name="plus" size={14} />
                Új felvitele
              </PilotButton>
            </Link>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-4 px-8 py-6">
          <PilotCard>
            <div className="flex flex-wrap items-center gap-3 p-5">
              <PilotInput
                aria-label="Beszállító keresése"
                value={search}
                onChange={setSearch}
                placeholder="Név, kód, adószám, ügyintéző"
              />
              <PilotSelect
                aria-label="Státusz"
                value={params.get("status") ?? "ACTIVE"}
                onChange={(value) => filter("status", value)}
              >
                <option value="ACTIVE">Aktív</option>
                <option value="INACTIVE">Inaktív</option>
                <option value="ALL">Mind</option>
              </PilotSelect>
              {/* "Mind" is the absence of the parameter rather than a third
                  value: a partner can be both kinds at once, so SUPPLIER and
                  SERVICE are not a partition and an "ALL" value would suggest
                  they are. */}
              <PilotSelect
                aria-label="Partner típusa"
                value={params.get("kind") ?? ""}
                onChange={(value) => filter("kind", value)}
              >
                <option value="">Mind</option>
                <option value="SUPPLIER">Beszállító</option>
                <option value="SERVICE">Szerviz</option>
              </PilotSelect>
            </div>
          </PilotCard>

          {error ? (
            <Alert
              variant="danger"
              title="Betöltési hiba"
              description={error}
              action={
                <PilotButton
                  type="button"
                  variant="secondary"
                  onClick={() => void load()}
                >
                  Újrapróbálás
                </PilotButton>
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
            data.items.length ? (
              <PilotCard className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-pilot-grey-100">
                    <tr>
                      {[
                        "Kód",
                        "Név",
                        "Ország",
                        "Ügyintéző",
                        "Elérhetőség",
                        "Státusz",
                      ].map((col) => (
                        <th
                          key={col}
                          className="whitespace-nowrap bg-white px-4 py-3 text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item, index) => (
                      <tr
                        key={item.id}
                        onClick={() => router.push(`/partnerek/${item.id}`)}
                        className={`cursor-pointer border-b border-pilot-grey-50 transition-colors hover:bg-pilot-aqua-50/40 ${
                          index % 2 === 1 ? "bg-pilot-grey-50/50" : "bg-white"
                        }`}
                      >
                        {/* The four-character code, not the internal
                            `SZALL-20260731-204153-07DA` identifier: this
                            column is read by people, and it is the one that
                            appears on the worksheet number.

                            A service partner without one is marked rather
                            than left blank. It cannot be offered on a
                            worksheet until it has a code, so the gap is a
                            task somebody has to finish, and a blank cell
                            says nothing about that. A partner we only buy
                            from needs no code at all. */}
                        <td className="px-4 py-3 font-mono text-xs text-pilot-grey-900">
                          {item.worksheetPartnerCode ??
                            (item.isService ? (
                              <PilotBadge variant="amber">Nincs kód</PilotBadge>
                            ) : (
                              <span className="text-pilot-grey-300">—</span>
                            ))}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-pilot-grey-900">
                              {item.name}
                            </span>
                            {/* Both can show at once, because a partner can
                                be both, and that is the case worth seeing at
                                a glance. A partner that is neither shows no
                                label rather than a made-up one. */}
                            {item.isSupplier ? (
                              <PilotBadge variant="blue">Beszállító</PilotBadge>
                            ) : null}
                            {item.isService ? (
                              <PilotBadge variant="amber">Szerviz</PilotBadge>
                            ) : null}
                          </div>
                          {item.taxNumber ? (
                            <p className="mt-0.5 text-xs text-pilot-grey-400">
                              {item.taxNumber}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-pilot-grey-900">
                            {item.country}
                          </p>
                          {item.city ? (
                            <p className="text-xs text-pilot-grey-400">
                              {item.city}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-pilot-grey-700">
                          {item.contactPersonName ?? (
                            <span className="text-pilot-grey-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.email ? (
                            <p className="text-xs text-pilot-grey-700">
                              {item.email}
                            </p>
                          ) : null}
                          {item.phone ? (
                            <p className="text-xs text-pilot-grey-500">
                              {item.phone}
                            </p>
                          ) : null}
                          {!item.email && !item.phone ? (
                            <span className="text-pilot-grey-300">—</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <PilotBadge variant={item.isActive ? "teal" : "grey"}>
                            {item.isActive ? "Aktív" : "Inaktív"}
                          </PilotBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-pilot-grey-100 px-4 py-3">
                  <p className="text-xs text-pilot-grey-400">
                    {data.pagination.totalItems.toLocaleString("hu-HU")}{" "}
                    partnerből{" "}
                    {(
                      (data.pagination.page - 1) * data.pagination.pageSize +
                      1
                    ).toLocaleString("hu-HU")}
                    –
                    {Math.min(
                      data.pagination.page * data.pagination.pageSize,
                      data.pagination.totalItems,
                    ).toLocaleString("hu-HU")}{" "}
                    látható
                  </p>
                  <Pagination
                    page={data.pagination.page}
                    totalPages={data.pagination.totalPages}
                    onPageChange={goToPage}
                  />
                </div>
              </PilotCard>
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
                    <PilotButton
                      type="button"
                      variant="secondary"
                      onClick={() => router.replace(pathname)}
                    >
                      Szűrők törlése
                    </PilotButton>
                  ) : undefined
                }
              />
            )
          ) : null}
        </div>
      </div>
    </PilotThemeRoot>
  );
}
