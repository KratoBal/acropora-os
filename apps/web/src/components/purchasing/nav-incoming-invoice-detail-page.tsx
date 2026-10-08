"use client";
import { useAssistantEntity } from "../assistant/page-context";
import {
  Alert,
  PilotCallout,
  PilotPageHeader,
  PilotSection,
  Skeleton,
} from "@acropora/ui";
import {
  hasPermission,
  PERMISSIONS,
  type NavIncomingInvoiceDetail,
  type NavIncomingInvoiceLine,
} from "@acropora/types";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useReturnTo } from "@/components/navigation-history";
import {
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
  type PilotBadgeVariant,
} from "@/components/pilot/pilot-ui";
import { navIncomingInvoicesApi } from "@/lib/api/nav-incoming-invoices";

import { navGross } from "./nav-incoming-invoice-list-page";

function formatAmount(value: string | undefined, currency: string): string {
  if (!value) return "—";
  return `${Number(value).toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ${currency}`;
}

const day = (value: string | undefined) =>
  value ? new Date(value).toLocaleDateString("hu-HU") : "—";

const STATUS: Record<
  NavIncomingInvoiceDetail["status"],
  { label: string; variant: PilotBadgeVariant }
> = {
  NEW: { label: "Új", variant: "blue" },
  DATA_FETCHED: { label: "Betöltve", variant: "teal" },
  RECEIVED: { label: "Bevételezve", variant: "grey" },
  ERROR: { label: "Hiba", variant: "danger" },
};

const OPERATION: Record<
  NavIncomingInvoiceDetail["invoiceOperation"],
  { label: string; variant: PilotBadgeVariant }
> = {
  CREATE: { label: "Normál", variant: "grey" },
  MODIFY: { label: "Módosító", variant: "amber" },
  STORNO: { label: "Sztornó", variant: "amber" },
};

/** A terv csak olvasható mezője: címke, alatta keretes érték. */
function ReadonlyField({
  label,
  children,
  align = "left",
}: {
  label: string;
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs leading-4 text-pilot-grey-500">{label}</p>
      <p
        className={`mt-1.5 truncate rounded-lg border border-pilot-grey-200 bg-white px-3 py-2 text-sm text-pilot-grey-700 ${
          align === "right" ? "text-right" : ""
        }`}
      >
        {children}
      </p>
    </div>
  );
}

/** Egy NAV számlasor kártyaként (Figma 614:1369): név, kódok, a sor számai. */
function NavLineCard({
  line,
  currency,
}: {
  line: NavIncomingInvoiceLine;
  currency: string;
}) {
  const codes = [
    line.supplierSku ? `szállítói cikkszám ${line.supplierSku}` : null,
    line.ean ? `EAN ${line.ean}` : null,
  ].filter(Boolean);
  return (
    <li
      data-testid="nav-szamlasor"
      className="rounded-xl border border-pilot-grey-200 bg-white px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-pilot-grey-900">
            {line.description}
          </p>
          <p className="mt-0.5 text-xs text-pilot-grey-500">
            {[
              line.lineNumber !== null ? `NAV sor ${line.lineNumber}` : null,
              ...codes,
            ]
              .filter(Boolean)
              .join(" · ") || "NAV számlasor"}
          </p>
        </div>
        {line.isCharge ? <PilotBadge variant="grey">Díjsor</PilotBadge> : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.2fr)]">
        <ReadonlyField label="Számla" align="right">
          {line.quantity}
        </ReadonlyField>
        <ReadonlyField label="Egység">{line.unit}</ReadonlyField>
        <ReadonlyField label="Nettó egységár" align="right">
          {line.unitPrice ? formatAmount(line.unitPrice, currency) : "—"}
        </ReadonlyField>
        <ReadonlyField label="ÁFA" align="right">
          {line.vatRatePercent ? `${line.vatRatePercent}%` : "—"}
        </ReadonlyField>
        <div className="col-span-2 flex items-end justify-end sm:col-span-1">
          <p className="pb-2 text-sm font-semibold text-pilot-grey-900">
            {formatAmount(line.lineNetAmount, currency)}
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * A NAV SZÁMLA RÉSZLETEI (Figma 614:1369, „OS / Purchasing / NAV Invoice
 * Detail / Desktop”): fejléc a visszalépéssel, a forrás-sáv, a NAV
 * adatkapcsolat meleg sávja, a beszállító és a számla adatai egymás mellett,
 * a számlasorok kártyákként a nettó összeggel, alul a művelet-sáv. A
 * tartalom a mai: a termékpárosítás a bevételezés szerkesztőjében történik,
 * ezért itt nincs.
 */
export function NavIncomingInvoiceDetailPage({
  navInvoiceId,
}: {
  navInvoiceId: string;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const backToList = useReturnTo("/beszerzes/nav-szamlak");
  const token = session?.token ?? "";
  const canView = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_VIEW),
  );
  const canManage = Boolean(
    session && hasPermission(session.user, PERMISSIONS.PURCHASING_MANAGE),
  );

  const [detail, setDetail] = useState<NavIncomingInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useAssistantEntity("NAV számla", detail?.id, detail?.navInvoiceNumber);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    void navIncomingInvoicesApi
      .detail(token, navInvoiceId)
      .then(setDetail)
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "A NAV számla adatai nem tölthetők be.",
        ),
      )
      .finally(() => setLoading(false));
  }, [canView, navInvoiceId, token]);

  if (!canView)
    return (
      <Alert
        variant="danger"
        title="Nincs hozzáférésed ehhez a számlához"
        description="A megnyitáshoz purchasing.view jogosultság szükséges."
      />
    );

  const bookable =
    detail !== null &&
    canManage &&
    detail.status !== "RECEIVED" &&
    detail.invoiceOperation === "CREATE";

  return (
    <PilotThemeRoot className="space-y-6">
      <PilotPageHeader
        title="NAV számla részletei"
        description="A NAV Online Számla rendszerből lekért bejövő számla adatai és tételei."
        actions={
          <PilotButton variant="secondary" onClick={backToList.goBack}>
            {backToList.fromWithinApp ? "Vissza" : "Vissza a NAV számlákhoz"}
          </PilotButton>
        }
      />

      {loading ? (
        <div aria-label="NAV számla betöltése" className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="danger" title="Hiba történt" description={error} />
      ) : null}

      {detail ? (
        <>
          <section className="flex flex-col gap-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-3 sm:flex-row sm:items-center">
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-lg bg-pilot-aqua-700 px-4 py-2 text-sm font-semibold text-white">
                {detail.navInvoiceNumber}
              </span>
              <PilotBadge variant={STATUS[detail.status].variant}>
                {STATUS[detail.status].label}
              </PilotBadge>
            </div>
            <p className="min-w-0 flex-1 text-xs text-pilot-grey-500">
              A NAV-ból érkező számlaadatok csak olvashatók; a partner- és a
              termékpárosítás a bevételezésben történik.
            </p>
            <PilotBadge variant={OPERATION[detail.invoiceOperation].variant}>
              {OPERATION[detail.invoiceOperation].label}
            </PilotBadge>
          </section>

          <PilotCallout
            tone="warm"
            title="NAV adatkapcsolat"
            description={[
              `Lekérve: ${new Date(detail.insDate).toLocaleString("hu-HU")}`,
              `invoiceOperation: ${detail.invoiceOperation}`,
              detail.originalInvoiceNumber
                ? `eredeti számla: ${detail.originalInvoiceNumber}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />

          {detail.errorCode ? (
            <Alert
              variant="danger"
              title="A teljes számlaadat lekérdezése nem sikerült"
              description={`${detail.errorCode}. Próbáld újra a lap frissítésével.`}
            />
          ) : null}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <PilotSection
              title="Beszállító"
              subtitle={
                detail.supplierId
                  ? "A NAV adószáma alapján párosított OS partner."
                  : "Ezzel az adószámmal nincs OS partner; a bevételezésnél választható vagy felvehető."
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-pilot-grey-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-pilot-grey-900">
                    {detail.supplierName}
                  </p>
                  <p className="mt-0.5 text-xs text-pilot-grey-500">
                    {[
                      detail.supplierTaxNumber,
                      detail.supplierAddress
                        ? `${detail.supplierAddress.postalCode} ${detail.supplierAddress.city}, ${detail.supplierAddress.line1}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {detail.supplierId ? (
                  <PilotButton
                    variant="secondary"
                    onClick={() =>
                      router.push(`/partnerek/${detail.supplierId}`)
                    }
                  >
                    Megnyitás
                  </PilotButton>
                ) : null}
              </div>
              {detail.supplierId ? (
                <div className="mt-4">
                  <PilotBadge variant="success">Adószám egyezik</PilotBadge>
                </div>
              ) : null}
            </PilotSection>

            <PilotSection
              title="NAV számla adatai"
              subtitle="A NAV-ból lekért számlaadatok. Ezek ezen a képernyőn nem módosíthatók."
            >
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <ReadonlyField label="Számlaszám">
                  {detail.navInvoiceNumber}
                </ReadonlyField>
                <ReadonlyField label="Pénznem">{detail.currency}</ReadonlyField>
                <ReadonlyField label="Teljesítés">
                  {day(detail.invoiceDeliveryDate)}
                </ReadonlyField>
                <ReadonlyField label="Számla kelte">
                  {day(detail.invoiceIssueDate)}
                </ReadonlyField>
                <ReadonlyField label="Fizetési határidő">
                  {day(detail.paymentDate)}
                </ReadonlyField>
                <ReadonlyField label="Nettó összeg" align="right">
                  {formatAmount(detail.invoiceNetAmount, detail.currency)}
                </ReadonlyField>
                <ReadonlyField label="ÁFA" align="right">
                  {formatAmount(detail.invoiceVatAmount, detail.currency)}
                </ReadonlyField>
                <ReadonlyField label="Bruttó" align="right">
                  {formatAmount(navGross(detail), detail.currency)}
                </ReadonlyField>
                {detail.supplierBankAccountNumber ? (
                  <div className="col-span-2">
                    <ReadonlyField label="Beszállító bankszámlája">
                      {detail.supplierBankAccountNumber}
                    </ReadonlyField>
                  </div>
                ) : null}
              </div>
            </PilotSection>
          </div>

          <PilotSection
            title="NAV számlasorok"
            subtitle={`${detail.lines.length.toLocaleString("hu-HU")} tétel a NAV számlán. A termékpárosítás a bevételezésben történik.`}
          >
            {detail.lines.length ? (
              <>
                <ul className="space-y-3">
                  {detail.lines.map((line, index) => (
                    /*
                      A SORSZAM NEM KULCS: hianyozhat (`null`), es a NAV-ban sem
                      garantaltan egyedi. A sorrend a szamla sorrendje, es a
                      lista nem rendezodik at, tehat az index stabil.
                    */
                    <NavLineCard
                      key={index}
                      line={line}
                      currency={detail.currency}
                    />
                  ))}
                </ul>
                <div className="mt-5 flex justify-end border-t border-pilot-grey-200 pt-4">
                  <div className="text-right">
                    <p className="text-xs text-pilot-grey-500">Nettó összeg</p>
                    <p className="mt-1 text-[28px] font-semibold leading-[34px] text-pilot-grey-900">
                      {formatAmount(detail.invoiceNetAmount, detail.currency)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-pilot-grey-500">
                A tételek még nincsenek betöltve vagy a lekérdezés sikertelen
                volt.
              </p>
            )}
          </PilotSection>

          <section className="flex flex-col gap-3 rounded-2xl border border-pilot-grey-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-pilot-grey-900">
                {detail.lines.length.toLocaleString("hu-HU")} NAV számlasor
              </p>
              <p className="mt-0.5 text-xs text-pilot-grey-500">
                {detail.invoiceOperation !== "CREATE"
                  ? "Ez egy korábbi számla módosító vagy sztornó okirata, nem vételezhető be."
                  : detail.status === "RECEIVED"
                    ? "A számla be van vételezve."
                    : "A bevételezés szerkesztője a NAV számla adataival előtöltve nyílik."}
              </p>
            </div>
            {bookable ? (
              <PilotButton
                size="regular"
                disabled={detail.lines.length === 0}
                onClick={() =>
                  router.push(
                    `/beszerzes/uj?navInvoiceId=${encodeURIComponent(detail.id)}`,
                  )
                }
              >
                Bevételezés
              </PilotButton>
            ) : null}
            {detail.status === "RECEIVED" && detail.purchaseInvoiceId ? (
              <PilotButton
                size="regular"
                variant="secondary"
                onClick={() =>
                  router.push(`/beszerzes/${detail.purchaseInvoiceId}`)
                }
              >
                Ugrás a beszerzési számlához
              </PilotButton>
            ) : null}
          </section>
        </>
      ) : null}
    </PilotThemeRoot>
  );
}
