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
  type AssetListResponse,
  type AssetStatus,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildSiteOptions } from "@/lib/partners/site-tree";
import { suppliersApi } from "@/lib/api/suppliers";
import {
  readUnitFilter,
  toggleUnitFilter,
  writeUnitFilter,
} from "@/lib/partners/unit-filter";

import { useAuth } from "@/components/auth/auth-provider";
import { assetsApi } from "@/lib/api/assets";
import { assetKindLabel, assetStatusLabel } from "./asset-labels";

function statusVariant(status: AssetStatus) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "RETIRED") return "neutral" as const;
  return "warning" as const;
}

export function AssetListPage() {
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
  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", "25");
    if (!value.has("status")) value.set("status", "ACTIVE");
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
  /**
   * A VALASZTO CSAK SZERVIZ-PARTNER TULAJDONOSNAL JELENIK MEG, es ez nem
   * egyszerusites: az alegysegek a PARTNEREN at erhetok el (`/suppliers/:id/units`,
   * a partner tukor-vevojen lognak), globalis alegyseg-lista NINCS. Az eszkoz-lista
   * viszont tobb tulajdonos eszkozeit mutatja, tehat tulajdonos nelkul a valaszto
   * nem tudna mit felkinalni. Merve 2026-08-31.
   */
  const ownerId = params.get("ownerId") ?? "";
  const unitsOwnerId = params.get("ownerType") === "SUPPLIER" ? ownerId : "";
  const [units, setUnits] = useState<
    Awaited<ReturnType<typeof suppliersApi.units>>["items"]
  >([]);
  useEffect(() => {
    if (!canView || !unitsOwnerId) {
      setUnits([]);
      return;
    }
    const controller = new AbortController();
    void suppliersApi
      .units(token, unitsOwnerId, controller.signal)
      .then((response) => setUnits(response.items))
      // A HELYSZINEK HIANYA NEM TORI EL A LISTAT: a tobbi szuro mukodik
      // tovabb, es a valaszto egyszeruen nem kinal semmit.
      .catch(() => setUnits([]));
    return () => controller.abort();
  }, [canView, token, unitsOwnerId]);
  const selectedUnits = useMemo(() => readUnitFilter(params), [params]);
  const unitOptions = useMemo(() => buildSiteOptions(units), [units]);

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
        title="Nincs hozzáférésed az eszköznyilvántartáshoz"
        description="service.view jogosultság szükséges."
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Szerviz"
        title="Eszköznyilvántartás"
        description="Partnerekhez rendelt rendszerek, berendezések és részegységek QR-azonosítással."
        actions={
          canManage ? (
            <Link href="/szerviz/eszkozok/uj">
              <Button>Új eszköz</Button>
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
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            aria-label="Eszköz keresése"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Név, eszközszám, gyártó, modell, sorozatszám"
          />
          <Select
            aria-label="Eszköztípus"
            value={params.get("kind") ?? ""}
            onChange={(event) => filter("kind", event.target.value)}
          >
            <option value="">Minden típus</option>
            {Object.entries(assetKindLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Státusz"
            value={params.get("status") ?? "ACTIVE"}
            onChange={(event) => filter("status", event.target.value)}
          >
            <option value="ACTIVE">Aktív</option>
            <option value="OUT_OF_SERVICE">Nem üzemel</option>
            <option value="IN_REPAIR">Javítás alatt</option>
            <option value="RETIRED">Kivezetett</option>
            <option value="ALL">Minden státusz</option>
          </Select>
        </div>
        {unitsOwnerId && unitOptions.length > 0 ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-medium">Helyszínek</p>
            <div className="flex flex-wrap gap-2">
              {unitOptions.map((option) => {
                const on = selectedUnits.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className="flex items-center gap-2 rounded border px-2 py-1 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        router.replace(
                          `${pathname}?${writeUnitFilter(
                            params,
                            toggleUnitFilter(selectedUnits, option.id),
                          )}`,
                        )
                      }
                    />
                    {/* JELOLUNK, DE NEM SZURUNK (acrobot dontese, 2026-09-02
                        21:13). Egy eszkoz allhat archivalt helyszinen, es a
                        listat is akarhatja valaki epp arra szurni -- a
                        valasztas itt nem hoz letre semmit. A jeloles viszont
                        kell, kulonben a felhasznalo nem erti, miert nem
                        ajanljuk ugyanezt a helyszint az uj munkanal. */}
                    <span>
                      {option.label}
                      {option.isActive ? "" : " · archivált"}
                    </span>
                  </label>
                );
              })}
            </div>
            {selectedUnits.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  router.replace(`${pathname}?${writeUnitFilter(params, [])}`)
                }
              >
                Helyszín-szűrés törlése
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
      {loading && !data ? (
        <div className="space-y-3" aria-label="Eszközök betöltése">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data?.items.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="p-3">Eszköz</th>
                <th>Partner / hely</th>
                <th>Hierarchia</th>
                <th>Műszaki azonosító</th>
                <th>Státusz</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((asset) => (
                <tr key={asset.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/szerviz/eszkozok/${asset.id}`}
                      className="font-semibold text-slate-950 hover:text-teal-700"
                    >
                      {asset.name}
                    </Link>
                    <div className="mt-0.5 font-mono text-xs text-slate-500">
                      {asset.assetNumber}
                    </div>
                    {/* AZ UGYFEL SAJAT KODJA, csak ha VAN. A kereses eddig is
                        nezte, a sor viszont nem mutatta: az ugyfel felolvasta a
                        sajat kodjat, a talalat feljott, es semmi nem arulta el,
                        MIRE illeszkedett. A felirat azert kell melle, hogy ne
                        legyen osszekeverheto a mi eszkozszamunkkal -- az all
                        folotte, ugyanabban a betutipusban. */}
                    {asset.inventoryNumber ? (
                      <div className="mt-0.5 text-xs text-slate-500">
                        Leltári szám:{" "}
                        <span className="font-mono">
                          {asset.inventoryNumber}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className="font-medium">{asset.owner.displayName}</div>
                    {/* AZ ALEGYSEG A VALASZTOTT HELY, a cim a VISSZAESES.
                        Partner-tulajdonosnal a cim mindig a partner sajat
                        postai cime, tehat alegyseg nelkul ez nem valasztas
                        eredmenye -- es a listaban ez latszik a legkevesbe, mert
                        egy sorban minden helynek ugyanugy nez ki. Ezert all itt
                        is a jeloles, nem csak az adatlapon. */}
                    <div className="text-xs text-slate-500">
                      {asset.unit
                        ? `${asset.unit.path.join(" / ")} (${asset.unit.code})`
                        : asset.owner.type === "SUPPLIER"
                          ? asset.address?.formatted
                            ? `Nincs pontosítva. ${asset.address.formatted}`
                            : "Nincs pontosítva."
                          : (asset.address?.formatted ?? "Nincs pontosítva.")}
                    </div>
                  </td>
                  <td>
                    {asset.parent ? (
                      <span>
                        Része: <strong>{asset.parent.name}</strong>
                      </span>
                    ) : asset.childCount ? (
                      `${asset.childCount} részegység`
                    ) : (
                      "Önálló eszköz"
                    )}
                  </td>
                  <td>
                    {[asset.manufacturer, asset.model, asset.serialNumber]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td>
                    <Badge variant={statusVariant(asset.status)}>
                      {assetStatusLabel[asset.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : data ? (
        <EmptyState
          title="Nincs találat"
          description="Módosítsd a szűrőket vagy rögzíts új partnereszközt."
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
