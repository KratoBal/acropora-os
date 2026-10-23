"use client";
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  PilotDataTable,
  PilotPageHeader,
  Skeleton,
  type PilotTableColumn,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  SUPPLIER_PRICE_LIST_FORMATS,
  SUPPLIER_PRICE_LIST_FORMAT_LABELS,
  type SupplierPriceListFormat,
  type SupplierPriceListSummary,
  type SupplierPriceListUploadResult,
  type SupplierSummary,
} from "@acropora/types";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import {
  PilotButton,
  PilotInput,
  PilotSelect,
  PilotThemeRoot,
} from "@/components/pilot/pilot-ui";
import { priceListsApi } from "@/lib/api/price-lists";
import { suppliersApi } from "@/lib/api/suppliers";

import { PurchasingTabs } from "./purchasing-pilot-shell";

/** Az elutasított sorok okai magyarul (a szerver kódjai: `price-list.types.ts`). */
const REJECT_REASON_LABELS: Record<string, string> = {
  NO_CODE: "nincs cikkszám",
  NO_PRICE: "nincs ár",
  BAD_PRICE: "az ár nem olvasható",
  TIER_PRICE_UNREADABLE: "a lépcsős ár nem olvasható",
  CONFLICTING_DUPLICATE: "ugyanaz a cikkszám más árral",
};

const FIELD_LABEL = "text-sm font-medium text-pilot-grey-700";

/** Today in Budapest (YYYY-MM-DD): between midnight and 02:00 the UTC day is still yesterday. */
export function todayText(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Budapest" });
}

function formatListDate(day: string): string {
  const [year, month, date] = day.split("-");
  return year && month && date ? `${year}. ${month}. ${date}.` : day;
}

/** Az összesítő, amit a feltöltés után a szerver ad; a számok a lista sorairól szólnak. */
export function UploadSummary({
  result,
}: {
  result: SupplierPriceListUploadResult;
}) {
  const reasons = Object.entries(result.rejectedByReason)
    .map(
      ([reason, count]) =>
        `${REJECT_REASON_LABELS[reason] ?? reason}: ${count}`,
    )
    .join(", ");
  const { matching } = result;
  return (
    <Alert
      variant="info"
      title={`Feltöltve: ${result.fileName}`}
      description={[
        `${result.rowCount} sor került be`,
        result.rejectedRowCount
          ? `${result.rejectedRowCount} sor kimaradt (${reasons})`
          : null,
        result.duplicateRows
          ? `${result.duplicateRows} azonos ismétlődő sor egyszer számít`
          : null,
        result.skippedRows
          ? `${result.skippedRows} nem adat sor átugorva`
          : null,
        `Termékpárosítás: ${matching.alreadyMatched} már kötött, ${matching.autoByEan} új vonalkód szerint, ${matching.autoByCode} új ismert cikkszám szerint, ${matching.conflicts} ütközés (ember dönt), ${matching.previouslyRejected} korábban elutasított (nem javasoljuk újra), ${matching.unmatched} párosítatlan.`,
      ]
        .filter(Boolean)
        .join(". ")}
    />
  );
}

/**
 * BESZÁLLÍTÓI ÁRLISTÁK (task beszallitoi-arlistak-3; Balázs 2026-10-23 10:24
 * UTC: mehet a párosítás és a beszerzési ár termékenként, beszállítónként).
 * A fájlt a beszállító adta, a FORMÁTUMOT TE VÁLASZTOD: ami nem illik rá, azt a
 * rendszer egészben elutasítja. A fájl nem tárolódik, csak a feldolgozott sorai.
 * Az ár a lista ára (listaár): hogy nettó-e, azt egy számlasor igazolja
 * (acrobot 35408).
 */
export function PriceListsPage() {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );

  const [suppliers, setSuppliers] = useState<SupplierSummary[]>([]);
  const [suppliersNote, setSuppliersNote] = useState<string | null>(null);
  const [lists, setLists] = useState<SupplierPriceListSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [format, setFormat] = useState<SupplierPriceListFormat | "">("");
  const [listDate, setListDate] = useState(todayText());
  const [currency, setCurrency] = useState("EUR");
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<SupplierPriceListUploadResult | null>(
    null,
  );
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoadError(null);
      try {
        setLists((await priceListsApi.list(token, "", signal)).items);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Az árlisták nem tölthetők be.",
          );
      }
    },
    [canView, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    suppliersApi
      .list(
        token,
        new URLSearchParams({
          kind: "SUPPLIER",
          pageSize: "100",
          status: "ACTIVE",
        }),
        controller.signal,
      )
      .then((response) => {
        setSuppliers(response.items);
        setSuppliersNote(
          response.pagination.totalItems > response.items.length
            ? `A választóban csak az első ${response.items.length} beszállító látszik (összesen ${response.pagination.totalItems}).`
            : null,
        );
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setSuppliersNote(
          cause instanceof Error
            ? `A beszállítók listája nem tölthető be: ${cause.message}`
            : "A beszállítók listája nem tölthető be.",
        );
      });
    return () => controller.abort();
  }, [canManage, token]);

  const ready = Boolean(
    supplierId && format && listDate && currency.trim() && file,
  );

  const upload = async () => {
    if (!ready || !file || !format) return;
    setBusy(true);
    setUploadError(null);
    setResult(null);
    try {
      setResult(
        await priceListsApi.upload(token, {
          supplierId,
          format,
          listDate,
          currency: currency.trim(),
          file,
        }),
      );
      setFile(null);
      setFileKey((key) => key + 1);
      await load();
    } catch (cause) {
      setUploadError(
        cause instanceof Error ? cause.message : "A feltöltés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setDeleteError(null);
    try {
      await priceListsApi.remove(token, id);
      setConfirmingId(null);
      await load();
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "A törlés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  };

  const columns: PilotTableColumn<SupplierPriceListSummary>[] = [
    {
      id: "supplier",
      header: "Beszállító",
      cell: (list) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-semibold text-pilot-grey-900">
            {list.supplierName}
          </span>
          <span className="truncate text-xs text-pilot-grey-500">
            {list.fileName}
          </span>
        </span>
      ),
    },
    {
      id: "format",
      header: "Formátum",
      width: "220px",
      cell: (list) => SUPPLIER_PRICE_LIST_FORMAT_LABELS[list.format],
    },
    {
      id: "date",
      header: "A lista dátuma",
      width: "130px",
      cell: (list) => formatListDate(list.listDate),
    },
    {
      id: "currency",
      header: "Pénznem",
      width: "90px",
      cell: (list) => list.currency,
    },
    {
      id: "rows",
      header: "Sorok",
      width: "130px",
      align: "right",
      cell: (list) =>
        list.rejectedRowCount
          ? `${list.rowCount} (+${list.rejectedRowCount} kimaradt)`
          : String(list.rowCount),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: <span className="sr-only">Törlés</span>,
            width: "120px",
            align: "right" as const,
            cell: (list: SupplierPriceListSummary) => (
              <PilotButton
                size="action"
                variant="secondary"
                disabled={busy}
                aria-label={`${list.fileName} törlése`}
                onClick={() => setConfirmingId(list.id)}
              >
                Törlés
              </PilotButton>
            ),
          },
        ]
      : []),
  ];

  if (!canView)
    return (
      <PilotThemeRoot className="space-y-6">
        <Alert
          variant="danger"
          title="Nincs hozzáférésed a beszerzéshez"
          description="purchasing.view jogosultság szükséges."
        />
      </PilotThemeRoot>
    );

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="Beszállítói árlisták"
        description="A beszállító árlistája (CSV): a lista sorai a beszerzési árat adják termékenként. A formátumot te választod; ami nem illik rá, azt a rendszer egészben elutasítja. A fájl nem tárolódik, csak a feldolgozott sorai. Az ár a lista ára: hogy nettó-e, azt egy számlasor igazolja."
      />
      <PurchasingTabs active="/beszerzes/arlistak" />

      {canManage ? (
        <section
          aria-label="Árlista feltöltése"
          className="rounded-2xl border border-pilot-grey-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-pilot-grey-900">
            Árlista feltöltése
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="pl-supplier" className={FIELD_LABEL}>
                Beszállító
              </label>
              <PilotSelect
                id="pl-supplier"
                value={supplierId}
                onChange={setSupplierId}
                chevron
              >
                <option value="">Válassz beszállítót</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </PilotSelect>
              {suppliersNote ? (
                <p role="status" className="text-xs text-pilot-amber-700">
                  {suppliersNote}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pl-format" className={FIELD_LABEL}>
                A fájl formátuma
              </label>
              <PilotSelect
                id="pl-format"
                value={format}
                onChange={(value) =>
                  setFormat(value as SupplierPriceListFormat | "")
                }
                chevron
              >
                <option value="">Válassz formátumot</option>
                {SUPPLIER_PRICE_LIST_FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {SUPPLIER_PRICE_LIST_FORMAT_LABELS[value]}
                  </option>
                ))}
              </PilotSelect>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pl-date" className={FIELD_LABEL}>
                A lista dátuma
              </label>
              <PilotInput
                id="pl-date"
                type="date"
                value={listDate}
                onChange={setListDate}
                max={todayText()}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="pl-currency" className={FIELD_LABEL}>
                Pénznem
              </label>
              <PilotInput
                id="pl-currency"
                value={currency}
                onChange={setCurrency}
                placeholder="EUR"
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <label htmlFor="pl-file" className={FIELD_LABEL}>
                Fájl
              </label>
              <input
                key={fileKey}
                id="pl-file"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="text-sm"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <PilotButton
              size="regular"
              disabled={!ready || busy}
              onClick={() => void upload()}
            >
              {busy ? "Feltöltés…" : "Feltöltés"}
            </PilotButton>
          </div>
          {uploadError ? (
            <div className="mt-4">
              <Alert
                variant="danger"
                title="A feltöltés nem sikerült"
                description={uploadError}
              />
            </div>
          ) : null}
          {result ? (
            <div className="mt-4">
              <UploadSummary result={result} />
            </div>
          ) : null}
        </section>
      ) : null}

      {deleteError ? (
        <Alert
          variant="danger"
          title="A törlés nem sikerült"
          description={deleteError}
        />
      ) : null}
      <ConfirmDialog
        open={confirmingId !== null}
        title="Törlöd ezt az árlistát?"
        consequence={`A lista sorai törlődnek${
          lists?.find((list) => list.id === confirmingId)
            ? ` (${lists.find((list) => list.id === confirmingId)!.fileName})`
            : ""
        }. A termékpárosítások megmaradnak.`}
        recovery="A fájlt nem tároljuk, de ugyanaz a fájl törlés után újra feltölthető."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => {
          if (confirmingId) void remove(confirmingId);
        }}
        onCancel={() => setConfirmingId(null)}
      />
      {loadError ? (
        <Alert
          variant="danger"
          title="Az árlisták nem tölthetők be"
          description={loadError}
        />
      ) : lists === null ? (
        <Skeleton className="h-40 w-full" />
      ) : lists.length === 0 ? (
        <EmptyState
          title="Még nincs feltöltött árlista"
          description="Tölts fel egy beszállítói árlistát a fenti űrlappal."
        />
      ) : (
        <PilotDataTable
          columns={columns}
          rows={lists}
          rowKey={(list) => list.id}
          minWidth={900}
        />
      )}
    </PilotThemeRoot>
  );
}
