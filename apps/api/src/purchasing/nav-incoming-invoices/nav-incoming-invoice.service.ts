import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  NavIncomingInvoiceDetail,
  NavIncomingInvoiceListResponse,
} from "@acropora/types";

import { NavCredentialsService } from "../../integrations/nav/nav-credentials.service.js";
import {
  parseNavInvoiceData,
  suggestedVatRatePercent,
} from "../../integrations/nav/nav-invoice-data.parser.js";
import {
  NavApiError,
  NavOnlineInvoiceClient,
  type NavInvoiceDigestItem,
} from "../../integrations/nav/nav-online-invoice.client.js";
import { decodeInvoiceDataXml } from "../../integrations/nav/nav-xml.util.js";
import type { NavIncomingInvoiceListQueryDto } from "./dto/nav-incoming-invoice-list-query.dto.js";
import {
  NavIncomingInvoiceRepository,
  storableDigestItem,
} from "./nav-incoming-invoice.repository.js";
import {
  hungarianTaxBase,
  toNavIncomingInvoiceDetail,
  type NavIncomingInvoiceRow,
  type StoredNavInvoiceParsedData,
} from "./nav-incoming-invoice.types.js";

// A UNAS vevő-szinkronnal megegyező 120mp átfedés (lásd
// UnasCustomerSyncService): egy, az ablak határán éppen regisztrált számla
// nem csúszhat át észrevétlenül a következő futásra.
const OVERLAP_MS = 120_000;
// Biztonsági korlát a digest-ablak méretére - a NAV dokumentáció nem
// ismerteti egyértelműen az insDate-alapú lekérdezés maximális
// időtartományát, ez csak egy defenzív felső határ, nem hivatalos NAV-limit.
const MAX_WINDOW_MS = 30 * 24 * 60 * 60_000;
const MAX_PAGES = 50;

function hasParsedLines(row: { parsedData: unknown }): boolean {
  if (
    !row.parsedData ||
    typeof row.parsedData !== "object" ||
    Array.isArray(row.parsedData)
  )
    return false;
  return (
    Array.isArray((row.parsedData as { lines?: unknown }).lines) &&
    (row.parsedData as { lines: unknown[] }).lines.length > 0
  );
}

export interface NavBackfillWindowResult {
  windowStart: string;
  windowEnd: string;
  invoicesSeen: number;
  /** Szárazon: ennyi jönne létre; élesen: ennyi jött létre. */
  createdCount: number;
  skippedCount: number;
  dryRun: boolean;
}

/**
 * Egymás utáni, legfeljebb 30 napos ablakok `from`-tól `to`-ig. A NAV a
 * befogadási dátumra legfeljebb 35 napos tartományt fogad el; a 30 a napi
 * szinkron saját határa is.
 */
export function backfillWindows(
  from: Date,
  to: Date,
  maxMs: number = MAX_WINDOW_MS,
): { start: Date; end: Date }[] {
  const windows: { start: Date; end: Date }[] = [];
  for (
    let start = from.getTime();
    start < to.getTime();
    start = Math.min(start + maxMs, to.getTime())
  )
    windows.push({
      start: new Date(start),
      end: new Date(Math.min(start + maxMs, to.getTime())),
    });
  return windows;
}

@Injectable()
export class NavIncomingInvoiceService {
  constructor(
    private readonly client: NavOnlineInvoiceClient,
    private readonly credentials: NavCredentialsService,
    private readonly repository: NavIncomingInvoiceRepository,
  ) {}

  list(
    query: NavIncomingInvoiceListQueryDto,
  ): Promise<NavIncomingInvoiceListResponse> {
    return this.repository.list(query);
  }

  /// Lusta betöltés: a digest-szinkron csak a kivonatot tölti le, a teljes
  /// tétellista (queryInvoiceData) csak akkor kerül lekérdezésre és
  /// elparszolásra, amikor a felhasználó ténylegesen megnyitja a
  /// részletnézetet - a legtöbb digest-sor sosem kerül bevételezésre, ezért
  /// nem éri meg mindegyikhez azonnal a teljes adatot lekérni.
  async detail(id: string): Promise<NavIncomingInvoiceDetail> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException("A NAV számla nem található.");
    // A korábbi parser a szabványos lineNetAmountData wrapper miatt üres
    // tétellistát tudott DATA_FETCHED állapotban elmenteni. Az ilyen
    // rekordokat egyszer újrakérjük, hogy a javítás deployja után a már
    // megnyitott számlák is automatikusan helyreálljanak.
    if (
      row.status === "NEW" ||
      row.status === "ERROR" ||
      (row.status === "DATA_FETCHED" && !hasParsedLines(row))
    ) {
      try {
        const credentials = await this.credentials.resolve();
        const dataResult = await this.client.queryInvoiceData(
          row.navInvoiceNumber,
          "INBOUND",
          row.supplierTaxNumber,
          credentials.technicalUser,
          credentials.software,
        );
        if (!dataResult.invoiceDataBase64)
          throw new NavApiError(
            "RESPONSE_SHAPE_INVALID",
            "invoiceData hiányzik a NAV válaszból",
          );
        const businessXml = decodeInvoiceDataXml(
          dataResult.invoiceDataBase64,
          dataResult.compressed,
        );
        const parsed = parseNavInvoiceData(businessXml);
        if (parsed.lines.length === 0)
          throw new NavApiError(
            "RESPONSE_SHAPE_INVALID",
            "A NAV invoiceData nem tartalmaz feldolgozható tételsort.",
          );
        const stored: StoredNavInvoiceParsedData = {
          ...parsed,
          suggestedVatRatePercent: suggestedVatRatePercent(parsed.lines),
        };
        await this.repository.saveParsedData(id, stored);
      } catch (error) {
        const errorCode =
          error instanceof NavApiError
            ? error.code
            : "NAV_INVOICE_DATA_FETCH_FAILED";
        await this.repository.markError(id, errorCode);
        throw error;
      }
      const refreshed = await this.repository.findById(id);
      if (!refreshed)
        throw new NotFoundException("A NAV számla nem található.");
      return this.withSupplier(refreshed);
    }
    return this.withSupplier(row);
  }

  /**
   * The detail with the supplier resolved by tax base, as an arrival from
   * mail resolves it by VAT id: the editor selects it, and the line
   * suggestions start. The NAV gives the same company as `14116380` on one
   * invoice and `14116380-2-06` on another; the first 8 digits are the key.
   */
  private async withSupplier(
    row: NavIncomingInvoiceRow,
  ): Promise<NavIncomingInvoiceDetail> {
    const taxBase = hungarianTaxBase(row.supplierTaxNumber);
    const supplierId = taxBase
      ? await this.repository.supplierIdByTaxBase(taxBase)
      : null;
    return { ...toNavIncomingInvoiceDetail(row), supplierId };
  }

  async sync(windowEnd = new Date()) {
    const cursor = await this.repository.getCursor();
    const rawWindowStart = cursor
      ? new Date(cursor.getTime() - OVERLAP_MS)
      : new Date(windowEnd.getTime() - MAX_WINDOW_MS);
    const windowStart =
      windowEnd.getTime() - rawWindowStart.getTime() > MAX_WINDOW_MS
        ? new Date(windowEnd.getTime() - MAX_WINDOW_MS)
        : rawWindowStart;

    const runId = await this.repository.createRun({ windowStart, windowEnd });
    try {
      const items = await this.downloadDigest(windowStart, windowEnd);
      return await this.repository.applyDigest(
        runId,
        items,
        windowStart,
        windowEnd,
      );
    } catch (error) {
      const errorCode =
        error instanceof NavApiError
          ? error.code
          : error instanceof Error
            ? error.message
            : "NAV_INVOICE_SYNC_FAILED";
      await this.repository.markFailed(runId, errorCode);
      throw error;
    }
  }

  /**
   * A VISSZATÖLTÉS (acrobot, 2026-09-30): a napi szinkron a kurzorról halad
   * előre, legfeljebb 30 napot visszanézve, tehát egy régebbi időszakot nem
   * tud betölteni. Ez 30 napos befogadási (insDate) ablakokban megy végig
   * `from`-tól `to`-ig, ugyanazzal a letöltéssel és ugyanazzal az idempotens
   * beírással, de a KURZORHOZ NEM NYÚL. Szárazon csak lekérdez és számol:
   * nem ír, futás-rekordot sem nyit.
   */
  async backfill(options: {
    from: Date;
    to?: Date;
    dryRun: boolean;
    onWindow?: (result: NavBackfillWindowResult) => void;
  }): Promise<NavBackfillWindowResult[]> {
    const results: NavBackfillWindowResult[] = [];
    for (const window of backfillWindows(
      options.from,
      options.to ?? new Date(),
    )) {
      const items = await this.downloadDigest(window.start, window.end);
      let result: NavBackfillWindowResult;
      if (options.dryRun) {
        const creatable = items.filter(storableDigestItem).length;
        const known = await this.repository.countKnown(items);
        result = {
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
          invoicesSeen: items.length,
          createdCount: creatable - known,
          skippedCount: items.length - (creatable - known),
          dryRun: true,
        };
      } else {
        const runId = await this.repository.createRun({
          windowStart: window.start,
          windowEnd: window.end,
        });
        try {
          const applied = await this.repository.applyDigest(
            runId,
            items,
            window.start,
            window.end,
            { moveCursor: false },
          );
          result = {
            windowStart: window.start.toISOString(),
            windowEnd: window.end.toISOString(),
            invoicesSeen: applied.invoicesSeen,
            createdCount: applied.createdCount,
            skippedCount: applied.skippedCount,
            dryRun: false,
          };
        } catch (error) {
          await this.repository.markFailed(
            runId,
            error instanceof Error
              ? error.message
              : "NAV_INVOICE_BACKFILL_FAILED",
          );
          throw error;
        }
      }
      results.push(result);
      options.onWindow?.(result);
    }
    return results;
  }

  private async downloadDigest(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<NavInvoiceDigestItem[]> {
    const credentials = await this.credentials.resolve();
    const items: NavInvoiceDigestItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.client.queryInvoiceDigest(
        page,
        "INBOUND",
        windowStart,
        windowEnd,
        credentials.technicalUser,
        credentials.software,
      );
      items.push(...result.items);
      if (page >= result.availablePage) break;
    }
    return items;
  }
}
