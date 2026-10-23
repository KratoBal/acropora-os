import {
  PERMISSIONS,
  type InvoiceCollectionItemsResponse,
} from "@acropora/types";
import { Controller, Get, Query } from "@nestjs/common";

import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { InvoiceCollectionItemsService } from "./invoice-collection-items.service.js";

/**
 * A GYŰJTŐ ÍTÉLETEI (acrobot 35522). Jog: a Hiányzó számláké, `finance.view`.
 * Csak olvas; a fájl tartalma nem jön ki, és a nem tárolt fájloké nincs is meg.
 */
@Controller("missing-invoices/collection-items")
export class InvoiceCollectionItemsController {
  constructor(private readonly items: InvoiceCollectionItemsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  list(
    @Query("verdict") verdict?: string,
    @Query("source") source?: string,
    @Query("limit") limit?: string,
  ): Promise<InvoiceCollectionItemsResponse> {
    return this.items.list({ verdict, source, limit });
  }
}
