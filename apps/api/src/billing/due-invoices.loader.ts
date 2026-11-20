import { prisma } from "@acropora/database";
import type { DueInvoicesResponse } from "@acropora/types";

import type { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { budapestDay } from "./billing-document-list.js";
import { buildDueInvoices } from "./due-invoices.js";
import type { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import { loadCollectedPdfIndex } from "./incoming-collected-pdf.js";
import { loadSupplierAccountResolution } from "./supplier-bank-account-resolve.loader.js";
import { loadSetOffPayments } from "./incoming-set-off.loader.js";
import { attachedPdfIds } from "./incoming-pdf-attach.js";
import { incomingHasPdf } from "./incoming-pdf-state.js";
import {
  incomingListItems,
  loadManualPurchasePayments,
  loadPurchaseSubjects,
} from "./purchase-incoming.js";

/**
 * A LEJÁRÓ SZÁMLÁK LISTÁJA AZ ADATBÁZISBÓL ÉS A PÁROSÍTÁSBÓL (Balázs, 2026-11-20; acrobot 58227). EGY HELYEN, mert két hívó van: a lista
 * végpontja (`DueInvoicesController`) és a heti levél (`DueInvoicesMailService`), és a levél PDF-je nem térhet el attól, amit a lap
 * mutat. A sorokat és a kifizetettséget ugyanaz az építő adja, mint a Bejövő számlák listáját (`incomingListItems`).
 */
export async function loadDueInvoices(
  deps: {
    missing: Pick<MissingInvoicesService, "documentPairings">;
    reviews: Pick<IncomingReviewService, "pendingReadings">;
  },
  now: Date = new Date(),
): Promise<DueInvoicesResponse> {
  const database = prisma;
  const [rows, pairings, collected, readings, purchases, attached] =
    await Promise.all([
      database.incomingBillingDocument.findMany(),
      deps.missing.documentPairings(),
      loadCollectedPdfIndex(database),
      deps.reviews.pendingReadings(),
      loadPurchaseSubjects(database),
      attachedPdfIds(database),
    ]);
  const [manualPaid, setOff, resolved] = await Promise.all([
    loadManualPurchasePayments(database, rows),
    loadSetOffPayments(database, rows),
    loadSupplierAccountResolution(database, rows),
  ]);
  return buildDueInvoices({
    items: incomingListItems({
      rows,
      pairings,
      hasCollectedPdf: (row) => incomingHasPdf(row, { attached, collected }),
      readings,
      purchases,
      manualPaid,
      setOff,
    }),
    // a sor saját számlaszáma, ennek hiányában a pótlás (a szállító másik számlája, a törzs, a kitöltés), a forrás jelölésével
    bankAccounts: new Map(
      rows.map((row) => [
        row.id,
        (row.supplierBankAccount ?? "").trim() !== ""
          ? row.supplierBankAccount
          : (resolved.get(row.id)?.account ?? null),
      ]),
    ),
    bankAccountSources: new Map(
      [...resolved].map(([id, account]) => [id, account.source]),
    ),
    today: budapestDay(now)!,
  });
}
