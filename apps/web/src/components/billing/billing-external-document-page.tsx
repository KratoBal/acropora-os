"use client";

import {
  Alert,
  Button,
  Icon,
  PilotDataGrid,
  PilotDataItem,
  PilotSection,
  PilotTotals,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  INVOICE_FORMAT_LABELS,
  PERMISSIONS,
  type BillingExternalDocumentDetail,
} from "@acropora/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { formatMoney, trimDecimal } from "./billing-editor-state";
import { PaymentBadge } from "./billing-payment";

/** Az áfakulcs, ahogy a számlán áll: szám mellé %, a jelölés (AAM, TAM) magában. */
const vatRateText = (rate: string) =>
  /^\d+(\.\d+)?$/.test(rate) ? `${trimDecimal(rate)}%` : rate;

/**
 * A SZÁMLÁZZ.HU-BÓL KAPOTT KIMENŐ SZÁMLA ADATLAPJA (acrobot 25812): ugyanaz a
 * kinézet, mint a mieinké, CSAK OLVASÁSRA. Nincs szerkesztés, sztornó,
 * újraküldés, és PDF sincs: a Számlázz.hu nem adja, a számla egy másik
 * számlázóban készült.
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
  const [detail, setDetail] = useState<BillingExternalDocumentDetail | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

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

  return (
    <PilotThemeRoot theme="light" className="space-y-6">
      <Link
        href={BILLING_LIST_PATH}
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-pilot-grey-800 ring-1 ring-pilot-grey-200 hover:bg-pilot-grey-50"
      >
        <Icon name="chevron-left" size={14} />
        Vissza a listához
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-pilot-accent-warm-text">
            {detail.kindLabel} · {INVOICE_FORMAT_LABELS[detail.invoiceFormat]}
          </p>
          <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
            {detail.documentNumber}
          </h1>
          <p className="mt-2 text-sm text-pilot-grey-600">
            {detail.customer.name}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <ExternalBadge />
          {detail.cancelled ? (
            <span className="rounded-full bg-pilot-red-50 px-2.5 py-1 text-xs font-semibold text-pilot-red-700">
              Sztornózott
            </span>
          ) : null}
        </div>
      </header>

      <Alert
        variant="info"
        title="Külső bizonylat, csak olvasásra"
        description="Ez a számla egy másik számlázóban készült, a Számlázz.hu továbbította. Itt nem szerkeszthető, nem sztornózható és nem küldhető újra, és PDF sincs hozzá."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <PilotSection title="Vevő" subtitle="A számlán szereplő vevőadatok.">
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-pilot-grey-900">
                {detail.customer.name}
              </p>
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
                {detail.paymentMethod ?? "—"}
              </PilotDataItem>
              <PilotDataItem label="Határidő">
                {formatDay(detail.dueDate)}
              </PilotDataItem>
              <PilotDataItem label="Pénznem">{detail.currency}</PilotDataItem>
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
                      {formatMoney(line.unitNet, detail.currency)} · ÁFA{" "}
                      {vatRateText(line.vatRate)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-pilot-grey-900">
                    {formatMoney(line.grossAmount, detail.currency)}
                  </p>
                </li>
              ))}
            </ul>
          </PilotSection>
        </div>

        <aside className="flex flex-col gap-6">
          <PilotSection
            title="Összesítés"
            subtitle="Ahogy a Számlázz.hu továbbította."
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
            subtitle="Ahogy a Számlázz.hu nyilvántartja, a saját banki párosításával együtt."
          >
            <PaymentBadge payment={detail.payment} currency={detail.currency} />
            {detail.payments.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {detail.payments.map((payment, index) => (
                  <li
                    key={`${payment.date}-${index}`}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="text-pilot-grey-700">
                      {formatDay(payment.date)} · {payment.method}
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
          </PilotSection>
          <PilotSection title="Számlázz.hu" subtitle="A továbbítás adatai.">
            <PilotDataGrid>
              <PilotDataItem label="Bizonylatszám">
                {detail.documentNumber}
              </PilotDataItem>
              <PilotDataItem label="Típuskód">{detail.kindCode}</PilotDataItem>
              <PilotDataItem label="PDF">
                Nincs (a Számlázz.hu nem adja)
              </PilotDataItem>
              <PilotDataItem label="Változat">
                {detail.versionCount > 1
                  ? `a legutóbbi a ${detail.versionCount} közül`
                  : "egy"}
              </PilotDataItem>
            </PilotDataGrid>
          </PilotSection>
        </aside>
      </div>
    </PilotThemeRoot>
  );
}

/** A „Külső” jelölés: a listán és az adatlapon ugyanaz. */
export function ExternalBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-pilot-grey-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-pilot-grey-700">
      Külső
    </span>
  );
}
