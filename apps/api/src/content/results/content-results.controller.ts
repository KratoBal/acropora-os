import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import {
  ContentResultWeekDto,
  ContentResultsSummaryQueryDto,
} from "./content-results.dto.js";
import { ContentResultsService } from "./content-results.service.js";

/**
 * THE CONTENT'S RESULTS (T5.5 S8). Reading is `content.view`; a week's numbers are written behind `content.manage` by a
 * person (the service refuses a machine account). `results/summary` is declared first: its literal segment must not be
 * read as an item id.
 */
@Controller("content")
export class ContentResultsController {
  constructor(private readonly service: ContentResultsService) {}

  @Get("results/summary")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  summary(@Query() query: ContentResultsSummaryQueryDto) {
    return this.service.summary(query.from, query.to);
  }

  @Get(":id/results")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  results(@Param("id") id: string) {
    return this.service.results(id);
  }

  @Put(":id/results/:week")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  saveWeek(
    @Param("id") id: string,
    @Param("week") week: string,
    @Body() input: ContentResultWeekDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveWeek(id, week, input, user);
  }
}
