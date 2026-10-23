import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { PrismaClient } from "@acropora/database";

/**
 * PDF CSATOLÁSA EGY BEJÖVŐ SZÁMLÁHOZ (acrobot 34671, 34672; PS2026/01452).
 *
 * Ahová a feed nem hozott PDF-et, és a levélből sem gyűjtöttünk (vagy amit
 * gyűjtöttünk, annak a szövegéből nem olvasható ki a szám), ott eddig nem volt
 * út: a Hiányzó számlák feltöltése terheléshez kötött, egy nullás helyesbítőnek
 * vagy jóváírónak pedig nincs terhelése. Ez a feltöltés a SORHOZ köti a fájlt.
 *
 * Két kapcsolat, egymást kiegészítve:
 *   - a dokumentum kulcsa (`gmailMessageId`) a sor azonosítóját hordozza
 *     (`attach:incoming:<sor>:<lenyomat>`): ez a lista, a részletek és a
 *     letöltés kapcsolata, adószámtól függetlenül (a külföldi szállítónak
 *     nincs magyar adószám-törzse, a szám szerinti index nem találná meg);
 *   - az olvasata a sor számát, adószámát és bruttóját viszi: ugyanúgy jelölt
 *     a banki párosításban és a könyvelői csomagban, mint egy feltöltés.
 *
 * Csak ott enged, ahol PDF még nincs: egy meglévőt nem írunk felül és nem
 * teszünk mellé másodikat.
 */

export const ATTACH_PREFIX = "attach:incoming:";
const PDF_MAGIC = Buffer.from("%PDF-");

/** A sorokhoz csatolt PDF-ek, soronként a legrégebbi elöl. */
export async function attachedPdfIds(
  database: Pick<PrismaClient, "incomingSupplierDocument">,
  rowIds?: readonly string[],
): Promise<Map<string, string[]>> {
  const documents = await database.incomingSupplierDocument.findMany({
    where: {
      OR: rowIds
        ? rowIds.map((id) => ({
            gmailMessageId: { startsWith: `${ATTACH_PREFIX}${id}:` },
          }))
        : [{ gmailMessageId: { startsWith: ATTACH_PREFIX } }],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, gmailMessageId: true },
  });
  const byRow = new Map<string, string[]>();
  for (const document of documents) {
    const rowId = document.gmailMessageId
      .slice(ATTACH_PREFIX.length)
      .split(":")[0]!;
    byRow.set(rowId, [...(byRow.get(rowId) ?? []), document.id]);
  }
  return byRow;
}

export async function attachIncomingPdf(
  database: Pick<
    PrismaClient,
    | "incomingBillingDocument"
    | "incomingSupplierDocument"
    | "auditLog"
    | "$transaction"
  >,
  input: {
    rowId: string;
    file: { originalname: string; buffer: Buffer };
    userId: string;
    /** a sornak van-e már PDF-je bármelyik úton (a hívó tudja: feed, begyűjtött, csatolt) */
    hasPdf: boolean;
  },
): Promise<{ documentId: string }> {
  const row = await database.incomingBillingDocument.findUnique({
    where: { id: input.rowId },
    select: {
      id: true,
      documentNumber: true,
      supplierTaxNumber: true,
      supplierName: true,
      grossAmount: true,
      currency: true,
      kindCode: true,
    },
  });
  if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
  if (!input.file.buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC))
    throw new BadRequestException("Csak PDF tölthető fel.");
  if (input.hasPdf)
    throw new ConflictException("Ennek a számlának már van PDF-je.");
  const sha256 = createHash("sha256").update(input.file.buffer).digest("hex");
  return database.$transaction(async (tx) => {
    const document = await tx.incomingSupplierDocument.create({
      data: {
        gmailMessageId: `${ATTACH_PREFIX}${row.id}:${sha256}`,
        fileName: input.file.originalname,
        sizeBytes: input.file.buffer.length,
        sha256,
        content: new Uint8Array(input.file.buffer),
        status: "FAILED",
        kind: row.kindCode.toUpperCase() === "D" ? "PROFORMA" : "INVOICE",
        origin: "UPLOAD",
        uploadKind: "INVOICE",
        uploadedByUserId: input.userId,
        // a sor adatai: a szám szerinti index és a banki párosítás is ezt olvassa
        textReading: {
          invoiceNumber: row.documentNumber,
          numberFrom: null,
          supplierTaxNumber: row.supplierTaxNumber,
          supplierName: row.supplierName,
          gross: row.grossAmount.toFixed(2),
          currency: row.currency,
        },
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.incoming-pdf.attached",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: {
          documentId: document.id,
          fileName: input.file.originalname,
        },
      },
    });
    return { documentId: document.id };
  });
}

/**
 * EGY NEM PÁROSODOTT, TÁROLT LEVÉL-PDF HOZZÁRENDELÉSE EGY BEJÖVŐ SZÁMLÁHOZ
 * (acrobot 35522/35529: egy lépésben kézzel hozzárendelhető). A begyűjtés az
 * `UNASSIGNED` dokumentumot megőrzi, mert semmi nem kötötte; itt egy ember kötött.
 *
 * A dokumentum UGYANAZT kapja, mint a `attachIncomingPdf` fájlja: a kulcsa a
 * sor azonosítóját hordozza (`attach:incoming:<sor>:<lenyomat>`, adószámtól
 * függetlenül, külföldi szállítónál is), az olvasata a sor számát, adószámát és
 * bruttóját. Nem másolat: a MEGLÉVŐ dokumentum kulcsa és olvasata változik, a
 * tartalma nem, tehát nem keletkezik második példány.
 *
 * Csak `UNASSIGNED`-et köt (a Jev javaslatának külön elfogadása van), és csak
 * ott, ahol a sornak még nincs PDF-je.
 */
export async function assignDocumentToIncomingRow(
  database: Pick<
    PrismaClient,
    | "incomingBillingDocument"
    | "incomingSupplierDocument"
    | "invoiceCollectionItem"
    | "auditLog"
    | "$transaction"
  >,
  input: {
    rowId: string;
    documentId: string;
    userId: string;
    /** a sornak van-e már PDF-je bármelyik úton (a hívó tudja: feed, begyűjtött, csatolt) */
    hasPdf: boolean;
  },
): Promise<{ documentId: string }> {
  const row = await database.incomingBillingDocument.findUnique({
    where: { id: input.rowId },
    select: {
      id: true,
      documentNumber: true,
      supplierTaxNumber: true,
      supplierName: true,
      grossAmount: true,
      currency: true,
      kindCode: true,
    },
  });
  if (!row) throw new NotFoundException("Nincs ilyen bejövő számla.");
  if (input.hasPdf)
    throw new ConflictException("Ennek a számlának már van PDF-je.");
  const document = await database.incomingSupplierDocument.findFirst({
    where: { id: input.documentId, reviewState: "UNASSIGNED" },
    select: { id: true, fileName: true, sha256: true },
  });
  if (!document)
    throw new NotFoundException(
      "Nincs ilyen, hozzárendelésre váró (nem párosodott) fájl.",
    );
  return database.$transaction(async (tx) => {
    const { count } = await tx.incomingSupplierDocument.updateMany({
      where: { id: document.id, reviewState: "UNASSIGNED" },
      data: {
        gmailMessageId: `${ATTACH_PREFIX}${row.id}:${document.sha256}`,
        reviewState: null,
        reviewedAt: new Date(),
        reviewedByUserId: input.userId,
        kind: row.kindCode.toUpperCase() === "D" ? "PROFORMA" : "INVOICE",
        textReading: {
          invoiceNumber: row.documentNumber,
          numberFrom: null,
          supplierTaxNumber: row.supplierTaxNumber,
          supplierName: row.supplierName,
          gross: row.grossAmount.toFixed(2),
          currency: row.currency,
        },
      },
    });
    // közben döntöttek róla (elfogadták, elvetették, másik sorhoz kötötték)
    if (count === 0)
      throw new ConflictException("Erről a fájlról közben már döntöttek.");
    await tx.invoiceCollectionItem.updateMany({
      where: { documentId: document.id, verdict: "UNMATCHED" },
      data: { verdict: "STORED" },
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.incoming-pdf.assigned",
        entityType: "IncomingBillingDocument",
        entityId: row.id,
        metadata: { documentId: document.id, fileName: document.fileName },
      },
    });
    return { documentId: document.id };
  });
}
