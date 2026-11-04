"use client";
import { useAssistantEntity } from "../assistant/page-context";

import {
  Alert,
  Button,
  Icon,
  PilotDataGrid,
  PilotDataItem,
  PilotSection,
  PilotTotals,
  Skeleton,
  PilotButton,
} from "@acropora/ui";
import {
  currencyLabel,
  hasPermission,
  INVOICE_FORMAT_LABELS,
  PERMISSIONS,
  type BillingExternalDocumentDetail,
  type ExternalBillingSource,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { formatMoney, trimDecimal } from "./billing-editor-state";
import { OWN_MARK_SOURCE_LABELS, PaymentBadge } from "./billing-payment";
import { ManualPaymentForm } from "./manual-payment-form";
import { BillingDetailHeader } from "./billing-detail-header";
import {
  PaperOriginalButton,
  PaperOriginalPill,
} from "./billing-paper-original";
import { pdfMissingText } from "./billing-pdf-state";

/** Az áfakulcs, ahogy a számlán áll: szám mellé %, a jelölés (AAM, TAM) magában. */
const vatRateText = (rate: string) =>
  /^\d+(\.\d+)?$/.test(rate) ? `${trimDecimal(rate)}%` : rate;

/** A külső bizonylat forrásának neve, a lapon mindenhol ugyanígy. */
export const EXTERNAL_SOURCE_NAME: Record<ExternalBillingSource, string> = {
  SZAMLAZZ: "Számlázz.hu",
  EBIZ: "OTP eBIZ",
};

/** a nyitott összeg (bruttó mínusz a kifizetett), a kézi kifizetés alapértéke */
function openAmount(detail: BillingExternalDocumentDetail): string {
  const decimals = detail.currency.toUpperCase() === "HUF" ? 0 : 2;
  const open =
    Math.abs(Number(detail.totals.grossAmount)) -
    Math.abs(Number(detail.paidAmount ?? "0"));
  return Math.max(open, 0).toFixed(decimals);
}

/** Miért nincs PDF, egy mondatban (a hibakód a lap alján marad). */
/**
 * A KÜLSŐ KIMENŐ SZÁMLA ADATLAPJA (acrobot 25812): ugyanaz a kinézet, mint a
 * mieinké, CSAK OLVASÁSRA. Nincs szerkesztés, sztornó, újraküldés; egy nyitott
 * számlára kézi kifizetés rögzíthető, az is a Számlázz.hu-ba (2026-11-04). A
 * Számlázz.hu-ból jött számla PDF-jét a feed nem adja; a Számlázz.hu-s letöltés
 * hozza (#1658, kézzel indított parancs), az OTP eBIZ-ből jötthöz a napi
 * szinkron (2026-10-02). Ha nincs, a `pdfMissingText` mondja meg, miért.
 */
export function BillingExternalDocumentPage({
  documentId,
}: {
  documentId: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_VIEW),
  );
  const canManageFinance = Boolean(
    session && hasPermission(session.user, PERMISSIONS.FINANCE_MANAGE),
  );
  // the manual payment writes to Számlázz.hu: the issuing permission, as on the server
  const canRecordPayment = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_ISSUE),
  );
  const [detail, setDetail] = useState<BillingExternalDocumentDetail | null>(
    null,
  );
  useAssistantEntity("Külső számla", detail?.id, detail?.documentNumber);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setDetail(
          await billingDocumentsApi.externalDetail(token, documentId, signal),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A bizonylat nem tölthető be.",
          );
      }
    },
    [canView, documentId, token],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const openPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const blob = await billingDocumentsApi.externalPdf(token, documentId);
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (cause) {
      setPdfError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    } finally {
      setPdfBusy(false);
    }
  };

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed a számlázáshoz"
        description="billing.view jogosultság szükséges."
      />
    );
  if (error)
    return (
      <Alert
        variant="danger"
        title="A bizonylat nem tölthető be"
        description={error}
        action={
          <PilotButton variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </PilotButton>
        }
      />
    );
  if (!detail)
    return (
      <PilotThemeRoot theme="light" className="space-y-6">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  const sourceName = EXTERNAL_SOURCE_NAME[detail.source];
  const ebiz = detail.source === "EBIZ";

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <Link
        href={BILLING_LIST_PATH}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
      >
        <Icon name="chevron-left" size={14} />
        Vissza a listához
      </Link>

      <BillingDetailHeader
        eyebrow={
          <>
            {detail.kindLabel} · {INVOICE_FORMAT_LABELS[detail.invoiceFormat]}
          </>
        }
        title={detail.documentNumber}
        subtitle={detail.customer.name}
        status={
          <>
            <ExternalBadge source={detail.source} />
            {detail.cancelled ? (
              <span className="rounded-full bg-pilot-red-50 px-2.5 py-1 text-xs font-semibold text-pilot-red-700">
                Sztornózott
              </span>
            ) : null}
            <PaperOriginalPill marked={detail.paperOriginal} />
          </>
        }
        actions={
          canManageFinance ? (
            <PaperOriginalButton
              marked={detail.paperOriginal}
              onToggle={(marked) =>
                billingDocumentsApi.setExternalPaperOriginal(
                  token,
                  documentId,
                  marked,
                )
              }
              onSaved={setDetail}
            />
          ) : null
        }
      />

      <Alert
        variant="info"
        title="Külső bizonylat, csak olvasásra"
        description={
          ebiz
            ? "Ez a számla az OTP eBIZ-ben készült, a napi szinkron hozta át. Itt nem szerkeszthető, nem sztornózható és nem küldhető újra."
            : // the PDF clause follows the stored PDF (the same pdfStorageKey the monthly outgoing
              // package reads); stated unconditionally, it denied a PDF the package carried (ACRW-2026/00547)
              `Ez a számla egy másik számlázóban készült, a Számlázz.hu továbbította. Itt nem szerkeszthető, nem sztornózható és nem küldhető újra${detail.pdfAvailable ? "." : ", és PDF sincs hozzá."}`
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <PilotSection title="Vevő" subtitle="A számlán szereplő vevőadatok.">
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-pilot-grey-900">
                {detail.customer.name}
              </p>
              {detail.customer.nameFromOrder ? (
                <p className="text-xs text-pilot-grey-500">
                  A név a webshop-rendelésből; a számlán a NAV elrejti.
                </p>
              ) : null}
              <p className="text-pilot-grey-700">
                {detail.customer.address ?? "Nincs cím"}
              </p>
              <p className="text-xs text-pilot-grey-500">
                {detail.customer.taxNumber
                  ? `Adószám: ${detail.customer.taxNumber}`
                  : "Nincs adószám"}
              </p>
            </div>
          </PilotSection>

          <PilotSection title="Bizonylat adatai">
            <PilotDataGrid columns={4}>
              <PilotDataItem label="Dokumentumtípus">
                {detail.kindLabel}
              </PilotDataItem>
              <PilotDataItem label="Formátum">
                {INVOICE_FORMAT_LABELS[detail.invoiceFormat]}
              </PilotDataItem>
              <PilotDataItem label="Kiállítás dátuma">
                {formatDay(detail.issueDate)}
              </PilotDataItem>
              <PilotDataItem label="Teljesítés">
                {formatDay(detail.fulfillmentDate)}
              </PilotDataItem>
              <PilotDataItem label="Fizetési mód">
                {detail.paymentMethod ?? detail.paymentMethodUnified ?? "—"}
              </PilotDataItem>
              <PilotDataItem label="Határidő">
                {formatDay(detail.dueDate)}
              </PilotDataItem>
              <PilotDataItem label="Pénznem">
                {currencyLabel(detail.currency)}
              </PilotDataItem>
            </PilotDataGrid>
          </PilotSection>

          <PilotSection title="Tételek" subtitle="A számla tételei.">
            <ul className="divide-y divide-pilot-grey-100">
              {detail.lines.map((line, index) => (
                <li
                  key={`${index}-${line.name}`}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-pilot-grey-900">
                      {line.name}
                    </p>
                    <p className="text-xs text-pilot-grey-500">
                      {trimDecimal(line.quantity)} {line.unit} ×{" "}
                      {formatMoney(line.unitNet, detail.currency, {
                        fractionDigits: 2,
                      })}{" "}
                      · ÁFA {vatRateText(line.vatRate)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-pilot-grey-900">
                    {formatMoney(line.grossAmount, detail.currency, {
                      fractionDigits: 2,
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </PilotSection>
        </div>

        <aside className="flex flex-col gap-6">
          <PilotSection
            title="Összesítés"
            subtitle={`Ahogy a(z) ${sourceName} adta.`}
          >
            <PilotTotals
              rows={[
                {
                  label: "Nettó",
                  value: formatMoney(detail.totals.netAmount, detail.currency),
                },
                {
                  label: "ÁFA",
                  value: formatMoney(detail.totals.vatAmount, detail.currency),
                },
                {
                  label: "Bruttó",
                  value: formatMoney(
                    detail.totals.grossAmount,
                    detail.currency,
                  ),
                  emphasis: true,
                },
              ]}
            />
          </PilotSection>
          <PilotSection
            title="Kifizetés"
            subtitle={
              ebiz
                ? "Ahogy az OTP eBIZ nyilvántartja."
                : "Ahogy a Számlázz.hu nyilvántartja, a saját banki párosításával együtt."
            }
          >
            <PaymentBadge
              paymentState={detail.paymentState}
              paidAmount={detail.paidAmount}
              lastPaymentDate={detail.lastPaymentDate}
              paymentSource={detail.paymentSource}
              currency={detail.currency}
            />
            {detail.payments.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {detail.payments.map((payment, index) => (
                  <li
                    key={`${payment.date}-${index}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-pilot-grey-700">
                      {formatDay(payment.date)} · {payment.title}
                      {payment.note ? (
                        <span className="block text-xs text-pilot-grey-500">
                          {payment.note}
                        </span>
                      ) : null}
                    </span>
                    <span className="whitespace-nowrap font-semibold tabular-nums text-pilot-grey-900">
                      {formatMoney(payment.amount, detail.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {detail.ownPaymentMarks.length > 0 ? (
              <div className="mt-3 border-t border-pilot-grey-100 pt-3">
                <p className="text-xs font-semibold text-pilot-grey-500">
                  Általunk beírva a Számlázz.hu-ba
                </p>
                <ul className="mt-2 space-y-2 text-sm">
                  {detail.ownPaymentMarks.map((mark, index) => (
                    <li
                      key={`${mark.source}-${mark.date}-${index}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-pilot-grey-700">
                        {formatDay(mark.date)} ·{" "}
                        {OWN_MARK_SOURCE_LABELS[mark.source]}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums text-pilot-grey-900">
                        {formatMoney(mark.amount, detail.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {canRecordPayment &&
            !ebiz &&
            !detail.cancelled &&
            detail.documentNumber &&
            (detail.paymentState === "UNPAID" ||
              detail.paymentState === "PARTIAL") ? (
              <ManualPaymentForm
                token={token}
                invoiceNumber={detail.documentNumber}
                defaultAmount={openAmount(detail)}
                onRecorded={() => void load()}
              />
            ) : null}
          </PilotSection>
          <PilotSection
            title={sourceName}
            subtitle={ebiz ? "A szinkron adatai." : "A továbbítás adatai."}
          >
            <PilotDataGrid>
              <PilotDataItem label="Bizonylatszám">
                {detail.documentNumber}
              </PilotDataItem>
              <PilotDataItem label="Típuskód">{detail.kindCode}</PilotDataItem>
              <PilotDataItem label="Rendelésszám">
                {detail.orderNumber ?? "—"}
              </PilotDataItem>
              <PilotDataItem label="PDF">
                {detail.pdfAvailable ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pdfBusy}
                    onClick={() => void openPdf()}
                  >
                    {pdfBusy ? "Megnyitás…" : "PDF megnyitása"}
                  </Button>
                ) : (
                  // a Számlázz.hu-s sor PDF-jét 2026-10-12 óta a letöltés hozza (#1658): a régi
                  // „a Számlázz.hu nem adja” szöveg ezt már nem mondta igazul
                  pdfMissingText(detail.pdfMissingReason, detail.source)
                )}
              </PilotDataItem>
              {ebiz ? null : (
                <PilotDataItem label="Változat">
                  {detail.versionCount > 1
                    ? `a legutóbbi a ${detail.versionCount} közül`
                    : "egy"}
                </PilotDataItem>
              )}
            </PilotDataGrid>
            {pdfError ? (
              <p role="alert" className="mt-3 text-sm text-pilot-red-700">
                {pdfError}
              </p>
            ) : null}
          </PilotSection>
        </aside>
      </div>
    </PilotThemeRoot>
  );
}

/**
 * A „Külső” jelölés: a listán és az adatlapon ugyanaz. Az OTP eBIZ-ből jött
 * számlán a forrás is ott áll (2026-10-02); a Számlázz.hu-s marad „Külső”.
 */
export function ExternalBadge({
  source = "SZAMLAZZ",
}: {
  source?: ExternalBillingSource | null;
}) {
  return (
    <span className="inline-flex items-center rounded-full bg-pilot-grey-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-pilot-grey-700">
      {source === "EBIZ" ? "Külső · eBIZ" : "Külső"}
    </span>
  );
}
