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
import { NavIncomingInvoiceRepository } from "./nav-incoming-invoice.repository.js";
import {
  toNavIncomingInvoiceDetail,
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
    if (row.status === "NEW" || row.status === "ERROR") {
      try {
        const dataResult = await this.client.queryInvoiceData(
          row.navInvoiceNumber,
          "INBOUND",
          row.supplierTaxNumber,
          this.credentials.technicalUser(),
          this.credentials.software(),
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
      return toNavIncomingInvoiceDetail(refreshed);
    }
    return toNavIncomingInvoiceDetail(row);
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

  private async downloadDigest(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<NavInvoiceDigestItem[]> {
    const user = this.credentials.technicalUser();
    const software = this.credentials.software();
    const items: NavInvoiceDigestItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const result = await this.client.queryInvoiceDigest(
        page,
        "INBOUND",
        windowStart,
        windowEnd,
        user,
        software,
      );
      items.push(...result.items);
      if (page >= result.availablePage) break;
    }
    return items;
  }
}
