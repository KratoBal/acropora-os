"use client";

import {
  Alert,
  EmptyState,
  Icon,
  Pagination,
  Skeleton,
  sv,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type AssetListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildSiteOptions, buildSiteTree } from "@/lib/partners/site-tree";
import { suppliersApi } from "@/lib/api/suppliers";
import {
  readUnitFilter,
  toggleUnitFilter,
  writeUnitFilter,
} from "@/lib/partners/unit-filter";

import { useAuth } from "@/components/auth/auth-provider";
import { ServiceIcon } from "@/components/service/service-list-chrome";
import { assetsApi } from "@/lib/api/assets";
import { assetCategoriesApi } from "@/lib/api/asset-categories";
import {
  assetKindLabel,
  assetStatusLabel,
  assetStatusPilotVariant,
} from "../asset-labels";
import { TABS } from "../asset-list-page";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";

/**
 * A FIGMA MAKE TERV ÁTÜLTETÉSE -- ESZKÖZNYILVÁNTARTÁS LISTA (7. kör).
 *
 * Brief: `exchange/figma-eszkozok-atultetes-brief-2026-09-25.md`, forrás:
 * `exchange/figma-eszkozok-make-7/src/EszközScreen.tsx` (`EszközList`,
 * 1-453. sor). Ez az ELSŐ a három oldalból (lista, adatlap, új eszköz) --
 * a másik kettő KÜLÖN körben, a Hibajegyek-mintát követve.
 *
 * === A "BEÉPÍTETT" FÜL ÉS A "TABS" TÖMB, EGY HELYRŐL ===
 *
 * A `TABS` a régi `asset-list-page.tsx`-ből jön, exportálva -- NEM
 * harmadik, kézzel másolt példány (barracuda mérése, 6431542b kártya: a
 * web és a partner felület már ma is két külön másolatot visel). A
 * "Beépített" fül jelentése ("minden, kivéve a kivezetetteket", Balázs
 * kérése 2026-09-16) NEM hierarchia-kapcsoló, ahogy a Figma-leírás első,
 * javítatlan változata sugallta -- ez a Make-export már a javított
 * leírásból készült, és a `tabFilter` logikája ezt helyesen tükrözi.
 *
 * === A BAL OLDALI HELYSZÍN-FA VÁLTOZATLAN MARAD ("varrat") ===
 *
 * A Figma-terv NEM mutat helyszín-fát, csak egy sima "Alegység"
 * legördülőt. A mai fa TÖBBET tud (több csomópont egyszerre
 * kiválasztható, Balázs kérése), ez a képesség nem tűnhet el csendben --
 * ugyanaz az elv, mint a hibajegyes/akváriumos köröknél az összetett,
 * beágyazott alrendszereknél: a fa a régi kinézetében marad, a lista
 * panel kapja a Figma-stílust.
 *
 * === AMI A TERVBEN VAN, DE A MAI ADATBAN NINCS -- NEM TALÁLTUK KI ===
 *
 * A Figma tábla oszlopai (Eszköz, Partner, Alegység, Kategória, Gyártó és
 * modell, Hierarchia, Státusz) a valós `AssetListItem` mezőkből épülnek.
 * A "Partner" és "Alegység" a mai listán EGY "Elhelyezés" oszlopba van
 * összevonva (tulajdonos + hely) -- ezt a Figma két oszlopra bontja, és
 * mivel mindkét adat MEGVAN, ez a bontás átvehető adatvesztés nélkül.
 */

const NINCS_KATEGORIA = "__NINCS__";
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = String(PAGE_SIZES[0]);

export function PilotAssetListPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<AssetListResponse | null>(null);
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
  const activeStatus = params.get("status") ?? "IN_PLACE";

  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", DEFAULT_PAGE_SIZE);
    if (!value.has("status")) value.set("status", "IN_PLACE");
    return value;
  }, [params]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setData(await assetsApi.list(token, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az eszközlista nem tölthető be.",
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

  const ownerId = params.get("ownerId") ?? "";
  const unitsOwnerId = params.get("ownerType") === "SUPPLIER" ? ownerId : "";
  const [units, setUnits] = useState<
    Awaited<ReturnType<typeof suppliersApi.units>>["items"]
  >([]);
  const [unitsFailed, setUnitsFailed] = useState(false);
  useEffect(() => {
    if (!canView || !unitsOwnerId) {
      setUnits([]);
      return;
    }
    const controller = new AbortController();
    setUnitsFailed(false);
    void suppliersApi
      .units(token, unitsOwnerId, controller.signal)
      .then((response) => setUnits(response.items))
      .catch((cause) => {
        setUnits([]);
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setUnitsFailed(true);
      });
    return () => controller.abort();
  }, [canView, token, unitsOwnerId]);

  const [categories, setCategories] = useState<
    Awaited<ReturnType<typeof assetCategoriesApi.list>>["items"]
  >([]);
  useEffect(() => {
    if (!canView) return;
    const controller = new AbortController();
    void assetCategoriesApi
      .list(token, true, controller.signal)
      .then((response) => setCategories(response.items))
      .catch(() => setCategories([]));
    return () => controller.abort();
  }, [canView, token]);

  const selectedUnits = useMemo(() => readUnitFilter(params), [params]);
  const unitRows = useMemo(() => {
    const pathById = new Map(
      buildSiteOptions(units).map((option) => [option.id, option.label]),
    );
    return buildSiteTree(units).map(({ unit, depth }) => ({
      unit,
      depth,
      path: pathById.get(unit.id) ?? unit.name,
    }));
  }, [units]);

  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };

  const setCategoryFilter = (value: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete("category");
    next.delete("categoryId");
    if (value === NINCS_KATEGORIA) next.set("category", "without");
    else if (value) next.set("categoryId", value);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };
  const categoryFilterValue =
    params.get("category") === "without"
      ? NINCS_KATEGORIA
      : (params.get("categoryId") ?? "");

  const selectStatus = (key: string) => {
    filter("status", key === activeStatus ? "ALL" : key);
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
        title="Nincs hozzáférésed az eszköznyilvántartáshoz"
        description="service.view jogosultság szükséges."
      />
    );

  const counts = data?.counts ?? null;
  const tabCounts: Record<string, number | null> = counts
    ? {
        ALL: Object.values(counts).reduce((sum, value) => sum + value, 0),
        IN_PLACE: Object.entries(counts).reduce(
          (sum, [key, value]) => (key === "RETIRED" ? sum : sum + value),
          0,
        ),
        ...counts,
      }
    : {};

  const panel = (
    <div className="flex-1">
      <div className="border-b border-pilot-grey-100 bg-white px-8">
        <div className="flex gap-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => selectStatus(t.key)}
              className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-all ${
                activeStatus === t.key
                  ? "border-pilot-aqua-600 text-pilot-aqua-700"
                  : "border-transparent text-pilot-grey-500 hover:text-pilot-grey-800"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  activeStatus === t.key
                    ? "bg-pilot-aqua-100 text-pilot-aqua-700"
                    : "bg-pilot-grey-100 text-pilot-grey-500"
                }`}
              >
                {tabCounts[t.key] ?? "…"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-pilot-grey-100 bg-white px-8 py-3">
        <div className="relative min-w-52 flex-1">
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pilot-grey-300"
          />
          <input
            type="text"
            aria-label="Eszköz keresése"
            title="Név, eszközszám, gyártó, modell, sorozatszám"
            placeholder="Eszköz keresése"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md py-1.5 pl-8 pr-3 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
          />
        </div>
        <select
          aria-label="Eszköztípus"
          value={params.get("kind") ?? ""}
          onChange={(event) => filter("kind", event.target.value)}
          className="cursor-pointer rounded-md py-1.5 pl-2.5 pr-6 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        >
          <option value="">Minden típus</option>
          {Object.entries(assetKindLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Kategória"
          value={categoryFilterValue}
          onChange={(event) => setCategoryFilter(event.target.value)}
          className="cursor-pointer rounded-md py-1.5 pl-2.5 pr-6 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        >
          <option value="">Minden kategória</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.isActive
                ? category.name
                : `${category.name} (kivezetett)`}
            </option>
          ))}
          <option value={NINCS_KATEGORIA}>Nincs kategória</option>
        </select>
        <select
          aria-label="Hány eszköz egy oldalon"
          value={params.get("pageSize") ?? DEFAULT_PAGE_SIZE}
          onChange={(event) => filter("pageSize", event.target.value)}
          className="cursor-pointer rounded-md py-1.5 pl-2.5 pr-6 text-sm text-pilot-grey-700 ring-1 ring-pilot-grey-200 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={String(size)}>
              {size} / oldal
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <div className="space-y-3 px-8 py-6" aria-label="Eszközök betöltése">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {data?.items.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-pilot-grey-100 bg-white">
                  {[
                    "Eszköz",
                    "Partner",
                    "Alegység",
                    "Kategória",
                    "Gyártó és modell",
                    "Hierarchia",
                    "Státusz",
                  ].map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((asset, index) => (
                  <tr
                    key={asset.id}
                    onClick={() => router.push(`/szerviz/eszkozok/${asset.id}`)}
                    className={`group cursor-pointer border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                      index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                    }`}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-pilot-grey-900 transition-colors group-hover:text-pilot-aqua-700">
                        {asset.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-pilot-grey-400">
                        {asset.assetNumber}
                        {asset.partnerInternalCode
                          ? ` · ${asset.partnerInternalCode}`
                          : ""}
                      </p>
                      {asset.labelCode ? (
                        <p className="mt-0.5 text-[11px] text-pilot-grey-400">
                          Matricakód:{" "}
                          <span className="font-mono">{asset.labelCode}</span>
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-600">
                      {asset.owner.displayName}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-500">
                      {asset.unit
                        ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                        : asset.owner.type === "SUPPLIER"
                          ? asset.address?.formatted
                            ? `Nincs pontosítva. ${asset.address.formatted}`
                            : "Nincs pontosítva."
                          : (asset.address?.formatted ?? "Nincs pontosítva.")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-pilot-grey-600">
                      {asset.category ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="text-pilot-grey-700">
                        {asset.manufacturer ?? "—"}
                      </p>
                      <p className="text-pilot-grey-400">
                        {asset.model ?? "—"}
                      </p>
                    </td>
                    <td className="max-w-[180px] truncate px-4 py-3 text-xs text-pilot-grey-500">
                      {asset.parent ? (
                        <>
                          Része:{" "}
                          <span className="font-medium">
                            {asset.parent.name}
                          </span>
                        </>
                      ) : asset.childCount ? (
                        `${asset.childCount} részegység`
                      ) : (
                        "Önálló eszköz"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PilotBadge
                        variant={assetStatusPilotVariant(asset.status)}
                      >
                        {assetStatusLabel[asset.status]}
                      </PilotBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-pilot-grey-100 bg-white px-8 py-3">
            <p className="text-xs text-pilot-grey-400">
              {data.items.length} / {data.pagination.totalItems} eszköz
            </p>
            {/*
              SZÁMOZOTT GOMBOK, NYÍL NÉLKÜL, A SAJÁT TERVKÖR SZERINT
              (2026-09-25, acrobot döntése): a web Eszköz lista terve
              (`EszközScreen.tsx` 439-447. sor) így adja, sötét (aktív)
              gombbal -- ez a lista saját mintája, nem a "prevNext"
              alapértelmezés.
            */}
            <Pagination
              position="bottom"
              variant="numberedGrey"
              page={data.pagination.page}
              totalPages={data.pagination.totalPages}
              onPageChange={goToPage}
            />
          </div>
        </>
      ) : data ? (
        <div className="p-5">
          <EmptyState
            title="Nincs találat"
            description="Módosítsd a szűrőket, vagy rögzíts új partnereszközt."
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <PilotThemeRoot className="-m-6 flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="flex items-center justify-between border-b border-pilot-grey-200 bg-white px-8 py-5">
        <div>
          <p className="mb-1 text-xs text-pilot-grey-400">
            Szerviz /{" "}
            <span className="font-medium text-pilot-grey-700">
              Eszköznyilvántartás
            </span>
          </p>
          <h1 className="text-xl font-semibold text-pilot-grey-900">
            Eszköznyilvántartás
          </h1>
        </div>
        {canManage ? (
          <Link href="/szerviz/eszkozok/uj">
            <PilotButton variant="primary">
              <Icon name="plus" size={14} />
              Új eszköz
            </PilotButton>
          </Link>
        ) : null}
      </div>

      {error ? (
        <div className="px-8 pt-4">
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

      {/*
        A HELYSZÍN-FA A RÉGI KINÉZETÉBEN MARAD -- lásd a fájl fejlécét: a
        Figma nem mutat ilyet, a mai fa TÖBBET tud (több csomópont
        egyszerre), ez a "varrat".
      */}
      {unitsFailed ? (
        <p className="px-8 pt-3 text-xs text-pilot-grey-400">
          A helyszín-szűrő most nem tölthető be. A többi szűrő működik.
        </p>
      ) : null}
      {unitRows.length > 0 ? (
        <div className="flex flex-1 items-start gap-0">
          <aside className="w-[190px] shrink-0 border-r border-line px-2 py-4">
            <h2 className="mb-2 px-[11px] text-[13px] font-bold text-ink">
              Helyszínek
            </h2>
            <button
              type="button"
              onClick={() =>
                router.replace(`${pathname}?${writeUnitFilter(params, [])}`)
              }
              className={`${sv.treeItem} ${
                selectedUnits.length === 0 ? sv.treeItemActive : ""
              }`}
            >
              <ServiceIcon name="building" className="size-4" />
              Minden helyszín
            </button>
            {unitRows.map(({ unit, depth, path }) => {
              const on = selectedUnits.includes(unit.id);
              const marked = unit.isActive ? path : `${path} · archivált`;
              return (
                <button
                  key={unit.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={marked}
                  title={marked}
                  style={{ paddingLeft: 11 + depth * 19 }}
                  onClick={() =>
                    router.replace(
                      `${pathname}?${writeUnitFilter(
                        params,
                        toggleUnitFilter(selectedUnits, unit.id),
                      )}`,
                    )
                  }
                  className={`${sv.treeItem} ${on ? sv.treeItemActive : ""}`}
                >
                  <ServiceIcon name="location" className="size-4" />
                  <span className="truncate">
                    {unit.name}
                    {unit.isActive ? "" : " · archivált"}
                  </span>
                </button>
              );
            })}
          </aside>
          {panel}
        </div>
      ) : (
        panel
      )}
    </PilotThemeRoot>
  );
}
