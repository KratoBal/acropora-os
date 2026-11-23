import { prisma } from "@acropora/database";
import type {
  DueInvoicesResponse,
  ProbablyNotTransferEvidence,
} from "@acropora/types";

import type { MissingInvoicesService } from "../missing-invoices/missing-invoices.service.js";
import { budapestDay } from "./billing-document-list.js";
import { buildDueInvoices } from "./due-invoices.js";
import {
  ACCOUNT_BANK_TAX_BASES_ENV,
  bankDeductionEvidence,
  parseAccountBankTaxBases,
} from "./due-invoices-bank-deduction.js";
import { cardPaidSupplierEvidence } from "./due-invoices-card-history.js";
import { withoutPdfTransfer } from "./due-invoices-pdf-transfer.js";
import { pdfTextLines } from "../purchasing/supplier-invoice-import/pdf-text-lines.js";
import type { IncomingReviewService } from "./foreign-invoice/incoming-review.service.js";
import { loadCollectedPdfIndex } from "./incoming-collected-pdf.js";
import { loadSupplierAccountResolution } from "./supplier-bank-account-resolve.loader.js";
import { loadSetOffPayments } from "./incoming-set-off.loader.js";
import { attachedPdfIds } from "./incoming-pdf-attach.js";
import { incomingHasPdf } from "./incoming-pdf-state.js";
import { pdfIdsToRead } from "./supplier-bank-account-extract.js";
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
    missing: Pick<MissingInvoicesService, "dueInvoicesBankData">;
    reviews: Pick<IncomingReviewService, "pendingReadings">;
  },
  now: Date = new Date(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DueInvoicesResponse> {
  const database = prisma;
  const [rows, bankData, collected, readings, purchases, attached] =
    await Promise.all([
      database.incomingBillingDocument.findMany(),
      deps.missing.dueInvoicesBankData(),
      loadCollectedPdfIndex(database),
      deps.reviews.pendingReadings(),
      loadPurchaseSubjects(database),
      attachedPdfIds(database),
    ]);
  const { pairings, bankFeeDebits } = bankData;
  const [manualPaid, setOff, resolved] = await Promise.all([
    loadManualPurchasePayments(database, rows),
    loadSetOffPayments(database, rows),
    loadSupplierAccountResolution(database, rows),
  ]);
  // a szállító kártyás múltja csak akkor tesz egy sort a „valószínűleg nem utalandó” szakaszba, ha a számla SAJÁT PDF-je nem mond átutalást
  const notTransferEvidence =
    await withoutPdfTransfer<ProbablyNotTransferEvidence>({
      // a kártyás ok elöl: ha egy sor mindkettőre jelölt, a kártyás múlt az erősebb (több számlán áll)
      evidence: new Map<string, ProbablyNotTransferEvidence>([
        ...[
          ...bankDeductionEvidence({
            rows,
            bankFeeDebits,
            bankTaxBases: parseAccountBankTaxBases(
              environment[ACCOUNT_BANK_TAX_BASES_ENV],
            ),
          }),
        ].map(
          ([id, found]) =>
            [id, { kind: "BANK_DEDUCTION" as const, ...found }] as const,
        ),
        ...cardPaidSupplierEvidence({ rows, pairings }),
      ]),
      rows,
      // a feed XML-dokumentuma nem PDF: `pdfIdsToRead` nélkül minden sor egy „nem olvasható” PDF-et kapna (a #2803 hibája, nautilus 58846)
      pdfIdsOf: (row) => pdfIdsToRead(row, { attached, collected }),
      content: async (id) =>
        (
          await database.incomingSupplierDocument.findUnique({
            where: { id },
            select: { content: true },
          })
        )?.content ?? null,
      lines: (content) => pdfTextLines(content),
    });
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
    notTransferEvidence,
    today: budapestDay(now)!,
  });
}
