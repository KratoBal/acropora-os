"use client";
import { Alert, Icon, Pagination, Skeleton } from "@acropora/ui";
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
import { OWNERSHIP_LABEL, WATER_BODY_LABEL } from "../aquarium-labels";
import { pilotInter } from "./pilot-font";
import {
  PilotAvatar,
  PilotBadge,
  PilotButton,
  PilotSegmentedControl,
  pilotAvatarColor,
  pilotInitials,
} from "./pilot-ui";

const lastMeasuredFormatter = new Intl.DateTimeFormat("hu-HU", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const litersFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 0,
});

const OWNERSHIP_OPTIONS = ["Mind", "Saját", "Ügyfél"] as const;
const WATER_BODY_OPTIONS = ["Mind", "Akvárium", "Tó"] as const;

/**
 * A FIGMA MAKE TERV KÍSÉRLETI ÁTÜLTETÉSE -- LISTA KÉPERNYŐ.
 *
 * Ugyanaz az adat és ugyanaz a viselkedés, mint a mai `AquariumListPage`-nél
 * (`../aquarium-list-page.tsx`, VÁLTOZATLAN marad, ez egy KÜLÖN, PÁRHUZAMOS
 * komponens -- Balázs "egymás mellé tesszük" kérése szerint).
 *
 * A "KARBANTARTÓK" ÉS "UTOLSÓ VÍZMÉRÉS" OSZLOP MÁR TELJES (acrobot kérése,
 * 2026-09-24 16:19): a lista-végpont (`AquariumSummary`) mostantól
 * soronként adja ezt is, két BATCH-ELT (nem soronkénti) lekérdezéssel --
 * lásd `AquariumsRepository`-ban a `listInclude` fejlécét.
 *
 * A "TÍPUS" SZŰRŐ ÚJ: a mai lista csak tulajdon szerint szűr. A
 * `waterBodyType` viszont MEGLÉVŐ mező minden akváriumon, a szűrés hozzáadása
 * a listaLekérdezéshez ugyanaz a minta, mint az `ownershipType`-nál --- ez
 * NEM kitalált adat, csak egy már létező mezőre írt új szűrő.
 */
export function PilotAquariumListPage() {
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
  const ownershipFilter =
    params.get("ownershipType") === "OWN"
      ? "Saját"
      : params.get("ownershipType") === "CUSTOMER"
        ? "Ügyfél"
        : "Mind";
  const waterBodyFilter =
    params.get("waterBodyType") === "AKVARIUM"
      ? "Akvárium"
      : params.get("waterBodyType") === "TO"
        ? "Tó"
        : "Mind";

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed az akváriumokhoz"
        description="aquariums.view jogosultság szükséges."
      />
    );

  return (
    <div
      className={`${pilotInter.className} -m-6 flex min-h-screen flex-col bg-pilot-grey-50`}
    >
      <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-pilot-grey-900">
            Akváriumok
          </h1>
          <p className="mt-0.5 text-sm text-pilot-grey-400">
            {data ? `${data.pagination.totalItems} bejegyzés összesen` : " "}
          </p>
        </div>
        {canManage ? (
          <Link href="/akvariumok/uj">
            <PilotButton variant="primary">
              <Icon name="plus" size={14} />
              Új akvárium
            </PilotButton>
          </Link>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-pilot-grey-100 bg-white px-8 py-4">
        <div className="relative">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Akvárium keresése"
            placeholder="Keresés neve vagy ügyfél alapján…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-72 rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-pilot-grey-400">
            Tulajdon:
          </span>
          <PilotSegmentedControl
            options={OWNERSHIP_OPTIONS}
            value={ownershipFilter}
            onChange={(value) =>
              filter(
                "ownershipType",
                value === "Saját"
                  ? "OWN"
                  : value === "Ügyfél"
                    ? "CUSTOMER"
                    : "",
              )
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-pilot-grey-400">
            Típus:
          </span>
          <PilotSegmentedControl
            options={WATER_BODY_OPTIONS}
            value={waterBodyFilter}
            onChange={(value) =>
              filter(
                "waterBodyType",
                value === "Akvárium" ? "AKVARIUM" : value === "Tó" ? "TO" : "",
              )
            }
          />
        </div>
      </div>

      {error ? (
        <div className="px-8 py-4">
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
        </div>
      ) : null}

      {loading && !data ? (
        <div aria-label="Akváriumok betöltése" className="space-y-3 px-8 py-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="aquarium" size={24} className="text-pilot-aqua-600" />
          </div>
          <div className="text-center">
            <p className="mb-1 text-base font-semibold text-pilot-grey-700">
              {data.pagination.totalItems
                ? "Nincs találat"
                : "Még nincs akvárium"}
            </p>
            <p className="max-w-xs text-sm text-pilot-grey-400">
              {data.pagination.totalItems
                ? "Módosítsd a szűrőket."
                : "Adj hozzá egy akváriumot, és itt láthatod az összes nyilvántartott példányt."}
            </p>
          </div>
          {canManage && !data.pagination.totalItems ? (
            <Link href="/akvariumok/uj">
              <PilotButton variant="primary">
                <Icon name="plus" size={14} />
                Új akvárium
              </PilotButton>
            </Link>
          ) : data.pagination.totalItems ? (
            <PilotButton
              variant="secondary"
              onClick={() => router.replace(pathname)}
            >
              Szűrők törlése
            </PilotButton>
          ) : null}
        </div>
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-pilot-grey-100">
                  {[
                    "Név",
                    "Tulajdon",
                    "Ügyfél",
                    "Típus",
                    "Liter",
                    "Berendezések",
                    "Karbantartók",
                    "Utolsó vízmérés",
                  ].map((col) => (
                    <th
                      key={col}
                      className={`whitespace-nowrap bg-white px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400 ${
                        col === "Liter" ? "text-right" : ""
                      }`}
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
                    onClick={() => router.push(`/akvariumok/${item.id}`)}
                    className={`group cursor-pointer border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                      index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-pilot-grey-900 transition-colors group-hover:text-pilot-aqua-700">
                      {item.name}
                      <div className="text-xs font-normal text-pilot-grey-500">
                        {item.aquariumNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PilotBadge
                        variant={item.ownershipType === "OWN" ? "teal" : "grey"}
                      >
                        {OWNERSHIP_LABEL[item.ownershipType]}
                      </PilotBadge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-pilot-grey-500">
                      {item.customerName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-pilot-grey-600">
                      {WATER_BODY_LABEL[item.waterBodyType]}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-pilot-grey-700">
                      {item.systemVolumeLiters != null
                        ? `${litersFormatter.format(item.systemVolumeLiters)} l`
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center text-pilot-grey-500">
                      {item.equipmentCount}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex -space-x-1.5">
                        {item.maintainers.map((maintainer) => (
                          <PilotAvatar
                            key={maintainer.userId}
                            initials={pilotInitials(maintainer.displayName)}
                            color={pilotAvatarColor(maintainer.userId)}
                            size="sm"
                          />
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-pilot-grey-500">
                      {item.lastMeasuredAt ? (
                        lastMeasuredFormatter.format(
                          new Date(item.lastMeasuredAt),
                        )
                      ) : (
                        <span className="italic text-pilot-grey-300">
                          nincs
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end border-t border-pilot-grey-100 bg-white px-4 py-2">
            <Pagination
              position="bottom"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={goToPage}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
