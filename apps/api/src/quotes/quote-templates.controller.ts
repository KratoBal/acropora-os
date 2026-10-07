import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { QuotesRepository } from "./quotes.repository.js";

/** The template picker at "new quote" (P1 decision 1: no template editor). */
@Controller("quote-templates")
export class QuoteTemplatesController {
  constructor(private readonly repository: QuotesRepository) {}

  @Get()
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  list() {
    return this.repository.templates();
  }
}
