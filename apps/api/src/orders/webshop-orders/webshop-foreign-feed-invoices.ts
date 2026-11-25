import { Prisma, prisma } from "@acropora/database";

import { mentionsNumber } from "./webshop-external-invoice-link.js";

/**
 * THE AUTOKASSZA CHECK'S INPUT (card d31a66a3, S1), ONE QUERY FOR BOTH ISSUE PATHS: the order page (`WebshopOrderInvoiceService`) and
 * the shared billing issue (`BillingDocumentIssueService`, a draft issued from the billing editor; barracuda on #2884): the invoices in the Számlázz.hu feed that belong to this order and
 * were NOT issued by the OS. An invoice (SZ), advance (ES) or final invoice (VS), not cancelled, dated on or after the
 * proforma, that carries the order's reference as its order number or names the proforma's number in its raw message.
 * Unlike `externalInvoices` (which links one invoice for display and links none when two fit), every candidate is
 * returned: for a stop, two candidates are two reasons, not an ambiguity. The order's own documents (their numbers
 * among the OS rows of this order) are left out: an OS invoice comes back through the feed as its twin.
 */
export async function foreignFeedInvoicesOf(
  database: Pick<
    typeof prisma,
    "szamlazzFeedMessage" | "externalBillingDocument" | "invoice"
  >,
  orderId: string,
  proforma: { number: string; reference: string | null; issuedOn: Date },
): Promise<string[]> {
  const since = new Date(
    `${proforma.issuedOn.toISOString().slice(0, 10)}T00:00:00Z`,
  );
  const reference = proforma.reference?.trim() || null;
  const messages = await database.szamlazzFeedMessage.findMany({
    where: {
      kind: "SZAMLAKI",
      receivedAt: { gte: since },
      body: { contains: proforma.number },
    },
    select: { externalId: true, body: true },
  });
  const mentioned = messages
    .filter((message) => mentionsNumber(message.body, proforma.number))
    .map((message) => message.externalId);
  const or: Prisma.ExternalBillingDocumentWhereInput[] = [];
  if (reference) or.push({ orderNumber: reference });
  if (mentioned.length) or.push({ externalId: { in: mentioned } });
  if (!or.length) return [];
  const documents = await database.externalBillingDocument.findMany({
    where: {
      issueDate: { gte: since },
      cancelled: false,
      kindCode: { in: ["SZ", "ES", "VS"] },
      documentNumber: { not: proforma.number },
      OR: or,
    },
    select: { documentNumber: true },
    orderBy: [{ issueDate: "asc" }, { documentNumber: "asc" }],
  });
  if (!documents.length) return [];
  const own = await database.invoice.findMany({
    where: {
      sourceType: "WEBSHOP_ORDER",
      sourceId: orderId,
      invoiceNumber: { in: documents.map((doc) => doc.documentNumber) },
    },
    select: { invoiceNumber: true },
  });
  const ownNumbers = new Set(own.map((row) => row.invoiceNumber));
  return documents
    .map((doc) => doc.documentNumber)
    .filter((number) => !ownNumbers.has(number));
}
