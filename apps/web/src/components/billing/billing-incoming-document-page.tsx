"use client";

import {
  Alert,
  Button,
  Icon,
  PilotButton,
  PilotDataGrid,
  PilotDataItem,
  PilotSection,
  PilotTotals,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  INCOMING_BANK_MATCH_LABELS,
  INCOMING_NOT_TO_PAIR_REASON_LABELS,
  INCOMING_PAYMENT_STATE_LABELS,
  INVOICE_FORMAT_LABELS,
  PERMISSIONS,
  type IncomingDocumentDetail,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { formatMoney, trimDecimal } from "./billing-editor-state";
import { PaymentBadge } from "./billing-payment";

const vatRateText = (rate: string) =>
  /^\d+(\.\d+)?$/.test(rate) ? `${trimDecimal(rate)}%` : rate;

/** A banki párosítás pirulája (a kifizetésé a közös `PaymentBadge`). */
const bankPillTone = (state: IncomingDocumentDetail["bankMatch"]["state"]) =>
  state === "PAIRED"
    ? "bg-pilot-aqua-50 text-pilot-aqua-700"
    : state === "NOT_TO_PAIR"
      ? "bg-pilot-grey-100 text-pilot-grey-700"
      : "bg-pilot-accent-warm-soft text-pilot-accent-warm-text";

/**
 * A BEJÖVŐ SZÁMLA ADATLAPJA, CSAK OLVASÁSRA (Balázs újraterv-promptja; a
 * kinézet a Figma 330:664 adatlapja, a vevő helyén a szállítóval). A
 * kifizetés és a banki párosítás SZÁRMAZTATOTT (#1367): kifizetés-adat
 * nélkül „Nincs adat” áll, nem „Nincs fizetve”. PDF-gomb csak ott van, ahol
 * a Számlázz.hu valódi PDF-et küldött.
 */
export function BillingIncomingDocumentPage({
  documentId,
}: {
  documentId: string;
}) {
  const { session } = useAuth();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_VIEW),
  );
  const [detail, setDetail] = useState<IncomingDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setDetail(
          await billingDocumentsApi.incomingDetail(token, documentId, signal),
        );
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError(
            cause instanceof Error
              ? cause.message
              : "A számla nem tölthető be.",
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
      const blob = await billingDocumentsApi.incomingPdf(token, documentId);
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
        title="A számla nem tölthető be"
        description={error}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Újrapróbálás
          </Button>
        }
      />
    );
  if (!detail)
    return (
      <PilotThemeRoot theme="light" className="space-y-6">
        <Skeleton className="h-72" />
      </PilotThemeRoot>
    );

  const money = (value: string) => formatMoney(value, detail.currency);
  const bank = detail.bankMatch;
  // a jóváhagyott postafiókos számla (kártya e4c3b0fb): nem a Számlázz.hu küldte
  const mailbox = detail.origin === "MAILBOX" || detail.origin === "PURCHASE";
  // a beszerzésből jött sor (kártya 83f31a95) szövegei a postafiókoséi mellett
  const purchase = detail.origin === "PURCHASE";
  const formatText =
    detail.origin === "PURCHASE"
      ? "Beszerzésből"
      : mailbox
        ? "Postafiókból"
        : INVOICE_FORMAT_LABELS[detail.invoiceFormat];

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <Link
        href={`${BILLING_LIST_PATH}?nezet=bejovo`}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
      >
        <Icon name="chevron-left" size={14} />
        Vissza a listához
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-pilot-accent-warm-text">
            Bejövő {detail.kindLabel.toLowerCase()} · {formatText}
          </p>
          <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
            {detail.documentNumber}
          </h1>
          <p className="mt-2 text-sm text-pilot-grey-600">
            {detail.supplier.name}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <PaymentBadge
            paymentState={detail.paymentState}
            paidAmount={detail.paidAmount}
            lastPaymentDate={detail.lastPaymentDate}
            paymentSource={detail.paymentSource}
            paymentConflict={detail.paymentConflict}
            currency={detail.currency}
          />
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${bankPillTone(bank.state)}`}
          >
            {INCOMING_BANK_MATCH_LABELS[bank.state]}
          </span>
          {detail.cancelled ? (
            <span className="rounded-full bg-pilot-red-50 px-2.5 py-1 text-xs font-semibold text-pilot-red-700">
              Sztornózott
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <PilotSection
            title="Szállító"
            subtitle="A számlán szereplő szállítói adatok."
          >
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-pilot-grey-900">
                {detail.supplier.name}
              </p>
              <p className="text-pilot-grey-700">
                {detail.supplier.address ?? "Nincs cím"}
              </p>
              <p className="text-xs text-pilot-grey-500">
                {[
                  detail.supplier.taxNumber
                    ? `Adószám: ${detail.supplier.taxNumber}`
                    : "Nincs adószám",
                  detail.supplier.euTaxNumber
                    ? `EU adószám: ${detail.supplier.euTaxNumber}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-xs text-pilot-grey-500">
                Bankszámla: {detail.supplier.bankAccount ?? "nincs megadva"}
              </p>
            </div>
          </PilotSection>

          <PilotSection title="Bizonylat adatai">
            <PilotDataGrid columns={4}>
              <PilotDataItem label="Dokumentumtípus">
                {detail.kindLabel}
              </PilotDataItem>
              <PilotDataItem label="Formátum">{formatText}</PilotDataItem>
              <PilotDataItem label="Kelt">
                {formatDay(detail.issueDate)}
              </PilotDataItem>
              <PilotDataItem label="Teljesítés">
                {formatDay(detail.fulfillmentDate)}
              </PilotDataItem>
              <PilotDataItem label="Fizetési mód">
                {detail.paymentMethod ?? "—"}
              </PilotDataItem>
              <PilotDataItem label="Határidő">
                {formatDay(detail.dueDate)}
              </PilotDataItem>
              <PilotDataItem label="Pénznem">{detail.currency}</PilotDataItem>
              <PilotDataItem label="Árfolyam">
                {detail.exchangeRate
                  ? `${trimDecimal(detail.exchangeRate)}${detail.exchangeBank ? ` (${detail.exchangeBank})` : ""}`
                  : "—"}
              </PilotDataItem>
              <PilotDataItem label="Vevő">{detail.buyer.name}</PilotDataItem>
              <PilotDataItem label="Rendelésszám">
                {detail.orderNumber ?? "—"}
              </PilotDataItem>
              <PilotDataItem label="Hivatkozott számla">
                {detail.referencedInvoiceNumber ?? "—"}
              </PilotDataItem>
              <PilotDataItem label="Hivatkozott díjbekérő">
                {detail.referencedProformaNumber ?? "—"}
              </PilotDataItem>
            </PilotDataGrid>
            {detail.note ? (
              <p className="mt-4 text-sm text-pilot-grey-700">
                Megjegyzés: {detail.note}
              </p>
            ) : null}
          </PilotSection>

          <PilotSection title="Tételek" subtitle="A számla tételei.">
            {detail.lines.length ? (
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
                        {money(line.unitNet)} · ÁFA {vatRateText(line.vatRate)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-pilot-grey-900">
                      {money(line.grossAmount)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-pilot-grey-500">
                {mailbox
                  ? purchase
                    ? "A tételek a beszerzési számlán állnak, itt a PDF-ben láthatók."
                    : "A postafiókos számla tételei nincsenek rögzítve, a PDF-ben láthatók."
                  : "A Számlázz.hu nem küldött tételt."}
              </p>
            )}
          </PilotSection>

          <PilotSection title="ÁFA-összesítő" subtitle="Kulcsonként.">
            <ul className="divide-y divide-pilot-grey-100 text-sm">
              {detail.vatSummary.map((row) => (
                <li
                  key={row.vatRate}
                  className="grid grid-cols-4 gap-3 py-2 tabular-nums"
                >
                  <span className="font-medium text-pilot-grey-900">
                    {vatRateText(row.vatRate)}
                  </span>
                  <span className="text-right">
                    Nettó {money(row.netAmount)}
                  </span>
                  <span className="text-right">ÁFA {money(row.vatAmount)}</span>
                  <span className="text-right font-semibold">
                    {money(row.grossAmount)}
                  </span>
                </li>
              ))}
            </ul>
          </PilotSection>
        </div>

        <aside className="flex flex-col gap-6">
          <PilotSection
            title="Összesítés"
            subtitle={
              mailbox
                ? purchase
                  ? "A rögzített beszerzési számláról, ellenőrizve jóváhagyva."
                  : "A postafiókos számláról, ellenőrizve jóváhagyva."
                : "Ahogy a Számlázz.hu továbbította."
            }
          >
            <PilotTotals
              rows={[
                { label: "Nettó", value: money(detail.netAmount) },
                { label: "ÁFA", value: money(detail.vatAmount) },
                {
                  label: "Bruttó",
                  value: money(detail.grossAmount),
                  emphasis: true,
                },
              ]}
            />
          </PilotSection>

          <PilotSection
            title="Fizetés"
            subtitle={
              mailbox
                ? "A banki párosításból."
                : "A Számlázz.hu kifizetés-adata."
            }
          >
            {detail.paymentsKnown ? (
              <div className="space-y-3 text-sm">
                <p className="text-pilot-grey-700">
                  {INCOMING_PAYMENT_STATE_LABELS[detail.paymentState]}:{" "}
                  <span className="font-semibold tabular-nums text-pilot-grey-900">
                    {money(detail.paidAmount)}
                  </span>{" "}
                  / {money(detail.grossAmount)}
                </p>
                <ul className="divide-y divide-pilot-grey-100">
                  {detail.payments.map((payment, index) => (
                    <li
                      key={`${index}-${payment.date}`}
                      className="flex items-start justify-between gap-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block text-pilot-grey-900">
                          {formatDay(payment.date)} · {payment.title}
                        </span>
                        {payment.note ? (
                          <span className="block text-xs text-pilot-grey-500">
                            {payment.note}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {money(payment.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-pilot-grey-600">
                {mailbox
                  ? purchase
                    ? "Beszerzésből jött számla: a fizetés a banki párosításból ismert (a terhelések lent), ha a képe párosodott."
                    : "Postafiókos számla: a fizetés a banki párosításból ismert (a terhelések lent)."
                  : detail.paymentSource === "BANK_PAIRING"
                    ? "A Számlázz.hu ehhez a számlához nem küldött kifizetési adatot; nálunk fizetett a banki párosítás alapján (a terhelések lent)."
                    : "Nincs adat: a Számlázz.hu ehhez a számlához nem küldött kifizetési adatot. Ez nem azt jelenti, hogy nincs kifizetve."}
              </p>
            )}
          </PilotSection>

          <PilotSection
            title="Banki párosítás"
            subtitle="A Hiányzó számlák párosítása szerint."
          >
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-pilot-grey-900">
                {INCOMING_BANK_MATCH_LABELS[bank.state]}
              </p>
              {bank.reason ? (
                <p className="text-pilot-grey-600">
                  {INCOMING_NOT_TO_PAIR_REASON_LABELS[bank.reason]}
                </p>
              ) : null}
              {bank.debits.length ? (
                <ul className="divide-y divide-pilot-grey-100">
                  {bank.debits.map((debit, index) => (
                    <li
                      key={`${index}-${debit.bookingDate}`}
                      className="flex justify-between gap-3 py-2"
                    >
                      <span>Terhelés {formatDay(debit.bookingDate)}</span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(debit.amount, debit.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </PilotSection>

          <PilotSection
            title={
              purchase ? "Beszerzés" : mailbox ? "Postafiók" : "Számlázz.hu"
            }
            subtitle={
              mailbox
                ? purchase
                  ? "A számla a rögzített beszerzésből jött, és ellenőrizve lett."
                  : "A számla a postafiókból jött, és ellenőrizve lett."
                : "A továbbítás adatai."
            }
          >
            <PilotDataGrid>
              <PilotDataItem label="Típuskód">{detail.kindCode}</PilotDataItem>
              <PilotDataItem label="Változat">
                {detail.versionCount > 1
                  ? `a legutóbbi a ${detail.versionCount} közül`
                  : "egy"}
              </PilotDataItem>
              <PilotDataItem label="PDF">
                {detail.hasPdf ? "Elérhető" : "Ehhez a számlához nem érkezett"}
              </PilotDataItem>
            </PilotDataGrid>
            {detail.hasPdf ? (
              <div className="mt-4 space-y-2">
                <PilotButton
                  size="regular"
                  variant="secondary"
                  onClick={() => void openPdf()}
                  disabled={pdfBusy}
                >
                  PDF megnyitása
                </PilotButton>
                {pdfError ? (
                  <p role="alert" className="text-xs text-pilot-red-700">
                    {pdfError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </PilotSection>
        </aside>
      </div>
    </PilotThemeRoot>
  );
}
