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
  type BrandReviewListItem,
  type BrandReviewListResponse,
  type UnasApplySummary,
} from "@acropora/types";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { ApiError } from "@/lib/api/client";
import { importApi } from "@/lib/api/imports";

const statusLabels = {
  PENDING: "Függő",
  ACCEPTED: "Elfogadva",
  NO_BRAND: "Nincs márka",
} as const;

export function UnasBrandReviewPage({ batchId }: { batchId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<BrandReviewListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState<BrandReviewListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    "approve" | "apply" | "bulk-accept" | "bulk-no-brand" | null
  >(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [applyResult, setApplyResult] = useState<UnasApplySummary | null>(null);

  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PRODUCTS_MANAGE),
  );
  const token = session?.token ?? "";
  const query = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (!params.has("page")) params.set("page", "1");
    if (!params.has("pageSize")) params.set("pageSize", "25");
    return params;
  }, [searchParams]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canManage) return;
      setLoading(true);
      setError(null);
      try {
        setData(await importApi.brandReviews(token, batchId, query, signal));
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A review lista nem tölthető be.",
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [batchId, canManage, query, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = searchParams.get("search") ?? "";
      if (search === current) return;
      const next = new URLSearchParams(searchParams.toString());
      search ? next.set("search", search) : next.delete("search");
      next.set("page", "1");
      router.replace(`${pathname}?${next}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [pathname, router, search, searchParams]);

  if (!canManage)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a brand review-hoz"
        description="Az oldal használatához products.manage jogosultság szükséges."
      />
    );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    value ? next.set(key, value) : next.delete(key);
    next.set("page", "1");
    router.replace(`${pathname}?${next}`);
  };
  const mutate = async (
    item: BrandReviewListItem,
    decision: "ACCEPT" | "NO_BRAND" | "RESET",
    brandKey?: string,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await importApi.decideBrandReview(token, batchId, item.id, {
        decision,
        brandKey,
        expectedUpdatedAt: item.updatedAt,
      });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A döntés nem menthető.",
      );
      if (cause instanceof ApiError && cause.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };
  const runBulk = async () => {
    if (!data || !confirm?.startsWith("bulk")) return;
    const items = data.items.filter((item) => selected.has(item.id));
    setBusy(true);
    try {
      await importApi.decideBrandReviewsBulk(token, batchId, {
        reviewIds: items.map((item) => item.id),
        decision: confirm === "bulk-accept" ? "ACCEPT_SUGGESTED" : "NO_BRAND",
        expectedUpdatedAt: Object.fromEntries(
          items.map((item) => [item.id, item.updatedAt]),
        ),
      });
      setSelected(new Set());
      setConfirm(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A csoportos döntés nem menthető.",
      );
      setConfirm(null);
      await load();
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (confirmationText !== "APPROVE") return;
    setBusy(true);
    try {
      await importApi.approve(token, batchId);
      setConfirm(null);
      setConfirmationText("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A jóváhagyás sikertelen.",
      );
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (confirmationText !== `APPLY ${batchId.slice(0, 8)}`) return;
    setBusy(true);
    try {
      setApplyResult(await importApi.apply(token, batchId));
      setConfirm(null);
      setConfirmationText("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 0
          ? "A hálózati válasz bizonytalan. Ne indíts új Apply-t ellenőrzés nélkül; töltsd újra a batch riportját."
          : cause instanceof Error
            ? cause.message
            : "Az Apply sikertelen.",
      );
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="UNAS brand review" description={`Batch: ${batchId}`} />
      {error ? (
        <Alert
          variant="danger"
          title="A művelet nem sikerült"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Újrapróbálás
            </Button>
          }
        />
      ) : null}
      {loading && !data ? (
        <div className="space-y-3" aria-label="Betöltés">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : null}
      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard
              label="Összes review"
              value={String(data.summary.total)}
            />
            <StatCard label="Függő" value={String(data.summary.pending)} />
            <StatCard label="Elfogadva" value={String(data.summary.accepted)} />
            <StatCard
              label="Nincs márka"
              value={String(data.summary.noBrand)}
            />
          </div>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">
                  Review készültség: {data.summary.completionPercent}%
                </p>
                <p className="text-sm text-slate-500">
                  Batch állapot: {data.summary.batchStatus} · analysis:{" "}
                  {data.summary.analysisVersion}
                </p>
              </div>
              <Badge
                variant={data.summary.approvalEligible ? "success" : "warning"}
              >
                {data.summary.approvalEligible
                  ? "Jóváhagyható"
                  : "Még nem hagyható jóvá"}
              </Badge>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-teal-500"
                style={{ width: `${data.summary.completionPercent}%` }}
              />
            </div>
          </Card>
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-5">
              <Input
                aria-label="Keresés"
                placeholder="SKU, terméknév vagy márka"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                aria-label="Státusz"
                value={searchParams.get("status") ?? ""}
                onChange={(event) => setFilter("status", event.target.value)}
              >
                <option value="">Minden státusz</option>
                <option value="PENDING">Függő</option>
                <option value="ACCEPTED">Elfogadva</option>
                <option value="NO_BRAND">Nincs márka</option>
              </Select>
              <Select
                aria-label="Ok"
                value={searchParams.get("reason") ?? ""}
                onChange={(event) => setFilter("reason", event.target.value)}
              >
                <option value="">Minden ok</option>
                {Object.keys(data.summary.reasons).map((reason) => (
                  <option key={reason}>{reason}</option>
                ))}
              </Select>
              <Select
                aria-label="Bizonyosság"
                value={searchParams.get("confidence") ?? ""}
                onChange={(event) =>
                  setFilter("confidence", event.target.value)
                }
              >
                <option value="">Minden bizonyosság</option>
                <option value="high">Magas</option>
                <option value="medium">Közepes</option>
                <option value="low">Alacsony</option>
                <option value="none">Nincs</option>
              </Select>
              <Select
                aria-label="Oldalméret"
                value={String(data.pageSize)}
                onChange={(event) => setFilter("pageSize", event.target.value)}
              >
                <option>10</option>
                <option>25</option>
                <option>50</option>
                <option>100</option>
              </Select>
            </div>
          </Card>
          {data.items.length === 0 ? (
            <EmptyState
              title={
                data.summary.total ? "Nincs találat" : "Nincs review feladat"
              }
              description={
                data.summary.total
                  ? "Módosítsd vagy töröld a szűrőket."
                  : "Ehhez a batchhez nem tartozik brand review sor."
              }
              action={
                data.summary.total ? (
                  <Button
                    variant="secondary"
                    onClick={() => router.replace(pathname)}
                  >
                    Szűrők törlése
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ReviewTable
              data={data}
              selected={selected}
              readOnly={data.summary.readOnly}
              busy={busy}
              onSelected={setSelected}
              onEvidence={setEvidence}
              onDecision={mutate}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!selected.size || data.summary.readOnly}
                onClick={() => setConfirm("bulk-accept")}
              >
                Kijelölt javaslatok elfogadása
              </Button>
              <Button
                variant="secondary"
                disabled={!selected.size || data.summary.readOnly}
                onClick={() => setConfirm("bulk-no-brand")}
              >
                Kijelöltek: nincs márka
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={data.page <= 1}
                onClick={() => setFilter("page", String(data.page - 1))}
              >
                Előző
              </Button>
              <span className="text-sm">
                {data.page} / {data.totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={data.page >= data.totalPages}
                onClick={() => setFilter("page", String(data.page + 1))}
              >
                Következő
              </Button>
            </div>
          </div>
          <Card className="p-5">
            <h2 className="font-semibold">Jóváhagyás és alkalmazás</h2>
            <p className="mt-1 text-sm text-slate-500">
              A jóváhagyás nem alkalmazza az importot. Az Apply külön,
              megerősített művelet.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                disabled={!data.summary.approvalEligible || busy}
                onClick={() => setConfirm("approve")}
              >
                Batch jóváhagyása
              </Button>
              <Button
                variant="danger"
                disabled={data.summary.batchStatus !== "APPROVED" || busy}
                onClick={() => setConfirm("apply")}
              >
                Apply indítása
              </Button>
            </div>
          </Card>
          {(applyResult ?? data.summary.applyReport) ? (
            <ApplyReport result={(applyResult ?? data.summary.applyReport)!} />
          ) : null}
        </>
      ) : null}
      {evidence ? (
        <EvidenceDialog item={evidence} onClose={() => setEvidence(null)} />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          kind={confirm}
          count={selected.size}
          batchId={batchId}
          value={confirmationText}
          busy={busy}
          onValue={setConfirmationText}
          onCancel={() => {
            setConfirm(null);
            setConfirmationText("");
          }}
          onConfirm={() =>
            confirm === "approve"
              ? void approve()
              : confirm === "apply"
                ? void apply()
                : void runBulk()
          }
        />
      ) : null}
    </div>
  );
}

function ReviewTable({
  data,
  selected,
  readOnly,
  busy,
  onSelected,
  onEvidence,
  onDecision,
}: {
  data: BrandReviewListResponse;
  selected: Set<string>;
  readOnly: boolean;
  busy: boolean;
  onSelected(value: Set<string>): void;
  onEvidence(item: BrandReviewListItem): void;
  onDecision(
    item: BrandReviewListItem,
    decision: "ACCEPT" | "NO_BRAND" | "RESET",
    brandKey?: string,
  ): Promise<void>;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onSelected(next);
  };
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="p-3">
              <input
                aria-label="Oldal kijelölése"
                type="checkbox"
                checked={
                  data.items.length > 0 &&
                  data.items.every((item) => selected.has(item.id))
                }
                onChange={(event) =>
                  onSelected(
                    event.target.checked
                      ? new Set(data.items.map((item) => item.id))
                      : new Set(),
                  )
                }
              />
            </th>
            <th>Termék</th>
            <th>Javaslat</th>
            <th>Bizonyosság</th>
            <th>Ok</th>
            <th>Státusz</th>
            <th className="p-3">Műveletek</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id} className="border-b last:border-0">
              <td className="p-3">
                <input
                  aria-label={`${item.sku} kijelölése`}
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                />
              </td>
              <td>
                <strong>{item.productName}</strong>
                <div className="text-xs text-slate-500">
                  {item.sku} · sor {item.sourceRowNumber}
                </div>
              </td>
              <td>{item.candidates[0]?.brandName ?? "—"}</td>
              <td>{item.confidence}%</td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {item.reviewReasons.map((reason) => (
                    <Badge key={reason}>{reason}</Badge>
                  ))}
                </div>
              </td>
              <td>{statusLabels[item.status]}</td>
              <td className="p-3">
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onEvidence(item)}
                  >
                    Bizonyíték
                  </Button>
                  {item.candidates.map((candidate) => (
                    <Button
                      key={candidate.brandKey}
                      size="sm"
                      disabled={readOnly || busy}
                      onClick={() =>
                        void onDecision(item, "ACCEPT", candidate.brandKey)
                      }
                    >
                      {candidate.rank === 1
                        ? "Javaslat elfogadása"
                        : candidate.brandName}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={readOnly || busy}
                    onClick={() => void onDecision(item, "NO_BRAND")}
                  >
                    Nincs márka
                  </Button>
                  {item.status !== "PENDING" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readOnly || busy}
                      onClick={() => void onDecision(item, "RESET")}
                    >
                      Visszaállítás
                    </Button>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function EvidenceDialog({
  item,
  onClose,
}: {
  item: BrandReviewListItem;
  onClose(): void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
    >
      <Card className="max-h-[85vh] w-full max-w-3xl overflow-auto p-6">
        <div className="flex justify-between">
          <h2 id="evidence-title" className="text-lg font-semibold">
            Brand bizonyítékok – {item.sku}
          </h2>
          <Button variant="ghost" onClick={onClose}>
            Bezárás
          </Button>
        </div>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Explicit brand</dt>
            <dd>{item.sourceFacts.explicitBrand ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold">Gyártói cikkszám</dt>
            <dd>{item.sourceFacts.manufacturerPartNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold">Elsődleges kategória</dt>
            <dd>{item.sourceFacts.primaryCategory ?? "—"}</dd>
          </div>
          <div>
            <dt className="font-semibold">Alternatív kategóriák</dt>
            <dd>{item.sourceFacts.alternativeCategories.join(", ") || "—"}</dd>
          </div>
        </dl>
        <h3 className="mt-5 font-semibold">Mentett jelöltek</h3>
        {item.candidates.length ? (
          item.candidates.map((candidate) => (
            <div
              key={candidate.brandKey}
              className="mt-2 rounded-lg border p-3"
            >
              <strong>
                #{candidate.rank} {candidate.brandName} ({candidate.confidence}
                %)
              </strong>
              <div className="mt-2 space-y-2">
                {candidate.evidence.map((evidence, index) => (
                  <div key={`${evidence.source}-${index}`} className="text-sm">
                    <Badge>{evidence.source}</Badge> {evidence.rawValue} →{" "}
                    {evidence.matchedPattern} ({evidence.score})
                    <p className="text-slate-500">{evidence.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Nincs mentett brand jelölt.
          </p>
        )}
      </Card>
    </div>
  );
}

function ConfirmDialog({
  kind,
  count,
  batchId,
  value,
  busy,
  onValue,
  onCancel,
  onConfirm,
}: {
  kind: "approve" | "apply" | "bulk-accept" | "bulk-no-brand";
  count: number;
  batchId: string;
  value: string;
  busy: boolean;
  onValue(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const typed = kind === "approve" || kind === "apply";
  const phrase =
    kind === "approve" ? "APPROVE" : `APPLY ${batchId.slice(0, 8)}`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
    >
      <Card className="w-full max-w-lg p-6">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {kind === "approve"
            ? "Batch jóváhagyása"
            : kind === "apply"
              ? "Import alkalmazása"
              : `${count} kijelölt sor módosítása`}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {kind === "apply"
            ? "Ez adatbázisba ír. Hálózati bizonytalanságnál ellenőrizd a riportot újrapróbálás előtt."
            : kind.startsWith("bulk")
              ? "Csak az aktuális oldalon explicit kijelölt sorok változnak; rejtett oldalak nem."
              : "A batch ezután csak olvasható, az Apply nem indul el automatikusan."}
        </p>
        {typed ? (
          <div className="mt-4">
            <label className="text-sm font-medium" htmlFor="confirmation">
              Írd be: {phrase}
            </label>
            <Input
              id="confirmation"
              autoFocus
              value={value}
              onChange={(event) => onValue(event.target.value)}
            />
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Mégse
          </Button>
          <Button
            variant={kind === "apply" ? "danger" : "primary"}
            disabled={busy || (typed && value !== phrase)}
            onClick={onConfirm}
          >
            {busy ? "Folyamatban…" : "Megerősítés"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ApplyReport({ result }: { result: UnasApplySummary }) {
  const summary = Object.entries(result)
    .filter(
      ([key]) => !["batchId", "status", "appliedAt", "appliedBy"].includes(key),
    )
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `unas-apply-${result.batchId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Apply riport</h2>
      <p className="text-sm text-slate-500">
        Időtartam: szinkron végrehajtás; alkalmazva:{" "}
        {new Date(result.appliedAt).toLocaleString("hu-HU")}. StockMovement nem
        változott.
      </p>
      <pre className="mt-3 overflow-auto rounded bg-slate-950 p-4 text-xs text-white">
        {summary}
      </pre>
      <div className="mt-4 flex gap-2">
        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard.writeText(summary)}
        >
          Összegzés másolása
        </Button>
        <Button variant="secondary" onClick={download}>
          JSON letöltése
        </Button>
        <Link
          className="inline-flex items-center rounded-lg px-4 text-sm font-semibold text-teal-700"
          href="/products"
        >
          Terméklista
        </Link>
      </div>
    </Card>
  );
}
