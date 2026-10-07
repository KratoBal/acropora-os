import { Controller, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { QuoteVersionEditor } from "./quote-version-editor.js";
import { QuotesService } from "./quotes.service.js";

/**
 * `POST /quote-bom-items/:id/create-product` (P1 decision 2): a local product
 * from a CUSTOM BOM row. It writes the catalog, so it asks for
 * `products.manage` beside `quotes.manage`.
 */
@Controller("quote-bom-items")
export class QuoteBomItemsController {
  constructor(
    private readonly editor: QuoteVersionEditor,
    private readonly quotes: QuotesService,
  ) {}

  @Post(":id/create-product")
  @RequirePermissions(
    PERMISSIONS.QUOTES_VIEW,
    PERMISSIONS.QUOTES_MANAGE,
    PERMISSIONS.PRODUCTS_MANAGE,
  )
  async createProduct(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const created = await this.editor.createProductFromBomItem(id, user);
    return {
      product: {
        productId: created.productId,
        variantId: created.variantId,
        sku: created.sku,
      },
      quote: await this.quotes.get(created.quoteId, user),
    };
  }
}
