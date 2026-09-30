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
  BILLING_DOCUMENT_STATUS_LABELS,
  BILLING_EMAIL_STATUS_LABELS,
  billingEmailDelivery,
  getDocumentCapabilities,
  billingEmailModeFor,
  hasPermission,
  INVOICE_FORMAT_LABELS,
  PERMISSIONS,
  type BillingDocumentDetail,
  type BillingEmailMode,
} from "@acropora/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { PilotThemeRoot } from "@/components/pilot/pilot-ui";
import { billingDocumentsApi } from "@/lib/api/billing-documents";
import { BillingDocumentActions } from "./billing-document-actions";
import {
  BillingDocumentEmailDrawer,
  defaultBillingEmail,
  splitAddresses,
  type BillingEmailDraft,
} from "./billing-document-email-drawer";
import { BillingDocumentStatus } from "./billing-document-status";
import { BILLING_LIST_PATH, formatDay } from "./billing-document-table";
import { formatMoney, trimDecimal } from "./billing-editor-state";

const SOURCE_LABELS: Record<string, string> = {
  PROJECT: "Projekt",
  SALES_ORDER: "Webshop rendelés",
  POS_TRANSACTION: "POS tranzakció",
  SERVICE_JOB: "Szerviz munka",
  MANUAL: "Manuális",
};

const MODE_LABELS: Record<BillingEmailMode, string> = {
  SEND: "E-mail kiküldése",
  RETRY: "Kiküldés újrapróbálása",
  RESEND: "E-mail újraküldése",
};

/**
 * EGY BIZONYLAT RÉSZLETEI (Balázs briefje, 2026-09-30, 9-21. pont).
 *
 * A VEVŐ KIÁLLÍTOTT BIZONYLATNÁL A KIÁLLÍTÁSKORI PILLANATKÉP (brief 15. pont),
 * soha nem a partner mai adata. A szerver mondja meg, melyiket adja
 * (`customerSource`); amíg ezt nem mondja, a kártya kiírja, hogy a kiállításkori
 * adat nem ellenőrizhető, és nem állítja, hogy az van a számlán.
 *
 * A NYOMTATÁS ÉS A PDF A HIVATALOS, TÁROLT PDF (brief 12-13. pont): a felület
 * nem gyárt "hasonló" dokumentumot, és vázlatnál a két gomb tiltott.
 *
 * AZ ÚJRAKÜLDÉS SOHA NEM ÁLLÍT KI ÚJ BIZONYLATOT (brief 14. pont): csak a
 * kiküldés végpontját hívja, a kliens által adott `requestId`-val, így egy
 * dupla kattintás egy kézbesítés.
 */
export function BillingDocumentDetailPage({
  documentId,
}: {
  documentId: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_VIEW),
  );
  const canResend = Boolean(
    session && hasPermission(session.user, PERMISSIONS.BILLING_RESEND),
  );

  const [detail, setDetail] = useState<BillingDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [email, setEmail] = useState<BillingEmailDraft | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!canView) return;
      setError(null);
      try {
        setDetail(await billingDocumentsApi.detail(token, documentId, signal));
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

  const capabilities = getDocumentCapabilities(detail.documentType);
  const isDraft = detail.status === "DRAFT";
  const pdfAvailable =
    detail.status === "ISSUED" && detail.pdf?.available === true;
  const pdfReason = isDraft
    ? "Piszkozatnak nincs hivatalos PDF-je."
    : detail.status !== "ISSUED"
      ? "A bizonylat még nincs kiállítva."
      : "A hivatalos PDF nem érhető el.";
  const delivery = billingEmailDelivery(
    detail.documentType,
    detail.invoiceFormat,
  );
  /*
    A MÓD A KÖZÖS SZABÁLYBÓL (`billingEmailModeFor`, nautilus #1281): a szerver
    ugyanezzel utasítja el a rossz módot. `null`: most nem küldhető (nincs
    kiállítva, vagy épp küldés alatt).
  */
  const mode = billingEmailModeFor(
    detail.status,
    detail.delivery?.status ?? detail.emailStatus,
  );
  const emailDraft =
    email ??
    defaultBillingEmail(
      detail.documentType,
      detail.delivery?.lastAttempt?.recipients.to.join(", ") ??
        detail.customer?.email ??
        "",
    );
  const title = detail.documentNumber ?? "Piszkozat";
  const gross = formatMoney(detail.totals.grossAmount, detail.currency);

  const withPdf = async (use: (url: string) => void) => {
    setBusy(true);
    setActionError(null);
    try {
      const blob = await billingDocumentsApi.pdf(token, detail.id);
      use(URL.createObjectURL(blob));
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "A PDF nem tölthető le.",
      );
    } finally {
      setBusy(false);
    }
  };
  const print = () =>
    void withPdf((url) => {
      // A HIVATALOS PDF nyílik meg, és a böngésző nyomtatási előnézete (brief
      // 12. pont); nem a lap DOM-ja.
      const opened = window.open(url, "_blank");
      opened?.addEventListener("load", () => opened.print());
    });
  const download = () =>
    void withPdf((url) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  /**
   * A FIÓK A LEVELEZÉS OLDAL SABLONJÁVAL NYÍLIK (nautilus #1293): amíg a levélhez
   * senki nem nyúlt, a szerver vázlata lesz a kiinduló szöveg. Ha közben már
   * beleírtak, az nyer; ha a vázlat nem jön meg, a helyi alapszöveg marad, és
   * küldés előtt úgyis látszik, mi megy ki.
   */
  const openDrawer = () => {
    setDrawerOpen(true);
    if (email !== null) return;
    billingDocumentsApi
      .emailDraft(token, detail.id)
      .then((draft) =>
        setEmail(
          (current) =>
            current ?? {
              ...emailDraft,
              subject: draft.subject,
              body: draft.body,
            },
        ),
      )
      .catch(() => undefined);
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      const next = await billingDocumentsApi.email(token, detail.id, {
        requestId,
        mode: mode ?? "RESEND",
        to: splitAddresses(emailDraft.to),
        cc: splitAddresses(emailDraft.cc),
        bcc: splitAddresses(emailDraft.bcc),
        subject: emailDraft.subject,
        body: emailDraft.body,
      });
      setDetail(next);
      setDrawerOpen(false);
      // Egy SIKERES kérés után a következő újraküldés új kérés: új azonosító.
      setRequestId(crypto.randomUUID());
    } catch (cause) {
      // HIBÁNÁL AZ AZONOSÍTÓ MARAD: az újrapróbálás ugyanaz a kérés, a szerver
      // nem küld kétszer.
      setSendError(
        cause instanceof Error ? cause.message : "A levél nem ment ki.",
      );
    } finally {
      setSending(false);
    }
  };

  const customerNote =
    detail.customerSource === "ISSUED_SNAPSHOT"
      ? "A bizonylaton szereplő vevőadatok, a kiállítás pillanatában."
      : isDraft
        ? "Piszkozat: a partner mai adatai."
        : "A kiállításkori vevőadat még nem érhető el; a partner mai adatai látszanak, a bizonylaton más állhat.";

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
            {capabilities.label}
            {detail.invoiceFormat
              ? ` · ${INVOICE_FORMAT_LABELS[detail.invoiceFormat]}`
              : ""}
          </p>
          <h1 className="text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
            {title}
          </h1>
          <p className="mt-2 text-sm text-pilot-grey-600">
            {[
              detail.customer?.name,
              detail.sourceType
                ? `Forrás: ${SOURCE_LABELS[detail.sourceType] ?? detail.sourceType}${
                    detail.sourceId ? ` · ${detail.sourceId}` : ""
                  }`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-col items-start gap-3 lg:max-w-[360px] lg:items-end">
          <BillingDocumentStatus
            status={detail.status}
            emailStatus={detail.delivery?.status ?? detail.emailStatus}
          />
          <BillingDocumentActions
            pdfAvailable={pdfAvailable}
            pdfReason={pdfReason}
            onPrint={print}
            onDownload={download}
            busy={busy}
            resend={
              delivery === "NONE"
                ? null
                : {
                    label: MODE_LABELS[mode ?? "RESEND"],
                    enabled:
                      canResend &&
                      mode !== null &&
                      (detail.delivery?.canResend ?? false),
                    reason: !canResend
                      ? "Nincs jogosultságod e-mailt küldeni."
                      : mode === null
                        ? "Épp fut egy küldés, vagy a bizonylat még nincs kiállítva."
                        : "A kiküldéshez a hivatalos PDF kell, és az még nincs meg.",
                    onClick: openDrawer,
                  }
            }
          />
        </div>
      </header>

      {isDraft ? (
        <Alert
          variant="info"
          title="Piszkozat"
          description="Ennek a bizonylatnak még nincs hivatalos száma és PDF-je."
          action={
            <PilotButton
              size="action"
              onClick={() =>
                router.push(`${BILLING_LIST_PATH}/${detail.id}/szerkesztes`)
              }
            >
              Szerkesztés folytatása
            </PilotButton>
          }
        />
      ) : null}
      {actionError ? (
        <Alert
          variant="danger"
          title="A PDF nem érhető el"
          description={actionError}
        />
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <PilotSection title="Vevő" subtitle={customerNote}>
            {detail.customer ? (
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-pilot-grey-900">
                  {detail.customer.name}
                </p>
                <p className="text-pilot-grey-700">
                  {detail.customer.address ?? "Nincs cím"}
                </p>
                <p className="text-xs text-pilot-grey-500">
                  {[
                    detail.customer.taxNumber
                      ? `Adószám: ${detail.customer.taxNumber}`
                      : "Nincs adószám",
                    detail.customer.euTaxNumber
                      ? `EU adószám: ${detail.customer.euTaxNumber}`
                      : null,
                    detail.customer.email,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-pilot-grey-500">Nincs vevőadat.</p>
            )}
          </PilotSection>

          <PilotSection title="Bizonylat adatai">
            <PilotDataGrid columns={4}>
              <PilotDataItem label="Dokumentumtípus">
                {capabilities.label}
              </PilotDataItem>
              {detail.invoiceFormat ? (
                <PilotDataItem label="Formátum">
                  {INVOICE_FORMAT_LABELS[detail.invoiceFormat]}
                </PilotDataItem>
              ) : null}
              <PilotDataItem label="Kiállítás dátuma">
                {formatDay(detail.issueDate)}
              </PilotDataItem>
              <PilotDataItem label="Teljesítés">
                {formatDay(detail.fulfillmentDate)}
              </PilotDataItem>
              {capabilities.showsPaymentFields ? (
                <>
                  <PilotDataItem label="Fizetési mód">
                    {detail.paymentMethod ?? "—"}
                  </PilotDataItem>
                  <PilotDataItem label="Határidő">
                    {formatDay(detail.dueDate)}
                  </PilotDataItem>
                </>
              ) : null}
              <PilotDataItem label="Pénznem">{detail.currency}</PilotDataItem>
              <PilotDataItem label="Hivatkozás">
                {detail.reference ?? "—"}
              </PilotDataItem>
            </PilotDataGrid>
          </PilotSection>

          <PilotSection
            title="Tételek"
            subtitle="A bizonylat tételei és tételmegjegyzései."
          >
            <ul className="divide-y divide-pilot-grey-100">
              {detail.lines.map((line) => (
                <li
                  key={line.id}
                  className={`flex items-start justify-between gap-4 py-3 ${
                    line.kind === "DISCOUNT" ? "pl-4" : ""
                  }`}
                >
                  <div className="min-w-0 text-sm">
                    <p
                      className={
                        line.kind === "DISCOUNT"
                          ? "text-pilot-grey-600"
                          : "font-medium text-pilot-grey-900"
                      }
                    >
                      {line.description}
                    </p>
                    {line.kind === "ITEM" ? (
                      <p className="text-xs text-pilot-grey-500">
                        {trimDecimal(line.quantity)} {line.unit ?? ""} ×{" "}
                        {formatMoney(line.unitNet, detail.currency)} · ÁFA{" "}
                        {trimDecimal(line.vatRatePercent)}%
                      </p>
                    ) : null}
                    {line.comment ? (
                      <p className="mt-1 text-xs text-pilot-grey-600">
                        Megjegyzés: {line.comment}
                      </p>
                    ) : null}
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
            subtitle={
              detail.status === "ISSUED"
                ? "A Számlázz.hu által visszaigazolt összegek."
                : "A kiállításkor számolt összegek."
            }
          >
            <PilotTotals
              rows={[
                {
                  label: "Nettó",
                  value: formatMoney(detail.totals.netAmount, detail.currency),
                },
                ...detail.totals.byVatRate.map((rate) => ({
                  label: `ÁFA (${trimDecimal(rate.vatRatePercent)}%)`,
                  value: formatMoney(rate.vatAmount, detail.currency),
                })),
                { label: "Bruttó", value: gross, emphasis: true },
              ]}
            />
          </PilotSection>

          <PilotSection
            title="Számlázz.hu"
            subtitle="A kiállítás technikai adatai."
          >
            <PilotDataGrid>
              <PilotDataItem label="Bizonylatszám">
                {detail.szamlazz?.documentNumber ??
                  detail.documentNumber ??
                  "—"}
              </PilotDataItem>
              <PilotDataItem label="Státusz">
                {BILLING_DOCUMENT_STATUS_LABELS[detail.status]}
              </PilotDataItem>
              <PilotDataItem label="PDF">
                {pdfAvailable ? "Elérhető" : "Nem érhető el"}
              </PilotDataItem>
              <PilotDataItem label="Külső azonosító">
                {detail.szamlazz?.externalId ?? "—"}
              </PilotDataItem>
            </PilotDataGrid>
            {detail.szamlazz?.lastError ? (
              <p role="alert" className="mt-3 text-xs text-pilot-red-700">
                {detail.szamlazz.lastError}
              </p>
            ) : null}
          </PilotSection>

          {delivery !== "NONE" ? (
            <PilotSection
              title="Kiküldés"
              subtitle="Az értesítő levél állapota."
            >
              <PilotDataGrid>
                <PilotDataItem label="Címzett">
                  {detail.delivery?.lastAttempt?.recipients.to.join(", ") ??
                    detail.customer?.email ??
                    "—"}
                </PilotDataItem>
                <PilotDataItem label="Státusz">
                  {(detail.delivery?.status ?? detail.emailStatus)
                    ? BILLING_EMAIL_STATUS_LABELS[
                        (detail.delivery?.status ?? detail.emailStatus)!
                      ]
                    : "—"}
                </PilotDataItem>
                <PilotDataItem label="Küldve">
                  {detail.delivery?.lastAttempt?.at
                    ? new Date(detail.delivery.lastAttempt.at).toLocaleString(
                        "hu-HU",
                      )
                    : "—"}
                </PilotDataItem>
              </PilotDataGrid>
              {detail.delivery?.lastAttempt?.error ? (
                <div
                  role="alert"
                  className="mt-3 rounded-lg bg-pilot-red-50 px-4 py-3 text-xs text-pilot-red-700"
                >
                  <p className="font-semibold">A levél nem ment ki</p>
                  <p className="mt-1">{detail.delivery.lastAttempt.error}</p>
                </div>
              ) : null}
              <p className="mt-3 rounded-lg bg-pilot-aqua-50 px-4 py-3 text-xs text-pilot-aqua-700">
                A levél újraküldése nem állít ki új számlát.
              </p>
            </PilotSection>
          ) : null}
        </aside>
      </div>

      {delivery !== "NONE" ? (
        <BillingDocumentEmailDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          documentType={detail.documentType}
          format={detail.invoiceFormat}
          draft={emailDraft}
          onChange={setEmail}
          customerName={detail.customer?.name ?? ""}
          grossLabel={gross}
          meta={
            detail.dueDate
              ? `Fizetési határidő: ${formatDay(detail.dueDate)}`
              : ""
          }
          known={{
            customer_name: detail.customer?.name ?? "{{customer_name}}",
            document_number: detail.documentNumber ?? "{{document_number}}",
            invoice_number: detail.documentNumber ?? "{{invoice_number}}",
            gross_total: gross,
            due_date: detail.dueDate
              ? formatDay(detail.dueDate)
              : "{{due_date}}",
            order_number: detail.reference ?? "{{order_number}}",
            document_link: detail.szamlazz?.documentUrl ?? "{{document_link}}",
          }}
          submit={{
            label: MODE_LABELS[mode ?? "RESEND"],
            onSubmit: () => void send(),
            busy: sending,
            error: sendError,
          }}
        />
      ) : null}
    </PilotThemeRoot>
  );
}
