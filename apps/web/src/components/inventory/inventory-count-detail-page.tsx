"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type InventoryCountDetail,
  type InventoryCountStatus,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { inventoryApi } from "@/lib/api/inventory";

const STATUS_LABEL: Record<InventoryCountStatus, string> = {
  DRAFT: "Piszkozat",
  UPLOADED: "Feltöltve",
  CORRECTED: "Korrigálva",
};

const STATUS_BADGE: Record<
  InventoryCountStatus,
  "warning" | "info" | "success"
> = {
  DRAFT: "warning",
  UPLOADED: "info",
  CORRECTED: "success",
};

export function InventoryCountDetailPage({ countId }: { countId: string }) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.INVENTORY_MANAGE),
  );

  const [detail, setDetail] = useState<InventoryCountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [unmatchedRows, setUnmatchedRows] = useState<
    { sku: string; row: number }[]
  >([]);
  const [applySummary, setApplySummary] = useState<{
    movementNumber: string;
    successCount: number;
    failedCount: number;
  } | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, string>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    setLoading(true);
    void inventoryApi
      .detail(token, countId)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A leltár betöltése nem sikerült.",
        ),
      )
      .finally(() => setLoading(false));
  }, [countId, token]);

  useEffect(() => {
    if (!canView || !token) return;
    load();
  }, [canView, load, token]);

  if (!canView) {
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a leltárhoz"
        description="A megnyitáshoz inventory.view jogosultság szükséges."
      />
    );
  }

  const downloadTemplate = () => {
    if (!token || !detail || downloading) return;
    setDownloading(true);
    void inventoryApi
      .downloadTemplate(token, detail.id, `${detail.countNumber}.xlsx`)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A sablon letöltése nem sikerült.",
        ),
      )
      .finally(() => setDownloading(false));
  };

  const uploadFile = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!token || !detail || uploading) return;
    if (!file) {
      setError("Előbb válassz ki egy kitöltött XLSX fájlt a feltöltéshez.");
      return;
    }
    setUploading(true);
    setError(null);
    void inventoryApi
      .uploadCounts(token, detail.id, file)
      .then((result) => {
        setDetail(result.detail);
        setUnmatchedRows(result.unmatchedRows);
        setSelectedFileName(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A feltöltött fájl feldolgozása nem sikerült.",
        ),
      )
      .finally(() => setUploading(false));
  };

  const saveLineCount = (lineId: string, rawValue: string) => {
    if (!token || !detail) return;
    if (rawValue.trim() === "") return;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0) {
      setError("A leltározott mennyiség érvénytelen.");
      return;
    }
    setSavingLineId(lineId);
    setError(null);
    void inventoryApi
      .updateLineCount(token, detail.id, lineId, value)
      .then((updated) => {
        setDetail(updated);
        setLineDrafts((previous) => {
          const next = { ...previous };
          delete next[lineId];
          return next;
        });
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A mennyiség mentése nem sikerült.",
        ),
      )
      .finally(() => setSavingLineId(null));
  };

  const applyCorrection = () => {
    if (!token || !detail || applying) return;
    setApplying(true);
    setError(null);
    void inventoryApi
      .apply(token, detail.id)
      .then((result) => {
        setDetail(result.detail);
        setApplySummary({
          movementNumber: result.movementNumber,
          successCount: result.successCount,
          failedCount: result.failedCount,
        });
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A korrekció indítása nem sikerült.",
        ),
      )
      .finally(() => setApplying(false));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail ? detail.countNumber : "Leltár"}
        description={detail ? `Raktár: ${detail.warehouseName}` : undefined}
        actions={
          <Button variant="secondary" onClick={() => router.push("/raktar")}>
            Vissza a listához
          </Button>
        }
      />

      {loading ? (
        <Card className="p-5">
          <Skeleton className="h-4 w-1/3" />
        </Card>
      ) : null}

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {detail ? (
        <>
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Állapot</h2>
              <Badge variant={STATUS_BADGE[detail.status]}>
                {STATUS_LABEL[detail.status]}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-slate-400">Indította</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.startedByName ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Létrehozva</dt>
                  <dd className="mt-1 text-slate-700">
                    {new Date(detail.createdAt).toLocaleString("hu-HU")}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-400">Feltöltve</dt>
                  <dd className="mt-1 text-slate-700">
                    {detail.uploadedAt
                      ? new Date(detail.uploadedAt).toLocaleString("hu-HU")
                      : "—"}
                  </dd>
                </div>
              </dl>

              {detail.status !== "CORRECTED" && canManage ? (
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">
                      1. Töltsd le az Excel sablont, majd írd be a leltározott
                      mennyiségeket.
                    </p>
                    <p>
                      2. Töltsd vissza a kitöltött fájlt, ellenőrizd az
                      eltéréseket, majd indítsd a korrekciót.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={downloadTemplate}
                      disabled={downloading}
                    >
                      {downloading ? "Letöltés…" : "Sablon letöltése"}
                    </Button>
                    <div className="flex flex-col gap-1">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx"
                        aria-label="Kitöltött leltár feltöltése"
                        className="text-xs"
                        onChange={(event) =>
                          setSelectedFileName(
                            event.target.files?.[0]?.name ?? null,
                          )
                        }
                      />
                      {selectedFileName ? (
                        <span className="text-xs text-slate-500">
                          Kiválasztva: {selectedFileName}
                        </span>
                      ) : null}
                    </div>
                    <Button size="sm" onClick={uploadFile} disabled={uploading}>
                      {uploading ? "Feltöltés…" : "Feltöltés"}
                    </Button>
                  </div>
                </div>
              ) : null}

              {unmatchedRows.length > 0 ? (
                <Alert
                  variant="danger"
                  title="Néhány sor cikkszáma nem található"
                  description={`Ismeretlen cikkszámok: ${unmatchedRows
                    .map((row) => `${row.sku} (${row.row}. sor)`)
                    .join(", ")}`}
                />
              ) : null}

              {detail.status !== "DRAFT" &&
              detail.lines.some((line) => line.countedQty === null) ? (
                <Alert
                  variant="danger"
                  title="Vannak még meg nem számolt tételek"
                  description={`${detail.lines.filter((line) => line.countedQty === null).length} tétel Leltározott mennyisége üres — ezek a lista tetején, sárgával vannak kiemelve. A mennyiség közvetlenül itt is beírható, az eltérés azonnal kiszámolódik. A korrekció csak akkor indítható, ha mindegyiknél meg van adva az érték.`}
                />
              ) : null}

              {applySummary ? (
                <Alert
                  variant={applySummary.failedCount > 0 ? "danger" : "info"}
                  title={`Korrekció mozgásszám: ${applySummary.movementNumber}`}
                  description={`Sikeres UNAS szinkron: ${applySummary.successCount} tétel. Sikertelen: ${applySummary.failedCount} tétel.`}
                />
              ) : null}

              {detail.status === "UPLOADED" && canManage ? (
                <div className="flex justify-end">
                  <Button onClick={applyCorrection} disabled={applying}>
                    {applying ? "Korrekció folyamatban…" : "Korrekció indítása"}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-900">Tételek</h2>
              <span className="text-xs text-slate-500">
                {detail.lines.length.toLocaleString("hu-HU")} tétel
              </span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    {detail.status !== "DRAFT" ? (
                      <th className="px-5 py-3">Figyelem</th>
                    ) : null}
                    <th className="px-5 py-3">Cikkszám</th>
                    <th className="px-4 py-3">Termék</th>
                    <th className="px-4 py-3 text-right">Jelenlegi</th>
                    <th className="px-4 py-3 text-right">Leltározott</th>
                    <th className="px-4 py-3 text-right">Eltérés</th>
                    {detail.status === "CORRECTED" ? (
                      <th className="px-5 py-3">UNAS szinkron</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {detail.lines.map((line) => {
                    const pending =
                      detail.status !== "DRAFT" && line.countedQty === null;
                    const draft = pending ? lineDrafts[line.id] : undefined;
                    const draftNumber =
                      draft !== undefined && draft.trim() !== ""
                        ? Number(draft)
                        : null;
                    const hasLiveDraft =
                      pending &&
                      draftNumber !== null &&
                      Number.isFinite(draftNumber);
                    const differenceLabel = hasLiveDraft
                      ? String(draftNumber! - Number(line.expectedQty))
                      : (line.differenceQty ?? "—");
                    const difference = hasLiveDraft
                      ? draftNumber! - Number(line.expectedQty)
                      : line.differenceQty
                        ? Number(line.differenceQty)
                        : 0;
                    return (
                      <tr
                        key={line.id}
                        className={pending ? "bg-amber-50" : undefined}
                      >
                        {detail.status !== "DRAFT" ? (
                          <td className="px-5 py-3">
                            {pending ? (
                              <Badge variant="warning">Nincs megszámolva</Badge>
                            ) : null}
                          </td>
                        ) : null}
                        <td className="px-5 py-3 font-mono text-xs text-slate-700">
                          {line.sku}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {line.productName}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-slate-600">
                          {line.expectedQty}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-slate-600">
                          {pending && canManage ? (
                            <div className="flex flex-col items-end gap-1">
                              <input
                                type="number"
                                inputMode="decimal"
                                step="any"
                                aria-label={`Leltározott mennyiség – ${line.sku}`}
                                className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                                value={draft ?? ""}
                                disabled={savingLineId === line.id}
                                onChange={(event) =>
                                  setLineDrafts((previous) => ({
                                    ...previous,
                                    [line.id]: event.target.value,
                                  }))
                                }
                                onBlur={(event) =>
                                  saveLineCount(line.id, event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                              />
                              {savingLineId === line.id ? (
                                <span className="text-[11px] text-slate-400">
                                  Mentés…
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            (line.countedQty ?? "—")
                          )}
                        </td>
                        <td
                          className={`px-4 py-3 text-right text-sm font-semibold ${
                            difference > 0
                              ? "text-emerald-600"
                              : difference < 0
                                ? "text-rose-600"
                                : "text-slate-400"
                          }`}
                        >
                          {differenceLabel}
                        </td>
                        {detail.status === "CORRECTED" ? (
                          <td className="px-5 py-3">
                            <Badge
                              variant={
                                line.syncStatus === "OK"
                                  ? "success"
                                  : line.syncStatus === "FAILED"
                                    ? "danger"
                                    : "neutral"
                              }
                            >
                              {line.syncStatus === "OK"
                                ? "OK"
                                : line.syncStatus === "FAILED"
                                  ? "Hiba"
                                  : "Függőben"}
                            </Badge>
                            {line.syncError ? (
                              <p className="mt-1 text-xs text-rose-600">
                                {line.syncError}
                              </p>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
