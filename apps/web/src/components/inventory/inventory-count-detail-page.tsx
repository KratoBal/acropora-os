"use client";

import {
  Alert,
  PageHeader,
  Skeleton,
  PilotDataTable,
  PilotFileInput,
  type PilotTableColumn,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type InventoryCountDetail,
  type InventoryCountStatus,
} from "@acropora/types";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import { inventoryApi } from "@/lib/api/inventory";

const STATUS_LABEL: Record<InventoryCountStatus, string> = {
  DRAFT: "Piszkozat",
  UPLOADED: "Feltöltve",
  CORRECTED: "Korrigálva",
};

const STATUS_BADGE: Record<InventoryCountStatus, "amber" | "blue" | "success"> =
  {
    DRAFT: "amber",
    UPLOADED: "blue",
    CORRECTED: "success",
  };

type CountLine = InventoryCountDetail["lines"][number];

export const COUNT_LINE_TABLE_MIN_WIDTH = 960;

/** A line the count has not reached yet: only an uploaded or corrected count has them. */
export function isPendingLine(
  status: InventoryCountStatus,
  line: CountLine,
): boolean {
  return status !== "DRAFT" && line.countedQty === null;
}

/**
 * The difference shown for a line. While the counter types into a pending line the figure
 * follows the draft, before it is saved; otherwise it is the stored difference.
 */
export function lineDifference(
  line: CountLine,
  draft: string | undefined,
  pending: boolean,
): { label: string; value: number } {
  const draftNumber =
    pending && draft !== undefined && draft.trim() !== ""
      ? Number(draft)
      : null;
  if (draftNumber !== null && Number.isFinite(draftNumber)) {
    const value = draftNumber - Number(line.expectedQty);
    return { label: String(value), value };
  }
  return {
    label: line.differenceQty ?? "—",
    value: line.differenceQty ? Number(line.differenceQty) : 0,
  };
}

/*
  A TÉTELEK OSZLOPAI A KÖZÖS TÁBLÁN (UI-áttekintés, 3. csomag, 2026-11-03). Telefonon a tábla
  kártyalistává alakul: a cikkszám a kártya címe, a "Nincs megszámolva" jelzés mellette áll
  (külön "Figyelem" oszlop nem kell, a sor háttere is jelzi). A "UNAS szinkron" oszlop csak a
  korrigált leltárnál van, ezért az oszlopok függvényből jönnek.
*/
export function countLineColumns({
  status,
  canManage,
  lineDrafts,
  savingLineId,
  setDraft,
  saveLineCount,
}: {
  status: InventoryCountStatus;
  canManage: boolean;
  lineDrafts: Record<string, string>;
  savingLineId: string | null;
  setDraft: (lineId: string, value: string) => void;
  saveLineCount: (lineId: string, rawValue: string) => void;
}): PilotTableColumn<CountLine>[] {
  const columns: PilotTableColumn<CountLine>[] = [
    {
      id: "sku",
      header: "Cikkszám",
      width: "200px",
      cell: (line) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-dusk-700">{line.sku}</span>
          {isPendingLine(status, line) ? (
            <PilotBadge variant="amber">Nincs megszámolva</PilotBadge>
          ) : null}
        </span>
      ),
    },
    {
      id: "product",
      header: "Termék",
      cell: (line) => (
        <span className="text-sm text-dusk-600">{line.productName}</span>
      ),
    },
    {
      id: "expected",
      header: "Jelenlegi",
      width: "110px",
      align: "right",
      cell: (line) => line.expectedQty,
    },
    {
      id: "counted",
      header: "Leltározott",
      width: "150px",
      align: "right",
      cell: (line) => {
        if (!(isPendingLine(status, line) && canManage)) {
          return line.countedQty ?? "—";
        }
        return (
          <div className="flex flex-col items-end gap-1">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              aria-label={`Leltározott mennyiség – ${line.sku}`}
              className="w-24 rounded border border-dusk-300 px-2 py-1 text-right text-sm"
              value={lineDrafts[line.id] ?? ""}
              disabled={savingLineId === line.id}
              onChange={(event) => setDraft(line.id, event.target.value)}
              onBlur={(event) => saveLineCount(line.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
            {savingLineId === line.id ? (
              <span className="text-[11px] text-dusk-400">Mentés…</span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "difference",
      header: "Eltérés",
      width: "110px",
      align: "right",
      cell: (line) => {
        const { label, value } = lineDifference(
          line,
          lineDrafts[line.id],
          isPendingLine(status, line),
        );
        return (
          <span
            className={`font-semibold ${
              value > 0
                ? "text-emerald-600"
                : value < 0
                  ? "text-rose-600"
                  : "text-dusk-400"
            }`}
          >
            {label}
          </span>
        );
      },
    },
  ];
  if (status === "CORRECTED") {
    columns.push({
      id: "sync",
      header: "UNAS szinkron",
      width: "180px",
      cell: (line) => (
        <div>
          <PilotBadge
            variant={
              line.syncStatus === "OK"
                ? "success"
                : line.syncStatus === "FAILED"
                  ? "danger"
                  : "grey"
            }
          >
            {line.syncStatus === "OK"
              ? "OK"
              : line.syncStatus === "FAILED"
                ? "Hiba"
                : "Függőben"}
          </PilotBadge>
          {line.syncError ? (
            <p className="mt-1 text-xs text-rose-600">{line.syncError}</p>
          ) : null}
        </div>
      ),
    });
  }
  return columns;
}

export function InventoryCountDetailPage({ countId }: { countId: string }) {
  const { session } = useAuth();
  const backToList = useReturnTo("/raktar");
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, string>>({});
  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!canView) return;
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
  }, [canView, countId, token]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

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
    // Matches the surrounding `detail.status !== "CORRECTED" && canManage`
    // rendering guard for this whole action block.
    if (!canManage || !detail || downloading) return;
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
    if (!canManage || !detail || uploading) return;
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
    // Only reachable from the input rendered under `pending && canManage`.
    if (!canManage || !detail) return;
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
    // Matches the surrounding `detail.status === "UPLOADED" && canManage`
    // rendering guard.
    if (!canManage || !detail || applying) return;
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
          <PilotButton variant="secondary" onClick={backToList.goBack}>
            {backToList.fromWithinApp ? "Vissza" : "Vissza a listához"}
          </PilotButton>
        }
      />

      {loading ? (
        <PilotCard className="p-5">
          <Skeleton className="h-4 w-1/3" />
        </PilotCard>
      ) : null}

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {detail ? (
        <>
          <PilotCard>
            <PilotCardHeader
              title="Állapot"
              action={
                <PilotBadge variant={STATUS_BADGE[detail.status]}>
                  {STATUS_LABEL[detail.status]}
                </PilotBadge>
              }
            />
            <div className="space-y-4 p-5">
              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-dusk-400">Indította</dt>
                  <dd className="mt-1 text-dusk-700">
                    {detail.startedByName ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Létrehozva</dt>
                  <dd className="mt-1 text-dusk-700">
                    {new Date(detail.createdAt).toLocaleString("hu-HU")}
                  </dd>
                </div>
                <div>
                  <dt className="text-dusk-400">Feltöltve</dt>
                  <dd className="mt-1 text-dusk-700">
                    {detail.uploadedAt
                      ? new Date(detail.uploadedAt).toLocaleString("hu-HU")
                      : "—"}
                  </dd>
                </div>
              </dl>

              {detail.status !== "CORRECTED" && canManage ? (
                <div className="flex flex-col gap-3 rounded-lg border border-dusk-200 bg-dusk-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1 text-xs text-dusk-600">
                    <p className="font-semibold text-dusk-800">
                      1. Töltsd le az Excel sablont, majd írd be a leltározott
                      mennyiségeket.
                    </p>
                    <p>
                      A leltározott oszlop 0-val indul: amit nem írsz át, az a
                      korrekció után nulla készlet lesz.
                    </p>
                    <p>
                      2. Töltsd vissza a kitöltött fájlt, ellenőrizd az
                      eltéréseket, majd indítsd a korrekciót.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                    <PilotButton
                      variant="secondary"
                      onClick={downloadTemplate}
                      disabled={downloading}
                    >
                      {downloading ? "Letöltés…" : "Sablon letöltése"}
                    </PilotButton>
                    <div className="flex flex-col gap-1">
                      <PilotFileInput
                        ref={fileInputRef}
                        accept=".xlsx"
                        aria-label="Kitöltött leltár feltöltése"
                        className="text-xs"
                      />
                    </div>
                    <PilotButton onClick={uploadFile} disabled={uploading}>
                      {uploading ? "Feltöltés…" : "Feltöltés"}
                    </PilotButton>
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
                  description={`${detail.lines.filter((line) => line.countedQty === null).length} tétel Leltározott mennyisége üres, ezek a lista tetején, sárgával vannak kiemelve. A mennyiség közvetlenül itt is beírható, az eltérés azonnal kiszámolódik. A korrekció csak akkor indítható, ha mindegyiknél meg van adva az érték.`}
                />
              ) : null}

              {applySummary ? (
                <Alert
                  variant="info"
                  title={`Korrekció mozgásszám: ${applySummary.movementNumber}`}
                  description={`Készlet helyileg lekönyvelve ${applySummary.successCount} tételnél. A UNAS-szinkron a háttérben, ettől függetlenül fut - ennek állapota itt (lásd a UNAS szinkron oszlopot) frissül, ahogy lezajlik.`}
                />
              ) : null}

              {detail.status === "UPLOADED" && canManage ? (
                <div className="flex justify-end">
                  <PilotButton onClick={applyCorrection} disabled={applying}>
                    {applying ? "Korrekció folyamatban…" : "Korrekció indítása"}
                  </PilotButton>
                </div>
              ) : null}
            </div>
          </PilotCard>

          <PilotCard className="overflow-hidden">
            <PilotCardHeader
              title="Tételek"
              action={
                <span className="text-xs text-dusk-500">
                  {detail.lines.length.toLocaleString("hu-HU")} tétel
                </span>
              }
            />
            <PilotDataTable
              columns={countLineColumns({
                status: detail.status,
                canManage,
                lineDrafts,
                savingLineId,
                setDraft: (lineId, value) =>
                  setLineDrafts((previous) => ({
                    ...previous,
                    [lineId]: value,
                  })),
                saveLineCount,
              })}
              rows={detail.lines}
              rowKey={(line) => line.id}
              rowTestId="count-line-row"
              rowClassName={(line) =>
                isPendingLine(detail.status, line) ? "bg-amber-50" : ""
              }
              minWidth={COUNT_LINE_TABLE_MIN_WIDTH}
            />
          </PilotCard>
        </>
      ) : null}
    </div>
  );
}
