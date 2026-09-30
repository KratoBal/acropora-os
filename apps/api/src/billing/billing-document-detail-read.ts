import {
  BILLING_DELIVERY_OUTCOMES,
  billingEmailDelivery,
  billingEmailModeFor,
  szamlazzDocumentTotals,
  type BillingDeliveryOutcome,
  type BillingDocumentDetail,
  type BillingDocumentStatus,
  type BillingDocumentType,
  type BillingEmailRecipients,
  type BillingEmailStatus,
  type BillingLineStockOutcome,
  type BillingVatRateTotal,
  type InvoiceFormat,
} from "@acropora/types";

import {
  szamlazzAmountsOfLine,
  type BuyerSnapshot,
} from "./billing-document-issue.js";
import { budapestDay } from "./billing-document-list.js";
import type { BillingDocumentRow } from "./billing-documents.repository.js";

/**
 * A RÉSZLETEK BŐVÍTÉSE (nautilus; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 * Murena `toBillingDocumentDetail`-je az alap; ez a kiállítás és a kiküldés
 * mezőit teszi rá, és a végösszeget arra cseréli, amit a számla kiír.
 */
export function withIssueAndDelivery(
  row: BillingDocumentRow,
  base: BillingDocumentDetail,
): BillingDocumentDetail {
  const status = row.status as BillingDocumentStatus;
  const snapshot = status === "ISSUED" ? readSnapshot(row.buyerSnapshot) : null;
  const pdfAvailable = status === "ISSUED" && row.pdfStorageKey !== null;
  const mode = billingEmailModeFor(
    status,
    row.emailStatus as BillingEmailStatus | null,
  );
  const delivers =
    billingEmailDelivery(
      row.documentType as BillingDocumentType,
      row.invoiceFormat as InvoiceFormat | null,
    ) !== "NONE";
  const last = row.mailDeliveries[0] ?? null;

  return {
    ...base,
    customerSource: snapshot ? "ISSUED_SNAPSHOT" : "DRAFT_PARTNER",
    customer: snapshot
      ? {
          id: row.customer?.id ?? "",
          name: snapshot.name,
          address: `${snapshot.zip} ${snapshot.city}, ${snapshot.address}`,
          taxNumber: snapshot.taxNumber,
          euTaxNumber: snapshot.euTaxNumber,
          contactName: null,
          email: snapshot.email,
          internalCode: row.customer?.customerNumber ?? "",
        }
      : base.customer,
    issueDate: budapestDay(row.issueDate),
    lines: base.lines.map((line) => ({
      ...line,
      stockOutcome:
        (row.lines.find((stored) => stored.id === line.id)?.stockOutcome as
          BillingLineStockOutcome | null | undefined) ?? null,
    })),
    totals: printedTotals(row, base.totals),
    szamlazz: {
      documentNumber: row.invoiceNumber,
      issueState: status,
      externalId: row.id,
      issueAttemptCount: row.issueAttemptCount,
      // Az ok csak ott érdekes, ahol a kiállítás nem sikerült, vagy a kimenete
      // ismeretlen; egy kiállított soron egy régi hiba félrevezetne.
      lastError:
        status === "ISSUE_FAILED" || status === "ISSUING"
          ? row.syncError
          : null,
      documentUrl: status === "ISSUED" ? row.externalUrl : null,
    },
    pdf: { available: pdfAvailable },
    delivery: {
      status: row.emailStatus as BillingEmailStatus | null,
      lastAttempt: last
        ? {
            recipients: readRecipients(last.recipients),
            outcome: readOutcome(last.outcome),
            at: last.createdAt.toISOString(),
            error: last.error,
          }
        : null,
      // A kiküldés a tárolt PDF-et csatolja, tehát PDF nélkül nincs mit küldeni.
      canResend: mode !== null && delivers && pdfAvailable,
    },
  };
}

/**
 * A VÉGÖSSZEG, AHOGY A SZÁMLÁN ÁLL. Kiállított bizonylatnál a Számlázz.hu
 * válaszából tárolt fejléc-összeg, és a kiküldött (tárolt) sorösszegekből a
 * kulcsonkénti bontás; minden más állapotban a tételekből, a #1275 szabályával.
 * Ha egy vázlat-tétel még nem számolható, a vázlat saját összegei maradnak.
 */
function printedTotals(
  row: BillingDocumentRow,
  fallback: BillingDocumentDetail["totals"],
): BillingDocumentDetail["totals"] {
  const issued = row.status === "ISSUED";
  const lines: {
    id: string;
    rate: string;
    netAmount: string;
    vatAmount: string;
    grossAmount: string;
  }[] = [];
  for (const line of row.lines) {
    const rate = line.vatRatePercent.toFixed(2);
    if (issued) {
      lines.push({
        id: line.id,
        rate,
        netAmount: line.netAmount.toString(),
        vatAmount: line.vatAmount.toString(),
        grossAmount: line.grossAmount.toString(),
      });
      continue;
    }
    const amounts = szamlazzAmountsOfLine(line, row.currency);
    if (!amounts.ok) return { ...fallback, zeroForintLineIds: [] };
    lines.push({ id: line.id, rate, ...amounts });
  }

  const all = szamlazzDocumentTotals(lines, row.currency);
  const byVatRate: BillingVatRateTotal[] = [
    ...new Set(lines.map((line) => line.rate)),
  ].map((rate) => {
    const group = szamlazzDocumentTotals(
      lines.filter((line) => line.rate === rate),
      row.currency,
    );
    return {
      vatRatePercent: rate,
      netAmount: group.netAmount,
      vatAmount: group.vatAmount,
      grossAmount: group.grossAmount,
    };
  });
  const decimals = row.currency.toUpperCase() === "HUF" ? 0 : 2;
  const header =
    issued && row.grossAmount && row.netAmount && row.vatAmount
      ? {
          netAmount: row.netAmount.toFixed(decimals),
          vatAmount: row.vatAmount.toFixed(decimals),
          grossAmount: row.grossAmount.toFixed(decimals),
        }
      : {
          netAmount: all.netAmount,
          vatAmount: all.vatAmount,
          grossAmount: all.grossAmount,
        };
  return {
    ...header,
    byVatRate,
    zeroForintLineIds: all.zeroForintLines.map((index) => lines[index]!.id),
  };
}

function readSnapshot(value: unknown): BuyerSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as Partial<BuyerSnapshot>;
  return typeof snapshot.name === "string" ? (snapshot as BuyerSnapshot) : null;
}

/** A tárolt címzettek; egy cím szövegként vagy `{ email }` alakban állhat. */
function readRecipients(value: unknown): BillingEmailRecipients {
  const list = (key: string) => {
    const raw = (value as Record<string, unknown> | null)?.[key];
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      if (typeof entry === "string") return [entry];
      const email = (entry as { email?: unknown } | null)?.email;
      return typeof email === "string" ? [email] : [];
    });
  };
  return { to: list("to"), cc: list("cc"), bcc: list("bcc") };
}

function readOutcome(value: string): BillingDeliveryOutcome {
  return (BILLING_DELIVERY_OUTCOMES as readonly string[]).includes(value)
    ? (value as BillingDeliveryOutcome)
    : "INDETERMINATE";
}
