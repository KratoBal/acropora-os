import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";
import { BillingDocumentPdfService } from "./billing-document-pdf.service.js";
import { BillingDocumentListQueryDto } from "./dto/billing-document-list-query.dto.js";

/**
 * A BIZONYLATOK OLVASÓ VÉGPONTJAI: a lista és a PDF (nautilus; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 * A jog `billing.view` (#1276), ugyanaz, mint a részleteké: aki a listát
 * látja, a sort meg is nyithatja és kinyomtathatja.
 */
@Controller("billing/documents")
@RequirePermissions(PERMISSIONS.BILLING_VIEW)
export class BillingDocumentReadController {
  constructor(
    private readonly documents: BillingDocumentListRepository,
    private readonly pdfs: BillingDocumentPdfService,
  ) {}

  @Get()
  list(@Query() query: BillingDocumentListQueryDto) {
    return this.documents.list(query);
  }

  /** Inline: a nyomtatás ugyanezt a fájlt nyitja meg. */
  @Get(":id/pdf")
  @Header("Cache-Control", "private, no-store")
  async pdf(@Param("id") id: string) {
    const { bytes, fileName } = await this.pdfs.pdf(id);
    return new StreamableFile(bytes, {
      type: "application/pdf",
      length: bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }
}
