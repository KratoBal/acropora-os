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
        lines: { select: { id: true, variantId: true } },
      },
    });
    if (!invoice)
      throw new NotFoundException("A beszerzési számla nem található.");
    if (invoice.status === "CANCELLED")
      throw new ConflictException("Visszavont számla nem módosítható.");

    const data: Prisma.PurchaseInvoiceUpdateInput = {};
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
        if (Object.keys(data).length)
          await tx.purchaseInvoice.update({ where: { id }, data });
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
            metadata: { fields },
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

function day(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new BadRequestException(`Érvénytelen ${label}.`);
  return date;
}
