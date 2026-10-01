import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  StreamableFile,
} from "@nestjs/common";
import {
  PERMISSIONS,
  type AuthenticatedUser,
  type InvoiceCollectionSuggestionsResponse,
} from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { InvoiceCollectionSuggestionsService } from "./invoice-collection-suggestions.service.js";

/**
 * A JEV JAVASLATAI A BEGYŰJTÉSBŐL (levél-válogatás terv, 4. szelet; acrobot
 * 25803). A jogok a Hiányzó számláké: a lista és a PDF `finance.view`, a döntés
 * `finance.manage`.
 */
@Controller("missing-invoices/suggestions")
export class InvoiceCollectionSuggestionsController {
  constructor(
    private readonly suggestions: InvoiceCollectionSuggestionsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  list(): Promise<InvoiceCollectionSuggestionsResponse> {
    return this.suggestions.list();
  }

  /** A javasolt PDF, a böngészőben megnyitva (inline): a döntéshez látni kell. */
  @Get(":id/file")
  @Header("Cache-Control", "private, no-store")
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async file(@Param("id") id: string) {
    const { fileName, content } = await this.suggestions.file(id);
    return new StreamableFile(content, {
      type: "application/pdf",
      length: content.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Post(":id/accept")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  accept(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suggestions.accept(id, user);
  }

  @Post(":id/reject")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  reject(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suggestions.reject(id, user);
  }
}
