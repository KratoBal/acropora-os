"use client";

import {
  Alert,
  ConfirmDialog,
  PilotBadge,
  PilotButton,
  PilotCard,
  PilotCardHeader,
  PilotPageHeader,
  Skeleton,
} from "@acropora/ui";
import {
  formatPercent,
  hasPermission,
  PERMISSIONS,
  type PartnerOrderDetailDto,
  type PartnerOrderDocumentDto,
  type PartnerOrderDocumentStepValue,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { partnerOrdersApi } from "@/lib/api/partner-orders";
import {
  errorText,
  formatQuantity,
  formatQuoteDay,
  formatQuoteMoney,
  isAbort,
} from "@/components/quotes/quote-format";

import {
  fileSizeText,
  grossOf,
  PARTNER_ORDER_STATUS,
  PARTNER_ORDER_STEP,
  PARTNER_ORDER_STEP_ORDER,
  PARTNER_ORDERS_PATH,
  richTextPlain,
} from "./partner-order-format";

type PriceMode = "NET" | "GROSS";

/**
 * EGY MEGRENDELÉS. A tételek és az összeg az elfogadott ajánlatéi, egy az egyben (nem másolat). A bruttó
 * és a nettó + ÁFA nézet között kapcsolni lehet: ez csak megjelenítés, a végösszeg ÁFA-kulcsonként, pontosan
 * a szervertől jön. A dokumentumok a lánc minden lépéséhez csatolhatók.
 */
export function PartnerOrderDetailPage({ orderId }: { orderId: string }) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.QUOTES_MANAGE),
  );
  const [order, setOrder] = useState<PartnerOrderDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PriceMode | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [uploading, setUploading] =
    useState<PartnerOrderDocumentStepValue | null>(null);
  const [removing, setRemoving] = useState<PartnerOrderDocumentDto | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const fileInputs = useRef<
    Partial<Record<PartnerOrderDocumentStepValue, HTMLInputElement | null>>
  >({});

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setLoading(true);
      setError(null);
      try {
        setOrder(await partnerOrdersApi.detail(token, orderId, signal));
      } catch (cause) {
        if (!isAbort(cause))
          setError(errorText(cause, "A megrendelés nem tölthető be."));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [canView, orderId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const upload = async (
    step: PartnerOrderDocumentStepValue,
    file: File | undefined,
  ) => {
    if (!file) return;
    setUploading(step);
    setDocumentError(null);
    try {
      await partnerOrdersApi.uploadDocument(token, orderId, step, file);
      await load();
    } catch (cause) {
      setDocumentError(errorText(cause, "A fájl nem tölthető fel."));
    } finally {
      setUploading(null);
      const input = fileInputs.current[step];
      if (input) input.value = "";
    }
  };

  const download = async (document_: PartnerOrderDocumentDto) => {
    setDocumentError(null);
    try {
      const blob = await partnerOrdersApi.downloadDocument(
        token,
        orderId,
        document_.id,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = document_.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setDocumentError(errorText(cause, "A dokumentum nem tölthető le."));
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setDocumentError(null);
    try {
      await partnerOrdersApi.deleteDocument(token, orderId, removing.id);
      setRemoving(null);
      await load();
    } catch (cause) {
      setDocumentError(errorText(cause, "A dokumentum nem törölhető."));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a megrendelésekhez"
        description="quotes.view jogosultság szükséges."
      />
    );
  if (error)
    return (
      <Alert
        variant="danger"
        title="Hiba történt"
        description={error}
        action={
          <PilotButton variant="secondary" onClick={() => void load()}>
            Újra
          </PilotButton>
        }
      />
    );
  if (loading && !order) return <Skeleton className="h-96 w-full" />;
  if (!order) return null;

  const shownMode: PriceMode =
    mode ?? (order.priceDisplay === "GROSS" ? "GROSS" : "NET");
  const money = (value: string | number) =>
    formatQuoteMoney(value, order.currency);
  const unitMoney = (value: string | number) =>
    formatQuoteMoney(value, order.currency, { fractionDigits: 2 });

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <Link
        href={PARTNER_ORDERS_PATH}
        className="text-sm text-pilot-blue-700 hover:underline"
      >
        ← Vissza a megrendelésekhez
      </Link>
      <PilotPageHeader
        eyebrow="Értékesítés / Megrendelések"
        title={order.orderNumber}
        description={order.title}
        actions={
          <PilotBadge variant={PARTNER_ORDER_STATUS[order.status].variant}>
            {PARTNER_ORDER_STATUS[order.status].label}
          </PilotBadge>
        }
      />

      {order.quoteAccepted ? null : (
        <Alert
          variant="danger"
          title="Az ajánlat elfogadása azóta megváltozott"
          description="Az elfogadást visszavonták, vagy másik verziót fogadtak el. Lent az aláírt változat tételei látszanak."
        />
      )}

      <PilotCard>
        <PilotCardHeader title="Partner és ajánlat" />
        <dl className="grid grid-cols-1 gap-x-8 gap-y-1 px-5 py-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-pilot-grey-600">Partner</dt>
            <dd className="font-semibold">{order.customer.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-pilot-grey-600">Adószám</dt>
            <dd>{order.customer.taxNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-pilot-grey-600">Cím</dt>
            <dd>{order.customer.address ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-pilot-grey-600">Ajánlat</dt>
            <dd>
              <Link
                href={`/ajanlatok/${order.quoteId}`}
                className="text-pilot-blue-700 hover:underline"
              >
                {order.quoteNumber}
              </Link>
              {` · ${order.quoteVersionNumber}. verzió`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-pilot-grey-600">Létrehozva</dt>
            <dd>
              {formatQuoteDay(order.createdAt)}
              {order.createdByName ? ` · ${order.createdByName}` : ""}
            </dd>
          </div>
        </dl>
      </PilotCard>

      <PilotCard>
        <PilotCardHeader
          title="Tételek"
          action={
            <div
              role="group"
              aria-label="Árak megjelenítése"
              className="flex gap-1"
            >
              {(
                [
                  ["NET", "Nettó + ÁFA"],
                  ["GROSS", "Bruttó"],
                ] as const
              ).map(([value, label]) => (
                <PilotButton
                  key={value}
                  size="regular"
                  variant={shownMode === value ? "primary" : "secondary"}
                  aria-pressed={shownMode === value}
                  onClick={() => setMode(value)}
                >
                  {label}
                </PilotButton>
              ))}
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-pilot-grey-200 text-left text-xs text-pilot-grey-600">
                <th className="w-10 px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">Megnevezés</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Mennyiség
                </th>
                <th className="px-3 py-1.5 font-medium">Egység</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Egységár ({shownMode === "GROSS" ? "bruttó" : "nettó"})
                </th>
                <th className="px-3 py-1.5 text-right font-medium">ÁFA</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Összeg ({shownMode === "GROSS" ? "bruttó" : "nettó"})
                </th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => {
                const description = richTextPlain(line.description);
                return (
                  <tr
                    key={line.quoteItemId}
                    className="border-b border-pilot-grey-100 align-top"
                  >
                    <td className="px-3 py-1 text-pilot-grey-600">
                      {line.position}
                    </td>
                    <td className="px-3 py-1">
                      <span className="font-medium">{line.name}</span>
                      {line.wasOptional ? (
                        <span className="ml-2 text-xs text-pilot-grey-600">
                          (választott opció)
                        </span>
                      ) : null}
                      {description ? (
                        <p className="whitespace-pre-line text-xs text-pilot-grey-600">
                          {description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-1 text-right">
                      {formatQuantity(line.quantity)}
                    </td>
                    <td className="px-3 py-1">{line.unit}</td>
                    <td className="px-3 py-1 text-right">
                      {unitMoney(
                        shownMode === "GROSS"
                          ? grossOf(line.unitNetPrice, line.vatRatePercent)
                          : line.unitNetPrice,
                      )}
                    </td>
                    <td className="px-3 py-1 text-right">
                      {formatPercent(line.vatRatePercent)}
                    </td>
                    <td className="px-3 py-1 text-right font-semibold">
                      {money(
                        shownMode === "GROSS"
                          ? grossOf(line.netAmount, line.vatRatePercent)
                          : line.netAmount,
                      )}
                    </td>
                  </tr>
                );
              })}
              {order.lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-4 text-center text-pilot-grey-600"
                  >
                    Nincs tétel.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="ml-auto w-full max-w-sm space-y-1 px-5 py-4 text-sm tabular-nums">
          {order.totals.byRate.map((rate) => (
            <div
              key={rate.vatRatePercent}
              className="flex justify-between text-pilot-grey-600"
            >
              <span>
                {money(rate.net)} nettó · {formatPercent(rate.vatRatePercent)}{" "}
                ÁFA
              </span>
              <span>{money(rate.vat)}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span>Nettó összesen</span>
            <span>{money(order.totals.net)}</span>
          </div>
          <div className="flex justify-between">
            <span>ÁFA összesen</span>
            <span>{money(order.totals.vat)}</span>
          </div>
          <div className="flex justify-between border-t border-pilot-grey-200 pt-1 text-base font-semibold">
            <span>Bruttó összesen</span>
            <span>{money(order.totals.gross)}</span>
          </div>
        </div>
      </PilotCard>

      <PilotCard>
        <PilotCardHeader title="Dokumentumok" />
        {documentError ? (
          <div className="px-5 pt-3">
            <Alert variant="danger" title={documentError} />
          </div>
        ) : null}
        <div className="divide-y divide-pilot-grey-100">
          {PARTNER_ORDER_STEP_ORDER.map((step) => {
            const documents = order.documents.filter((d) => d.step === step);
            return (
              <section key={step} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold">
                      {PARTNER_ORDER_STEP[step].label}
                      {documents.length > 0 ? (
                        <PilotBadge variant="success">
                          {`${documents.length} db`}
                        </PilotBadge>
                      ) : null}
                    </h4>
                    <p className="text-xs text-pilot-grey-600">
                      {PARTNER_ORDER_STEP[step].hint}
                    </p>
                  </div>
                  {canManage ? (
                    <>
                      <input
                        ref={(element) => {
                          fileInputs.current[step] = element;
                        }}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        className="sr-only"
                        aria-label={`${PARTNER_ORDER_STEP[step].label} fájl kiválasztása`}
                        onChange={(event) =>
                          void upload(step, event.target.files?.[0])
                        }
                      />
                      <PilotButton
                        size="regular"
                        variant="secondary"
                        disabled={uploading !== null}
                        onClick={() => fileInputs.current[step]?.click()}
                      >
                        {uploading === step ? "Feltöltés…" : "Csatolás"}
                      </PilotButton>
                    </>
                  ) : null}
                </div>
                {documents.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {documents.map((document_) => (
                      <li
                        key={document_.id}
                        className="flex flex-wrap items-center gap-3 text-sm"
                      >
                        <button
                          type="button"
                          className="font-medium text-pilot-blue-700 hover:underline"
                          onClick={() => void download(document_)}
                        >
                          {document_.fileName}
                        </button>
                        <span className="text-xs text-pilot-grey-600">
                          {fileSizeText(document_.sizeBytes)} ·{" "}
                          {formatQuoteDay(document_.createdAt)}
                          {document_.uploadedByName
                            ? ` · ${document_.uploadedByName}`
                            : ""}
                        </span>
                        {canManage ? (
                          <button
                            type="button"
                            className="text-xs text-pilot-grey-600 hover:text-red-700 hover:underline"
                            onClick={() => setRemoving(document_)}
                          >
                            Törlés
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
        </div>
      </PilotCard>

      <ConfirmDialog
        open={removing !== null}
        title={`${removing?.fileName ?? "A dokumentum"} törlése`}
        consequence="A csatolt fájl végleg törlődik a megrendelésről."
        recovery="Ha tévedésből törölted, töltsd fel újra az eredeti fájlt."
        confirmLabel="Törlés"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </PilotThemeRoot>
  );
}
