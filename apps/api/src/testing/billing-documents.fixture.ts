import { Prisma, type IncomingBillingDocument } from "@acropora/database";

import type { CandidateDocument } from "../missing-invoices/missing-invoice-matching.js";
import type { DocumentPairing } from "../missing-invoices/missing-invoices.service.js";

/**
 * TYPED FACTORIES FOR THE BILLING DOCUMENT SHAPES, ONE PLACE EACH (card 03bd0516, T6.4).
 *
 * WHY SHARED: `CandidateDocument`, `DocumentPairing` and `IncomingBillingDocument` were built
 * by hand in fifteen specs, each with its own complete literal. A new REQUIRED field on the
 * type (#2006: `DocumentPairing.paperOriginal`) then broke four other specs' fixtures, and the
 * narrow compiler did not cover them, so the CI said so first. Here the return type is the
 * real contract and there is no cast, so a new required field stops at THIS file, at compile
 * time, in one place.
 *
 * WHAT A SPEC KEEPS: its own default VALUES. A spec wraps the factory
 * (`candidateDocument({ number: "SZ-1", hasOriginal: false, ...over })`), so the tests say
 * what they mean, and only the shape lives here. Nothing here is "the" realistic invoice:
 * the values are the neutral minimum that makes the type complete.
 */

/** A source document (NAV, mailbox, upload, feed ...). `id` is required: tests find documents by it. */
export function candidateDocument(
  over: Partial<CandidateDocument> & { id: string },
): CandidateDocument {
  return {
    source: "NAV",
    number: `SZ-${over.id}`,
    date: "2026-08-01",
    gross: new Prisma.Decimal(12700),
    currency: "HUF",
    supplierName: "Szállító Kft.",
    supplierAccounts: [],
    kind: "INVOICE",
    payee: "COMPANY",
    hasOriginal: false,
    ...over,
  };
}

/**
 * One document's pairing. `document` is merged over the default candidate (its `id` defaults to
 * `doc-1`), the rest overrides the pairing itself.
 */
export function documentPairing(
  over: Omit<Partial<DocumentPairing>, "document"> & {
    document?: Partial<CandidateDocument>;
  } = {},
): DocumentPairing {
  const { document, ...rest } = over;
  return {
    payee: "COMPANY",
    kind: "INVOICE",
    debits: [{ bookingDate: "2026-09-30", amount: "12700", currency: "HUF" }],
    paidInFull: true,
    paperOriginal: false,
    document: candidateDocument({ id: "doc-1", ...document }),
    ...rest,
  };
}

/** A stored incoming (feed) invoice row, complete. */
export function incomingBillingDocument(
  over: Partial<IncomingBillingDocument> = {},
): IncomingBillingDocument {
  const at = new Date("2026-10-01T08:00:00Z");
  const day = (value: string) => new Date(`${value}T00:00:00Z`);
  return {
    id: "in-1",
    source: "SZAMLAZZ",
    externalId: "5150",
    feedMessageId: "msg-1",
    feedReceivedAt: at,
    versionCount: 1,
    kindCode: "SZ",
    documentNumber: "SZ-2026/1",
    electronic: true,
    issueDate: day("2026-09-28"),
    fulfillmentDate: day("2026-09-25"),
    dueDate: day("2026-10-12"),
    paymentMethod: "Átutalás",
    currency: "HUF",
    exchangeRate: null,
    exchangeBank: null,
    supplierName: "Szállító Kft.",
    supplierTaxNumber: "12345678-2-41",
    supplierEuTaxNumber: null,
    supplierAddress: "1010 Budapest, Minta utca 1.",
    supplierBankAccount: null,
    buyerName: "Acropora Kft.",
    buyerTaxNumber: "23916229-2-42",
    netAmount: new Prisma.Decimal(10000),
    vatAmount: new Prisma.Decimal(2700),
    grossAmount: new Prisma.Decimal(12700),
    lines: [],
    vatSummary: [],
    paymentsKnown: true,
    payments: [],
    paidAmount: new Prisma.Decimal(0),
    lastPaymentDate: null,
    note: null,
    orderNumber: null,
    referencedInvoiceNumber: null,
    referencedProformaNumber: null,
    cancelled: false,
    sourceDocumentId: "doc-1",
    hasPdf: false,
    notBookable: false,
    notBookableAt: null,
    paperOriginalAt: null,
    createdAt: at,
    updatedAt: at,
    ...over,
  };
}
