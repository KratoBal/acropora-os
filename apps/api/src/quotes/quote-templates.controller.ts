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
import { QuoteSnippetListQueryDto } from "./dto/quote-editor.dto.js";
import {
  QuoteTemplateBodyDto,
  QuoteTemplatePatchDto,
} from "./dto/quote-templates.dto.js";
import { QuoteTemplatesService } from "./quote-templates.service.js";

/**
 * The templates: read by quote writers (the picker at "new quote"), written
 * by template managers (Beállítások), like the snippet library.
 */
@Controller("quote-templates")
export class QuoteTemplatesController {
  constructor(private readonly templates: QuoteTemplatesService) {}

  @Get()
  @RequireAnyPermission(
    PERMISSIONS.QUOTES_MANAGE,
    PERMISSIONS.QUOTES_TEMPLATES_MANAGE,
  )
  list(@Query() query: QuoteSnippetListQueryDto) {
    return this.templates.list(query.includeArchived === true);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.QUOTES_TEMPLATES_MANAGE)
  create(
    @Body() input: QuoteTemplateBodyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templates.create(input, user);
  }

  @Patch(":id")
  @RequirePermissions(PERMISSIONS.QUOTES_TEMPLATES_MANAGE)
  update(
    @Param("id") id: string,
    @Body() patch: QuoteTemplatePatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.templates.update(id, patch, user);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.QUOTES_TEMPLATES_MANAGE)
  archive(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.archive(id, user);
  }
}
