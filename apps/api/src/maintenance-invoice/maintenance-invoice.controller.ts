import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from "class-validator";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { MaintenanceInvoiceDraftService } from "./maintenance-invoice-draft.service.js";
import { MaintenanceInvoiceIssueService } from "./maintenance-invoice-issue.service.js";

/**
 * A piszkozat kérése: a megrendeléses (munkalap nélküli) TIG aláírt példány nélkül csak a
 * kezelő kifejezett megerősítésével számlázható (Balázs, 2026-11-04 17:38 UTC).
 */
export class MaintenanceInvoiceDraftDto {
  @IsOptional() @IsBoolean() acknowledgeUnsigned?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The TIG invoice's issue (card 7ba97e0d, S3): what the confirmation window showed and the person confirmed, the three
 * dates and the digest of the shown values (`GET :invoiceId/issue-summary` gives them), and "Elküldöm e-mailben". The
 * dates' own rule (`checkBillingIssueDates`) runs in the issue.
 */
export class MaintenanceInvoiceIssueDto {
  @Matches(DAY)
  issueDate!: string;

  @Matches(DAY)
  fulfillmentDate!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(DAY)
  dueDate?: string | null;

  @IsString()
  @Length(64, 64)
  fingerprint!: string;

  @IsBoolean()
  send!: boolean;
}

/**
 * A KARBANTARTÁSI PISZKOZAT-SZÁMLA (ADR-014, 4. szelet).
 *
 * Ugyanaz a jog, mint a csomag vezérlőjén: `PARTNERS_MANAGE` -- a `SERVICE`
 * szerepkör (a technikus) szerkezetileg nem éri el.
 */
@Controller("partners/maintenance-invoice")
@RequirePermissions(PERMISSIONS.PARTNERS_MANAGE)
export class MaintenanceInvoiceController {
  constructor(
    private readonly draftService: MaintenanceInvoiceDraftService,
    private readonly issuing: MaintenanceInvoiceIssueService,
  ) {}

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
  draft(
    @Param("certificateId") certificateId: string,
    @Body() body: MaintenanceInvoiceDraftDto = {},
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.draftService.draftFor(certificateId, {
      acknowledgeUnsigned: body.acknowledgeUnsigned === true,
      actor: user,
    });
  }

  /**
   * A VALÓDI KIÁLLÍTÁS (146ccc61). A jog SZIGORÚBB, mint a piszkozaté: egy
   * NAV-nak bejelentett számla pénzügyi lépés, ezért `FINANCE_MANAGE` (a
   * metódus-szintű jog felülírja az osztályét, `getAllAndOverride`). A mai
   * szerepek közül az OWNER, az ADMIN és a MANAGER kapja; a WAREHOUSE-nak
   * `PARTNERS_MANAGE`-e van, tehát piszkozatot készíthet, kiállítani nem.
   */
  @Get(":invoiceId/issue-summary")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  issueSummary(@Param("invoiceId") invoiceId: string) {
    return this.draftService.issueSummary(invoiceId);
  }

  @Post(":invoiceId/issue")
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  issue(
    @Param("invoiceId") invoiceId: string,
    @Body() body: MaintenanceInvoiceIssueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issuing.issue(
      invoiceId,
      { ...body, dueDate: body.dueDate ?? null },
      user,
    );
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
