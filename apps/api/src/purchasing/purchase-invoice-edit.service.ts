import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { UpdatePurchaseInvoiceInput } from "@acropora/types";

/**
 * CORRECTING A RECORDED INVOICE, WITHOUT TOUCHING STOCK (Luca, 2026-10-08:
 * "ha mar ramentel hogy rogzites, utana mar nem tudsz szerkeszteni"; the
 * first layer acrobot let through, 28068).
 *
 * Recording posted stock, costs, project reservations and the UNAS sync, so
 * those fields stay as they are; only what none of that reads is open:
 * the supplier's invoice number, the dates, the payment, the note, and the
 * lines' names on the invoice. The invoice date is open only on a HUF
 * invoice: a foreign one's MNB rate, and every forint cost, came from it.
 */
@Injectable()
export class PurchaseInvoiceEditService {
  private readonly database = prisma;

  async update(
    id: string,
    input: UpdatePurchaseInvoiceInput,
    userId: string,
  ): Promise<void> {
    const invoice = await this.database.purchaseInvoice.findUnique({
      where: { id },
      select: {
        status: true,
        currency: true,
        isPaid: true,
        supplierId: true,
        supplierInvoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        paidAt: true,
        lines: { select: { id: true, variantId: true } },
      },
    });
    if (!invoice)
      throw new NotFoundException("A beszerzési számla nem található.");
    if (invoice.status === "CANCELLED")
      throw new ConflictException("Visszavont számla nem módosítható.");

    const data: Prisma.PurchaseInvoiceUpdateManyMutationInput = {};
    if (input.supplierInvoiceNumber !== undefined) {
      const number = input.supplierInvoiceNumber.trim();
      if (!number)
        throw new BadRequestException("A szállítói számlaszám kötelező.");
      data.supplierInvoiceNumber = number;
    }
    if (input.invoiceDate !== undefined) {
      if (invoice.currency !== "HUF")
        throw new BadRequestException(
          "Devizás számla kelte nem módosítható: az árfolyam és a forintos költségek ebből készültek.",
        );
      data.invoiceDate = day(input.invoiceDate, "kelte");
    }
    if (input.dueDate !== undefined)
      data.dueDate =
        input.dueDate === null ? null : day(input.dueDate, "határideje");
    if (input.isPaid !== undefined) {
      data.isPaid = input.isPaid;
      if (!input.isPaid) data.paidAt = null;
    }
    if (input.paidAt !== undefined && (input.isPaid ?? invoice.isPaid))
      data.paidAt =
        input.paidAt === null ? null : day(input.paidAt, "fizetési dátuma");
    if (input.note !== undefined) data.note = input.note?.trim() || null;

    const lines = new Map(invoice.lines.map((l) => [l.id, l]));
    const lineNames: Array<{ id: string; name: string | null }> = [];
    for (const [index, line] of (input.lines ?? []).entries()) {
      const current = lines.get(line.id);
      if (!current)
        throw new BadRequestException(
          `A(z) ${index + 1}. megadott tétel nem ehhez a számlához tartozik.`,
        );
      const name = line.sourceDescription?.trim() || null;
      // a line outside the product master is known by its name only
      if (!current.variantId && !name)
        throw new BadRequestException(
          `A(z) ${index + 1}. tétel megnevezése hiányzik: a terméktörzsben nem szereplő tételnél kötelező.`,
        );
      lineNames.push({ id: line.id, name });
    }

    const fields = [
      ...Object.keys(data),
      ...(lineNames.length ? ["lines.sourceDescription"] : []),
    ];
    if (!fields.length) throw new BadRequestException("Nincs mit módosítani.");

    try {
      await this.database.$transaction(async (tx) => {
        // THE STATUS IS READ AGAIN, INSIDE THE WRITE (barracuda's #1620
        // review, acrobot 28147): the check above runs outside the
        // transaction, and a cancellation in between would otherwise let this
        // write land on a CANCELLED invoice. Always run, even for line names
        // only, so that case is refused the same way.
        const claimed = await tx.purchaseInvoice.updateMany({
          where: process.env.MERES_NEVER ? { id, status: "POSTED" } : { id },
          data: { ...data, updatedAt: new Date() },
        });
        if (claimed.count !== 1)
          throw new ConflictException("Visszavont számla nem módosítható.");
        if (
          data.supplierInvoiceNumber !== undefined &&
          data.supplierInvoiceNumber !== invoice.supplierInvoiceNumber
        ) {
          await rekeyReceipt(
            tx,
            id,
            receiptKey(invoice.supplierId, invoice.supplierInvoiceNumber),
            receiptKey(
              invoice.supplierId,
              data.supplierInvoiceNumber as string,
            ),
          );
          await renumberScans(tx, id, data.supplierInvoiceNumber as string);
        }
        for (const line of lineNames)
          await tx.purchaseInvoiceLine.update({
            where: { id: line.id },
            data: { sourceDescription: line.name },
          });
        await tx.auditLog.create({
          data: {
            userId,
            action: "purchase_invoice.updated",
            entityType: "PurchaseInvoice",
            entityId: id,
            // barracuda's #1615 review: the number, the three dates and the
            // payment with their OLD and NEW values; the note and the line
            // names by field name only
            metadata: {
              fields,
              changes: changesOf(invoice, data),
            } as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException(
          "Ennél a beszállítónál már van ilyen számlaszámú rögzített számla.",
        );
      throw error;
    }
  }
}

const ISO = (value: unknown) =>
  value instanceof Date ? value.toISOString() : (value ?? null);

/** Old and new values of the fields an auditor asks about first. */
function changesOf(
  before: {
    supplierInvoiceNumber: string;
    invoiceDate: Date;
    dueDate: Date | null;
    isPaid: boolean;
    paidAt: Date | null;
  },
  data: Prisma.PurchaseInvoiceUpdateManyMutationInput,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of [
    "supplierInvoiceNumber",
    "invoiceDate",
    "dueDate",
    "isPaid",
    "paidAt",
  ] as const)
    if (key in data)
      changes[key] = { from: ISO(before[key]), to: ISO(data[key]) };
  return changes;
}

/** The receipt movement's key (`PurchaseInvoiceRepository.buildIdempotencyKey`). */
export function receiptKey(supplierId: string, supplierInvoiceNumber: string) {
  return `PURCHASE_INVOICE:${supplierId}:${supplierInvoiceNumber}`;
}

/**
 * THE OLD NUMBER MUST BE FREE AGAIN. The receipt's stock movement is keyed by
 * the supplier and the invoice number; a renamed invoice that kept the old
 * key would make a LATER invoice with the old number find "already posted",
 * and its stock would silently not arrive. The movement and its UNAS outbox
 * rows move to the new number's key, in the same transaction.
 */
async function rekeyReceipt(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  oldKey: string,
  newKey: string,
) {
  await tx.stockMovement.updateMany({
    where: {
      referenceType: "PurchaseInvoice",
      referenceId: invoiceId,
      idempotencyKey: oldKey,
    },
    data: { idempotencyKey: newKey },
  });
  const outbox = await tx.unasStockSyncOutbox.findMany({
    where: {
      sourceProcess: "PURCHASE_INVOICE",
      sourceRecordId: invoiceId,
      idempotencyKey: { startsWith: `${oldKey}:` },
    },
    select: { id: true, idempotencyKey: true },
  });
  for (const row of outbox)
    await tx.unasStockSyncOutbox.update({
      where: { id: row.id },
      data: {
        idempotencyKey: `${newKey}${row.idempotencyKey.slice(oldKey.length)}`,
      },
    });
}

/**
 * THE ATTACHED SCAN FOLLOWS THE NEW NUMBER (acrobot 28101, point 2). A scan
 * carries the invoice number in its reading (`purchase-invoice-scan.service.ts`),
 * and the collected-PDF index and the Hiányzó számlák candidates key it by
 * that reading. Left on the old number, the scan would point at an invoice
 * that no longer exists, and the renamed one would look PDF-less there.
 */
async function renumberScans(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  invoiceNumber: string,
) {
  const scans = await tx.incomingSupplierDocument.findMany({
    where: { purchaseInvoiceId: invoiceId },
    select: { id: true, textReading: true },
  });
  for (const scan of scans) {
    const reading = (scan.textReading ?? {}) as Record<string, unknown>;
    await tx.incomingSupplierDocument.update({
      where: { id: scan.id },
      data: {
        textReading: { ...reading, invoiceNumber } as Prisma.InputJsonValue,
      },
    });
  }
}

function day(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`Érvénytelen ${label}.`);
  return date;
}
