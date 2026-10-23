import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { SourceScreeningService } from "./source-screening.service.js";

/**
 * KUTATÁSI FORRÁSOK SZŰRÉSE (S4, Forrásszűrés, Figma 3:68). Olvasás
 * `knowledge.view`, döntés `knowledge.manage` joggal; minden döntés
 * AuditLog-sort ír.
 */
@Controller("knowledge-base/sources")
export class SourceScreeningController {
  constructor(private readonly screening: SourceScreeningService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  list(@Query() query: Record<string, unknown>) {
    return this.screening.list(query);
  }

  @Get("screening-summary")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  summary() {
    return this.screening.summary();
  }

  @Post(":id/screening")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  decide(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.screening.decide(id, body, user);
  }
}
