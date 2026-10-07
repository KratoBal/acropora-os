import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../auth/decorators/require-permissions.decorator.js";
import {
  QuoteSnippetBodyDto,
  QuoteSnippetListQueryDto,
  QuoteSnippetPatchDto,
} from "./dto/quote-editor.dto.js";
import { QuoteSnippetsService } from "./quote-snippets.service.js";
import { QuotesRepository } from "./quotes.repository.js";

/** The snippet library: read by quote writers, written by template managers. */
@Controller("quote-snippets")
export class QuoteSnippetsController {
  constructor(private readonly snippets: QuoteSnippetsService) {}

  @Get()
  @RequireAnyPermission(
    PERMISSIONS.QUOTES_MANAGE,
    PERMISSIONS.QUOTES_TEMPLATES_MANAGE,
  )
  list(@Query() query: QuoteSnippetListQueryDto) {
    return this.snippets.list(query.includeArchived === true);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTES_TEMPLATES_MANAGE)
  create(
    @Body() input: QuoteSnippetBodyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.snippets.create(input, user);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.QUOTES_TEMPLATES_MANAGE)
  update(
    @Param("id") id: string,
    @Body() patch: QuoteSnippetPatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.snippets.update(id, patch, user);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_TEMPLATES_MANAGE)
  archive(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.snippets.archive(id, user);
  }
}

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
