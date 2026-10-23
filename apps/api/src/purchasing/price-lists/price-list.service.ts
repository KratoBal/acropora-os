import { createHash } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type {
  SupplierPriceListFormat,
  SupplierPriceListSummary,
  SupplierPriceListsResponse,
  SupplierPriceListUploadResult,
  SupplierPriceListCoverage,
} from "@acropora/types";

import {
  barcodeQueryCodes,
  decideMatches,
  groupVariantsByGtin,
  tallyDecisions,
} from "./price-list-matching.js";
import { parsePriceList } from "./parse-price-list.js";
import {
  PriceListRepository,
  type CoverageRaw,
} from "./price-list.repository.js";
import {
  PriceListParseError,
  type PriceListParseErrorCode,
} from "./price-list.types.js";

/** A teljes fájl elutasításának oka, magyarul. */
export const PARSE_ERROR_MESSAGES: Record<PriceListParseErrorCode, string> = {
  FILE_TOO_LARGE: "A fájl a 15 MB-os korlát fölött van.",
  UNREADABLE_ENCODING:
    "A fájl nem szöveges (UTF-8 vagy Windows-1252) fájl. Csak a beszállító CSV-je tölthető fel.",
  HEADER_NOT_FOUND:
    "A fájl nem a választott formátumú: a fejlécsor (az oszlopnevek) nincs benne. Ellenőrizd a beszállítót és a formátumot.",
  NO_VALID_ROWS: "A fájlban egyetlen olvasható árlista-sor sincs.",
  TOO_MANY_REJECTED_ROWS:
    "A sorok több mint tizedét nem lehetett beolvasni: a fájl valószínűleg nem a választott formátumú, vagy sérült.",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A lista dátuma: létező nap, és nem a jövőben (egy elgépelt dátum nem lehet jövőbeli). */
export function parseListDate(text: string, now: Date): Date {
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text)
    throw new BadRequestException("A lista dátuma nem létező nap.");
  if (date.getTime() > now.getTime() + DAY_MS)
    throw new BadRequestException("A lista dátuma nem lehet a jövőben.");
  return date;
}

/** A lekérdezés sora -> a válasz; ha a listának nincs sora, minden szám nulla. */
export function toCoverage(
  row: CoverageRaw | undefined,
): SupplierPriceListCoverage {
  return {
    rows: row?.rows ?? 0,
    matched: {
      ean: { auto: row?.eanAuto ?? 0, approved: row?.eanApproved ?? 0 },
      supplierCode: {
        auto: row?.codeAuto ?? 0,
        approved: row?.codeApproved ?? 0,
      },
      name: { auto: row?.nameAuto ?? 0, approved: row?.nameApproved ?? 0 },
    },
    rejected: row?.rejected ?? 0,
    unmatchedWithBarcode: row?.unmatchedWithBarcode ?? 0,
    unmatchedWithoutBarcode: row?.unmatchedWithoutBarcode ?? 0,
    unmatchedBarcodeKnownToUs: row?.unmatchedBarcodeKnownToUs ?? 0,
  };
}

export interface UploadInput {
  supplierId: string;
  format: SupplierPriceListFormat;
  listDate: string;
  currency: string;
  file: { originalname: string; buffer: Buffer };
  userId: string;
}

/**
 * AZ ÁRLISTA FELTÖLTÉSE ÉS A TERMÉKPÁROSÍTÁS AUTOMATIKUS RÉSZE (task
 * beszallitoi-arlistak-2). A sorrend: ellenőrzés (beszállító, dátum, pénznem),
 * a fájl feldolgozása (a formátum a feltöltő választása; ami nem illik rá, azt
 * EGÉSZBEN elutasítjuk), duplikátum-ellenőrzés a lenyomattal, mentés, majd a
 * párosítás. A mentés és a párosítás KÜLÖN tranzakció: a párosítás hibája
 * hibával tér vissza, de a mentett lista megmarad. A párosítás ismételhető (a
 * jóváhagyott és az automatikus kötést nem dönti újra, a hiányzót pótolja), tehát
 * egy törlés és újrafeltöltés vagy a következő feltöltés kipótolja.
 */
@Injectable()
export class PriceListService {
  constructor(private readonly repository: PriceListRepository) {}

  async upload(
    input: UploadInput,
    now: Date = new Date(),
  ): Promise<SupplierPriceListUploadResult> {
    const supplier = await this.repository.supplier(input.supplierId);
    if (!supplier || !supplier.isSupplier)
      throw new NotFoundException("Nincs ilyen beszállító.");
    const listDate = parseListDate(input.listDate, now);
    const currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException("A pénznem hárombetűs kód (pl. EUR).");

    let parsed;
    try {
      parsed = parsePriceList(input.format, input.file.buffer);
    } catch (error) {
      if (error instanceof PriceListParseError)
        throw new BadRequestException(PARSE_ERROR_MESSAGES[error.code]);
      throw error;
    }

    const sourceSha256 = createHash("sha256")
      .update(input.file.buffer)
      .digest("hex");
    const earlier = await this.repository.duplicate(
      input.supplierId,
      sourceSha256,
    );
    if (earlier)
      throw new ConflictException(
        `Ezt a fájlt (${earlier.sourceFileName}) már feltöltötték ${earlier.createdAt
          .toISOString()
          .slice(0, 10)}-n, ${earlier.listDate
          .toISOString()
          .slice(
            0,
            10,
          )} dátummal. Ha javítani akarod, előbb töröld azt a listát.`,
      );

    // két egyidejű, azonos fájlú feltöltés közül a második az ellenőrzés után, a
    // mentésnél bukik az egyedi indexen: ugyanaz a válasz, mint a korai ellenőrzésé
    const listId = await this.repository
      .create(
        {
          supplierId: input.supplierId,
          format: input.format,
          listDate,
          currency,
          sourceFileName: input.file.originalname.slice(0, 255),
          sourceSha256,
          rowCount: parsed.entries.length,
          rejectedRowCount: parsed.rejected.length,
          uploadedById: input.userId,
        },
        parsed.entries,
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
          throw new ConflictException(
            "Ezt a fájlt közben már feltöltötték ennek a beszállítónak.",
          );
        throw error;
      });

    const matching = await this.match(input.supplierId, parsed.entries);
    const rejectedByReason: Record<string, number> = {};
    for (const row of parsed.rejected)
      rejectedByReason[row.reason] = (rejectedByReason[row.reason] ?? 0) + 1;
    return {
      listId,
      supplierId: input.supplierId,
      format: input.format,
      listDate: input.listDate,
      currency,
      fileName: input.file.originalname.slice(0, 255),
      rowCount: parsed.entries.length,
      rejectedRowCount: parsed.rejected.length,
      skippedRows: parsed.skippedRows,
      duplicateRows: parsed.duplicateRows,
      rejectedByReason,
      matching,
    };
  }

  private async match(
    supplierId: string,
    entries: Parameters<typeof decideMatches>[0]["entries"],
  ) {
    const skus = entries.map((entry) => entry.supplierSku);
    const queryCodes = entries.flatMap((entry) =>
      entry.gtin ? barcodeQueryCodes(entry.gtin) : [],
    );
    const [barcodes, existing, knownCodes] = await Promise.all([
      this.repository.barcodes(queryCodes),
      this.repository.existingMatches(supplierId, skus),
      this.repository.knownCodes(supplierId, skus),
    ]);
    const decisions = decideMatches({
      entries,
      variantsByGtin: groupVariantsByGtin(barcodes),
      existing,
      knownCodes,
    });
    await this.repository.saveAutoMatches(supplierId, decisions);
    return tallyDecisions(decisions);
  }

  async lists(supplierId?: string): Promise<SupplierPriceListsResponse> {
    const rows = await this.repository.lists(supplierId);
    const [coverage, variants] = await Promise.all([
      this.repository.coverage(rows.map((row) => row.id)),
      this.repository.variantBarcodeCounts(),
    ]);
    return {
      variants,
      items: rows.map((row): SupplierPriceListSummary => ({
        id: row.id,
        supplierId: row.supplierId,
        supplierName: row.supplier.name,
        format: row.format,
        listDate: row.listDate.toISOString().slice(0, 10),
        currency: row.currency,
        fileName: row.sourceFileName,
        rowCount: row.rowCount,
        rejectedRowCount: row.rejectedRowCount,
        createdAt: row.createdAt.toISOString(),
        coverage: toCoverage(coverage.get(row.id)),
      })),
    };
  }

  /**
   * A lista törlése: a CSERE ÚTJA (barracuda a terv átnézésén). A fájlt nem
   * tároljuk, a lenyomat egyedi: egy javított beolvasóval vagy egy rossz
   * dátummal újra feltölteni csak törlés után lehet. A sorok a listával mennek;
   * a termékpárosítás marad, mert a `(beszállító, cikkszám)` kulcson él, nem a
   * listán, és az ember döntései nem vesznek el.
   */
  async remove(id: string, userId: string): Promise<{ removedRows: number }> {
    const removed = await this.repository.remove(id, userId);
    if (!removed) throw new NotFoundException("Nincs ilyen árlista.");
    return { removedRows: removed.rowCount };
  }
}
