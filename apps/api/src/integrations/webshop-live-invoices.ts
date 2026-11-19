import { prisma } from "@acropora/database";

/**
 * A WEBSHOP ORDER'S LIVE OUTGOING INVOICES, one reading for the settlements that tie a payment to a webshop order (first written
 * for the Foxpost settlement's `resolveWebshop`, #1996, and the Stripe settlement's `liveInvoicesByOrder`): an issued outgoing
 * INVOICE of the order that no issued, or still being issued, storno points at. A storno in flight takes the invoice out, so the
 * line goes to a person, not to a guess. orderId -> the invoice numbers, oldest first; an order with none is missing.
 */
export async function liveInvoiceNumbersByWebshopOrder(
  orderIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (orderIds.length === 0) return out;
  const invoices = await prisma.invoice.findMany({
    where: {
      sourceType: "WEBSHOP_ORDER",
      sourceId: { in: [...new Set(orderIds)] },
      direction: "OUTBOUND",
      documentType: "INVOICE",
      status: "ISSUED",
      invoiceNumber: { not: null },
      correctionInvoices: {
        none: {
          documentType: "STORNO",
          status: { in: ["ISSUED", "ISSUING"] },
        },
      },
    },
    select: { sourceId: true, invoiceNumber: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const invoice of invoices) {
    if (!invoice.sourceId || !invoice.invoiceNumber) continue;
    out.set(invoice.sourceId, [
      ...(out.get(invoice.sourceId) ?? []),
      invoice.invoiceNumber,
    ]);
  }
  return out;
}
