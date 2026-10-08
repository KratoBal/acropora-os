import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  CreateQuoteDto,
  QuoteHeaderDto,
  QuoteListQueryDto,
} from "./dto/quotes.dto.js";
import { QuotesService } from "./quotes.service.js";
@Controller("quotes")
export class QuotesController {
  constructor(private readonly service: QuotesService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  list(
    @Query() query: QuoteListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(user, query.page, query.pageSize, {
      q: query.q,
      status: query.status,
      closeReason: query.closeReason,
      expired: query.expired === "1" || query.expired === "true",
    });
  }
  @Get(":id")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }
  @Post()
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  create(
    @Body() input: CreateQuoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(input, user);
  }
  @Patch(":id")
  @RequirePermissions(PERMISSIONS.QUOTES_MANAGE)
  update(
    @Param("id") id: string,
    @Body() input: QuoteHeaderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, input, user);
  }
}
