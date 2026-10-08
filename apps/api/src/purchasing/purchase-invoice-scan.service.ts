import { createHash } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";
import type { PurchaseInvoiceScan } from "@acropora/types";

import { detectUploadedFileKind } from "../service-assets/uploaded-file-type.js";
import {
  scanAsPdf,
  ScanTimedOut,
  ScanTooLarge,
  ScanUnreadable,
} from "./purchase-invoice-scan.js";

/**
 * THE SCANNED INVOICE OF A RECORDED PURCHASE INVOICE (card 5ec62e35, Luca;
 * acrobot's decision 28076: the incoming-invoice store, not a new one).
 *
 * The scan is an IncomingSupplierDocument (origin UPLOAD) with a DIRECT link
 * to the purchase invoice, independent of the file reader and of the lines.
 * It also carries the invoice's number and the supplier's tax number as its
 * reading, so the number-and-tax lookups (the incoming invoices' PDF, the
 * accountant's package) find it too; for that key the direct link is ordered
 * first (`collectedPdfIndex`). A JPEG or PNG is stored as a one-page PDF.
 */
@Injectable()
export class PurchaseInvoiceScanService {
  private readonly database = prisma;

  async list(purchaseInvoiceId: string): Promise<PurchaseInvoiceScan[]> {
    const rows = await this.database.incomingSupplierDocument.findMany({
      where: { purchaseInvoiceId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, fileName: true, sizeBytes: true, createdAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async attach(
    purchaseInvoiceId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    userId: string,
  ): Promise<PurchaseInvoiceScan[]> {
    const invoice = await this.database.purchaseInvoice.findUnique({
      where: { id: purchaseInvoiceId },
      select: {
        id: true,
        supplierInvoiceNumber: true,
        supplier: { select: { taxNumber: true } },
      },
    });
    if (!invoice)
      throw new NotFoundException("A beszerzési számla nem található.");
    const kind = detectUploadedFileKind(file.mimetype, file.buffer);
    if (kind === null)
      throw new BadRequestException(
        "Csak PDF, JPEG vagy PNG fájl csatolható számlaképként.",
      );
    const safeName =
      file.originalname
        .normalize("NFKC")
        .replace(/[\\/\u0000-\u001f\u007f]/g, "-")
        .slice(0, 180) || "szamlakep";
    let stored: Awaited<ReturnType<typeof scanAsPdf>>;
    try {
      stored = await scanAsPdf(new Uint8Array(file.buffer), kind, safeName);
    } catch (error) {
      if (error instanceof ScanTooLarge)
        throw new BadRequestException(
          "Túl nagy kép: töltsd fel JPEG-ként vagy kisebb felbontásban.",
        );
      if (error instanceof ScanUnreadable)
        throw new BadRequestException("A kép nem olvasható.");
      if (error instanceof ScanTimedOut)
        throw new BadRequestException(
          "A kép átalakítása fél perc alatt nem készült el: töltsd fel JPEG-ként vagy kisebb felbontásban.",
        );
      throw error;
    }
    const sha256 = createHash("sha256").update(stored.bytes).digest("hex");

    // the same file twice on the same invoice is one attachment
    const existing = await this.database.incomingSupplierDocument.findFirst({
      where: { purchaseInvoiceId, sha256 },
      select: { id: true },
    });
    if (!existing)
      await this.database.$transaction(async (tx) => {
        const document = await tx.incomingSupplierDocument.create({
          data: {
            gmailMessageId: `upload:${sha256}:${Date.now()}`,
            fileName: stored.fileName,
            sizeBytes: stored.bytes.length,
            sha256,
            content: new Uint8Array(stored.bytes),
            // not machine-read: the same marking as the other uploads
            status: "FAILED",
            kind: "INVOICE",
            origin: "UPLOAD",
            uploadKind: "INVOICE",
            uploadedByUserId: userId,
            payeeCheck: "COMPANY",
            textReading: {
              invoiceNumber: invoice.supplierInvoiceNumber,
              numberFrom: null,
              supplierTaxNumber: invoice.supplier.taxNumber ?? null,
            } as Prisma.InputJsonValue,
            purchaseInvoiceId,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: "purchase_invoice.scan_attached",
            entityType: "PurchaseInvoice",
            entityId: purchaseInvoiceId,
            metadata: {
              documentId: document.id,
              fileName: stored.fileName,
              converted: kind !== "pdf",
            },
          },
        });
      });
    return this.list(purchaseInvoiceId);
  }

  async bytes(
    purchaseInvoiceId: string,
    documentId: string,
  ): Promise<{ fileName: string; bytes: Buffer }> {
    const row = await this.database.incomingSupplierDocument.findFirst({
      where: { id: documentId, purchaseInvoiceId },
      select: { fileName: true, content: true },
    });
    if (!row) throw new NotFoundException("A számlakép nem található.");
    return { fileName: row.fileName, bytes: Buffer.from(row.content) };
  }
}
