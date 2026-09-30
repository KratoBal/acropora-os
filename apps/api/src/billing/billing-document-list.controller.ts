import { Controller, Get, Query } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { BillingDocumentListRepository } from "./billing-document-list.repository.js";
import { BillingDocumentListQueryDto } from "./dto/billing-document-list-query.dto.js";

/**
 * A BIZONYLATLISTA VÉGPONTJA (nautilus; szerződés:
 * agents/nautilus/megosztas/szamlazas-kiallitas-lista-reszletek-vegpontok.md).
 * A jog `billing.view` (#1276), ugyanaz, mint a részleteké: aki a listát
 * látja, a sort meg is nyithatja.
 */
@Controller("billing/documents")
export class BillingDocumentListController {
  constructor(private readonly documents: BillingDocumentListRepository) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING_VIEW)
  list(@Query() query: BillingDocumentListQueryDto) {
    return this.documents.list(query);
  }
}
