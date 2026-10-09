import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  lockVariantWarehouse,
  postInventoryMovement,
  type InventoryMovementDatabase,
} from "../common/inventory-movement-writer.js";
import { withdrawPurchaseRow } from "../billing/purchase-incoming.js";
import { receiptKey, rekeyReceipt } from "./purchase-invoice-edit.service.js";
import { releaseReservations } from "./project-reservation.service.js";

/**
 * UNDOING A RECORDED PURCHASE INVOICE (the second layer; Balázs „A 1”,
 * acrobot 28092). Recording posted stock, project reservations, the UNAS
 * sync and the NAV and expected-arrival links in one transaction; the
 * cancellation takes all of it back in one transaction, and the invoice row
 * stays as CANCELLED with who, when and why.
 *
 * It is refused, with a sentence a person can act on, when undoing would
 * not be clean:
 *   - the invoice is paid (the payment has to be undone first);
 *   - a project reservation from it was already consumed;
 *   - the stock of a received product is already below what arrived (part
 *     of it was sold or moved; the cancellation would go negative).
 *
 * The stock goes out as an opposite movement (ADJUSTMENT), never by deleting
 * the receipt: the ledger keeps both. The receipt is marked REVERSED, and its
 * key, `PURCHASE_INVOICE:<supplier>:<number>`, is freed so the same number can
 * be recorded again (the number's uniqueness skips cancelled invoices).
 */
@Injectable()
export class PurchaseInvoiceCancelService {
  private readonly database = prisma;

  async cancel(id: string, reason: string, userId: string): Promise<void> {
    const why = reason.trim();
    if (why.length < 3)
      throw new BadRequestException("Add meg a sztornó okát.");

    await this.database.$transaction(async (tx) => {
      // the status change first: a second, concurrent cancel stops here
      const claimed = await tx.purchaseInvoice.updateMany({
        where: { id, status: "POSTED" },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledById: userId,
          cancelReason: why,
        },
      });
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        select: {
          documentNumber: true,
          supplierId: true,
          supplierInvoiceNumber: true,
          warehouseId: true,
          isPaid: true,
          lines: { select: { id: true } },
        },
      });
      if (!invoice)
        throw new NotFoundException("A beszerzési számla nem található.");
      if (claimed.count !== 1)
        throw new ConflictException("Ez a számla már nem sztornózható.");
      if (invoice.isPaid)
        throw new ConflictException(
          "Kifizetett számla nem sztornózható: előbb a fizetést kell visszavonni az Adatok javítása alatt.",
        );

      const receipt = await tx.stockMovement.findFirst({
        where: {
          referenceType: "PurchaseInvoice",
          referenceId: id,
          type: "PURCHASE_RECEIPT",
          status: "POSTED",
        },
        select: {
          id: true,
          idempotencyKey: true,
          lines: { select: { variantId: true, quantity: true, unit: true } },
        },
      });

      // what arrived, per product, from the posted movement itself
      const received = new Map<
        string,
        { quantity: Prisma.Decimal; unit: string }
      >();
      for (const line of receipt?.lines ?? []) {
        const seen = received.get(line.variantId);
        received.set(line.variantId, {
          quantity: (seen?.quantity ?? new Prisma.Decimal(0)).plus(
            line.quantity,
          ),
          unit: line.unit,
        });
      }
      const variantIds = [...received.keys()].sort();
      const variants = new Map(
        (
          await tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              sku: true,
              product: { select: { name: true, catalogAuthority: true } },
            },
          })
        ).map((variant) => [variant.id, variant]),
      );

      // the same lock the posting takes, in the same order, before reading:
      // the holds and the stock rows are read under it (barracuda's #1630
      // review), so a release by hand or a project close cannot slip
      // between the read and the write
      for (const variantId of variantIds)
        await lockVariantWarehouse(tx, variantId, invoice.warehouseId);
      const reservations = await tx.projectInventoryReservation.findMany({
        where: {
          purchaseInvoiceLineId: { in: invoice.lines.map((line) => line.id) },
          status: { in: ["ACTIVE", "CONSUMED"] },
        },
        select: {
          id: true,
          status: true,
          projectId: true,
          stockItemId: true,
          variantId: true,
          quantity: true,
          purchaseInvoiceLineId: true,
        },
      });
      if (reservations.some((r) => r.status === "CONSUMED"))
        throw new ConflictException(
          "A számla egy projektfoglalását már felhasználták, ezért nem sztornózható.",
        );

      for (const variantId of variantIds) {
        const stock = await tx.stockItem.findFirst({
          where: {
            variantId,
            warehouseId: invoice.warehouseId,
            locationId: null,
            lotId: null,
          },
          select: { onHand: true, reserved: true },
        });
        const arrived = received.get(variantId)!.quantity;
        const name = variants.get(variantId)?.product.name ?? variantId;
        const onHand = stock?.onHand ?? new Prisma.Decimal(0);
        // WHAT OTHERS HOLD STAYS HELD (barracuda's #1620 review, acrobot
        // 28147): only this invoice's own active reservations are released
        // below, so the stock that can go out is what nobody else reserved
        const own = reservations
          .filter((r) => r.status === "ACTIVE" && r.variantId === variantId)
          .reduce((sum, r) => sum.plus(r.quantity), new Prisma.Decimal(0));
        const others = (stock?.reserved ?? new Prisma.Decimal(0)).minus(own);
        const free = onHand.minus(others);
        if (onHand.lessThan(arrived))
          throw new ConflictException(
            `A(z) ${name} készlete már kevesebb, mint amennyi ezzel a számlával érkezett (${arrived.toString()}), ezért a számla nem sztornózható.`,
          );
        if (free.lessThan(arrived))
          throw new ConflictException(
            `A(z) ${name} készletéből ${others.toString()} darabot más foglalás köt le, így csak ${free.toString()} vehető ki a beérkezett ${arrived.toString()} helyett, ezért a számla nem sztornózható.`,
          );
      }

      // reservations first, so the UNAS target below counts them as free;
      // through the one release, whose conditional update releases a hold
      // once: if another release took one meanwhile, this is a 409
      const active = reservations.filter((r) => r.status === "ACTIVE");
      const released = active.length
        ? await releaseReservations(
            tx,
            { reservationIds: active.map((r) => r.id) },
            userId,
            "PURCHASE_INVOICE_CANCELLED",
          )
        : [];
      if (released.length !== active.length)
        throw new ConflictException(
          "A számla egy projektfoglalása közben megváltozott. Töltsd újra, és próbáld újra.",
        );
      const now = new Date();

      if (receipt) {
        // free the number's key first: the receipt and its outbox rows move
        // to a key no recording can ever ask for again
        await rekeyReceipt(
          tx,
          id,
          // the key the receipt was POSTED under, not one computed from the
          // invoice's number today: an older rename may have left them apart,
          // and a computed key would then move nothing (barracuda, 28147)
          receipt.idempotencyKey ??
            receiptKey(invoice.supplierId, invoice.supplierInvoiceNumber),
          `PURCHASE_INVOICE_CANCELLED:${id}`,
        );
        await tx.stockMovement.update({
          where: { id: receipt.id },
          data: { status: "REVERSED" },
        });
        await postInventoryMovement(
          tx as unknown as InventoryMovementDatabase,
          {
            idempotencyKey: `PURCHASE_INVOICE_CANCEL:${id}`,
            movementNumber: `BESZSTORNO-${invoice.documentNumber}`,
            type: "ADJUSTMENT",
            warehouseId: invoice.warehouseId,
            referenceType: "PurchaseInvoice",
            referenceId: id,
            performedById: userId,
            occurredAt: now,
            note: `Sztornó: ${why}`,
            sourceProcess: "PURCHASE_INVOICE",
            lines: variantIds.map((variantId) => ({
              variantId,
              sku: variants.get(variantId)?.sku ?? variantId,
              quantityDelta: received.get(variantId)!.quantity.negated(),
              unit: received.get(variantId)!.unit,
              syncToUnas:
                variants.get(variantId)?.product.catalogAuthority === "UNAS",
            })),
          },
        );
      }

      // the NAV row and the expected arrival can be recorded again
      const navRows = await tx.navIncomingInvoice.findMany({
        where: { purchaseInvoiceId: id },
        select: { id: true, parsedData: true },
      });
      for (const row of navRows)
        await tx.navIncomingInvoice.update({
          where: { id: row.id },
          data: {
            purchaseInvoiceId: null,
            status: row.parsedData === null ? "NEW" : "DATA_FETCHED",
          },
        });
      const arrivals = await tx.expectedArrival.updateMany({
        where: { purchaseInvoiceId: id },
        data: { purchaseInvoiceId: null, status: "OPEN" },
      });
      // an approved incoming row goes too: the re-recorded invoice is approved
      // again (2408d6ad, acrobot 28406)
      const incomingWithdrawn = await withdrawPurchaseRow(tx, id, userId);

      await tx.auditLog.create({
        data: {
          userId,
          action: "purchase_invoice.cancelled",
          entityType: "PurchaseInvoice",
          entityId: id,
          metadata: {
            reason: why,
            receiptMovementId: receipt?.id ?? null,
            products: variantIds.length,
            releasedReservations: reservations.map((r) => r.id),
            navUnlinked: navRows.map((row) => row.id),
            arrivalsReopened: arrivals.count,
            incomingWithdrawn,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }
}
