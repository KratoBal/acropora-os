import {
  Controller,
  Get,
  Header,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";

/**
 * A KARBANTARTÁSI PISZKOZAT-SZÁMLA (ADR-014, 4. szelet).
 *
 * Ugyanaz a jog, mint a csomag vezérlőjén: `PARTNERS_MANAGE` -- a `SERVICE`
 * szerepkör (a technikus) szerkezetileg nem éri el.
 */
@Controller("partners/maintenance-invoice")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class MaintenanceInvoiceController {
  constructor(private readonly draftService: MaintenanceInvoiceDraftService) {}

  /**
   * CSAK OLVASÁS, Számlázz.hu-hívás nélkül -- a panel ezt hívja
   * betöltéskor, hogy tudja, van-e már piszkozat erre az igazolásra.
   * `null`, ha nincs (nem 404: a "még nincs piszkozat" a várt kezdőállapot).
   */
  @Get("by-certificate/:certificateId")
  byCertificate(@Param("certificateId") certificateId: string) {
    return this.draftService.byCertificate(certificateId);
  }

  /**
   * A TELJESÍTÉSI IGAZOLÁS AZONOSÍTÓJÁVAL indul, nem egy önálló számla-
   * azonosítóval -- ez maga az idempotencia-kulcs: ha erre az igazolásra már
   * áll piszkozat, ez a hívás nem hoz létre újat, a meglévőt adja vissza.
   */
  @Post(":certificateId/draft")
  draft(@Param("certificateId") certificateId: string) {
    return this.draftService.draftFor(certificateId);
  }

  /**
   * A VALÓDI KIÁLLÍTÁS (146ccc61). A jog SZIGORÚBB, mint a piszkozaté: egy
   * NAV-nak bejelentett számla pénzügyi lépés, ezért `FINANCE_MANAGE` (a
   * metódus-szintű jog felülírja az osztályét, `getAllAndOverride`). A mai
   * szerepek közül az OWNER, az ADMIN és a MANAGER kapja; a WAREHOUSE-nak
   * `PARTNERS_MANAGE`-e van, tehát piszkozatot készíthet, kiállítani nem.
   */
  @Post(":invoiceId/issue")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  issue(@Param("invoiceId") invoiceId: string) {
    return this.draftService.issue(invoiceId);
  }

  @Get(":invoiceId/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("invoiceId") invoiceId: string) {
    const { bytes, fileName } = await this.draftService.pdfDocument(invoiceId);
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }
}
