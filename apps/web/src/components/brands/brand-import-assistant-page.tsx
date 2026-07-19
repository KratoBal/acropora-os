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
  StatCard,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type BrandImportAssistantResponse,
  type BrandImportAssistantRow,
  type BrandImportBatchOption,
  type BrandImportClassification,
  type BrandListResponse,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { brandsApi } from "@/lib/api/brands";

const labels: Record<BrandImportClassification, string> = {
  EXACT_CANONICAL_MATCH: "Pontos egyezés",
  ALIAS_MATCH: "Alias egyezés",
  EXTERNAL_MAPPING_MATCH: "Külső mapping",
  MISSING_BRAND: "Hiányzó márka",
  AMBIGUOUS: "Bizonytalan",
  ARCHIVED_MATCH: "Archivált egyezés",
  CONFLICT: "Ütközés",
};
const classes = Object.keys(labels) as BrandImportClassification[];

export function BrandImportAssistantPage() {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const [batches, setBatches] = useState<BrandImportBatchOption[]>([]);
  const [data, setData] = useState<BrandImportAssistantResponse | null>(null);
  const [brands, setBrands] = useState<BrandListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<BrandImportAssistantRow | null>(null);
  const [action, setAction] = useState<"create" | "alias" | "bulk" | null>(
    null,
  );
  const [canonicalName, setCanonicalName] = useState("");
  const [targetBrandId, setTargetBrandId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const batchId = params.get("batchId") ?? "";
  const query = useMemo(() => {
    const value = new URLSearchParams(params.toString());
    value.delete("batchId");
    value.delete("returnTo");
    value.delete("status");
    if (!value.has("page")) value.set("page", "1");
    if (!value.has("pageSize")) value.set("pageSize", "25");
    const classification = value.get("classification");
    if (classification)
      value.set("classification", classification.toUpperCase());
    return value;
  }, [params]);
  const navigate = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes))
        value ? next.set(key, value) : next.delete(key);
      router.replace(`${pathname}?${next}`);
    },
    [params, pathname, router],
  );
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        const options = await brandsApi.importBatches(token, signal);
        setBatches(options);
        const current = batchId || options[0]?.id;
        if (!batchId && current) {
          navigate({ batchId: current });
          return;
        }
        if (current)
          setData(await brandsApi.importRows(token, current, query, signal));
        else setData(null);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "Az asszisztens nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [batchId, canView, navigate, query, token],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== (params.get("search") ?? ""))
        navigate({ search, page: "1" });
    }, 350);
    return () => clearTimeout(timer);
  }, [navigate, params, search]);
  const loadTargets = async () => {
    if (brands) return;
    const q = new URLSearchParams({
      page: "1",
      pageSize: "100",
      status: "ACTIVE",
    });
    setBrands(await brandsApi.list(token, q));
  };
  const refreshAfter = async () => {
    setSelected(new Set());
    setAction(null);
    setDetail(null);
    setConfirmation("");
    await load();
  };
  const create = async () => {
    if (!detail || !canonicalName.trim()) return;
    try {
      await brandsApi.createFromImport(token, batchId, detail.id, {
        canonicalName,
        createAlias: true,
        createExternalMapping: false,
        expectedUpdatedAt: detail.updatedAt,
      });
      await refreshAfter();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A márka nem hozható létre.",
      );
      if (cause instanceof ApiError && cause.status === 409) await load();
    }
  };
  const alias = async () => {
    if (!detail || !targetBrandId) return;
    try {
      await brandsApi.mapImportAlias(token, batchId, detail.id, {
        brandId: targetBrandId,
        expectedUpdatedAt: detail.updatedAt,
      });
      await refreshAfter();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Az alias nem menthető.",
      );
      if (cause instanceof ApiError && cause.status === 409) await load();
    }
  };
  const bulk = async () => {
    const rows = data?.items.filter((row) => selected.has(row.id)) ?? [];
    if (confirmation !== `CREATE ${rows.length} BRANDS`) return;
    try {
      await brandsApi.bulkCreateFromImport(token, batchId, {
        rowIds: rows.map((row) => row.id),
        expectedUpdatedAt: Object.fromEntries(
          rows.map((row) => [row.id, row.updatedAt]),
        ),
      });
      await refreshAfter();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az atomi bulk művelet sikertelen.",
      );
      if (cause instanceof ApiError && cause.status === 409) await load();
    }
  };
  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed"
        description="products.view jogosultság szükséges."
      />
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Márkaimport asszisztens"
        description="A perzisztált UNAS forrásértékek kézi, biztonságos egyeztetése."
        actions={
          <Link href={params.get("returnTo") || "/admin/brands"}>
            <Button variant="secondary">Vissza</Button>
          </Link>
        }
      />
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Frissítés
            </Button>
          }
        />
      ) : null}
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <Select
          aria-label="Import batch"
          value={batchId}
          onChange={(e) => navigate({ batchId: e.target.value, page: "1" })}
        >
          <option value="">Válassz batch-et</option>
          {batches.map((batch) => (
            <option key={batch.id} value={batch.id}>
              {batch.sourceFileName} · {batch.status}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Forrásmárka keresése"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Forrás, alias, célmárka"
        />
        <Select
          aria-label="Besorolás"
          value={params.get("classification") ?? ""}
          onChange={(e) =>
            navigate({ classification: e.target.value, page: "1" })
          }
        >
          <option value="">Minden besorolás</option>
          {classes.map((item) => (
            <option key={item} value={item}>
              {labels[item]}
            </option>
          ))}
        </Select>
      </Card>
      {loading && !data ? (
        <div aria-label="Asszisztens betöltése" className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {classes.map((item) => (
              <button
                key={item}
                className="text-left"
                onClick={() => navigate({ classification: item, page: "1" })}
              >
                <StatCard
                  label={labels[item]}
                  value={String(data.summary.classifications[item])}
                />
              </button>
            ))}
          </div>
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong>
                  {data.summary.completed}/{data.summary.total}
                </strong>{" "}
                egyeztetve · {data.summary.completionPercent}% ·{" "}
                {data.summary.batch.status} ·{" "}
                {data.summary.batch.analysisVersion}
              </div>
              {canManage && selected.size ? (
                <Button onClick={() => setAction("bulk")}>
                  Kijelölt {selected.size} létrehozása
                </Button>
              ) : null}
            </div>
          </Card>
          {data.items.length ? (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Kijelölés</th>
                    <th>Forrás</th>
                    <th>Előfordulás</th>
                    <th>Besorolás</th>
                    <th>Cél / javaslat</th>
                    <th>Példák</th>
                    <th>Műveletek</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="p-3">
                        <input
                          aria-label={`${row.sourceValue} kijelölése`}
                          type="checkbox"
                          disabled={
                            !canManage ||
                            row.classification !== "MISSING_BRAND" ||
                            (selected.size >= 50 && !selected.has(row.id))
                          }
                          checked={selected.has(row.id)}
                          onChange={() =>
                            setSelected((old) => {
                              const next = new Set(old);
                              next.has(row.id)
                                ? next.delete(row.id)
                                : next.add(row.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        <strong>{row.sourceValue}</strong>
                        <div className="text-xs text-slate-500">
                          {row.normalizedSourceValue}
                        </div>
                      </td>
                      <td>{row.occurrenceCount}</td>
                      <td>
                        <Badge
                          variant={
                            row.classification.includes("MATCH")
                              ? "success"
                              : row.classification === "MISSING_BRAND"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {labels[row.classification] ?? row.classification}
                        </Badge>
                      </td>
                      <td>
                        {row.matchedBrand?.name ?? row.proposedCanonicalName}
                      </td>
                      <td>
                        {row.examples.map((example) => example.sku).join(", ")}
                        {row.remainingExampleCount
                          ? ` +${row.remainingExampleCount}`
                          : ""}
                      </td>
                      <td>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => setDetail(row)}
                          >
                            Részletek
                          </Button>
                          {canManage &&
                          row.classification === "MISSING_BRAND" ? (
                            <>
                              <Button
                                onClick={() => {
                                  setDetail(row);
                                  setCanonicalName(row.proposedCanonicalName);
                                  setAction("create");
                                }}
                              >
                                Létrehozás
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setDetail(row);
                                  setAction("alias");
                                  void loadTargets();
                                }}
                              >
                                Alias
                              </Button>
                            </>
                          ) : null}
                          {row.matchedBrand ? (
                            <Link href={`/admin/brands/${row.matchedBrand.id}`}>
                              <Button variant="secondary">Megnyitás</Button>
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : (
            <EmptyState
              title="Nincs egyeztetendő forrásmárka"
              description="A batch vagy az aktív szűrés nem tartalmaz találatot."
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    navigate({ classification: "", search: "", page: "1" })
                  }
                >
                  Szűrők törlése
                </Button>
              }
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={data.pagination.page <= 1}
              onClick={() =>
                navigate({ page: String(data.pagination.page - 1) })
              }
            >
              Előző
            </Button>
            <span className="self-center">
              {data.pagination.page} / {Math.max(1, data.pagination.totalPages)}
            </span>
            <Button
              variant="secondary"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() =>
                navigate({ page: String(data.pagination.page + 1) })
              }
            >
              Következő
            </Button>
          </div>
        </>
      ) : !loading ? (
        <EmptyState
          title="Nincs választható UNAS batch"
          description="Csak VALIDATED vagy APPROVED batch elemezhető."
        />
      ) : null}
      {detail && !action ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Forrásmárka részletei"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
        >
          <Card className="max-h-[85vh] w-full max-w-2xl overflow-auto p-6">
            <h2 className="text-lg font-semibold">{detail.sourceValue}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {detail.normalizedSourceValue} · {labels[detail.classification]}
            </p>
            <h3 className="mt-5 font-semibold">Indoklás</h3>
            <ul className="list-disc pl-5 text-sm">
              {detail.reasoning.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <h3 className="mt-5 font-semibold">Jelöltek</h3>
            <p className="text-sm">
              {detail.candidates
                .map(
                  (brand) =>
                    `${brand.name}${brand.isActive ? "" : " (archivált)"}`,
                )
                .join(", ") || "Nincs"}
            </p>
            <p className="mt-5 text-xs text-slate-500">
              Resolver: {detail.resolverVersion} · config:{" "}
              {detail.configVersion}
            </p>
            <Button
              className="mt-5"
              variant="secondary"
              onClick={() => setDetail(null)}
            >
              Bezárás
            </Button>
          </Card>
        </div>
      ) : null}
      {action ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Márkaegyeztetési művelet"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
        >
          <Card className="w-full max-w-xl space-y-4 p-6">
            <h2 className="text-lg font-semibold">
              {action === "create"
                ? "Új márka"
                : action === "alias"
                  ? "Alias hozzárendelése"
                  : `${selected.size} márka létrehozása`}
            </h2>
            {action === "create" ? (
              <>
                <Input
                  aria-label="Kanonikus márkanév"
                  value={canonicalName}
                  onChange={(e) => setCanonicalName(e.target.value)}
                />
                <p className="text-sm text-slate-500">
                  Az UNAS forrásérték alias lesz, ha eltér a kanonikus névtől.
                  Külső azonosító nem készül display névből.
                </p>
              </>
            ) : null}
            {action === "alias" ? (
              <Select
                aria-label="Célmárka"
                value={targetBrandId}
                onChange={(e) => setTargetBrandId(e.target.value)}
              >
                <option value="">Válassz aktív márkát</option>
                {brands?.items.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name} · {brand.usage.productCount} termék
                  </option>
                ))}
              </Select>
            ) : null}
            {action === "bulk" ? (
              <>
                <p className="text-sm">
                  Ez atomi módon módosítja a Brand master data-t, de nem fogad
                  el review döntést. Érintett termék-előfordulás:{" "}
                  {data?.items
                    .filter((row) => selected.has(row.id))
                    .reduce((sum, row) => sum + row.occurrenceCount, 0)}
                </p>
                <ul className="max-h-32 overflow-auto text-sm">
                  {data?.items
                    .filter((row) => selected.has(row.id))
                    .map((row) => (
                      <li key={row.id}>{row.proposedCanonicalName}</li>
                    ))}
                </ul>
                <Input
                  aria-label="Bulk megerősítés"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  placeholder={`CREATE ${selected.size} BRANDS`}
                />
              </>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAction(null)}>
                Mégse
              </Button>
              <Button
                disabled={
                  action === "create"
                    ? !canonicalName.trim()
                    : action === "alias"
                      ? !targetBrandId
                      : confirmation !== `CREATE ${selected.size} BRANDS`
                }
                onClick={() =>
                  void (action === "create"
                    ? create()
                    : action === "alias"
                      ? alias()
                      : bulk())
                }
              >
                Megerősítés
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
