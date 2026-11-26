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

  /** What "select all" takes: the filter's pending sources, every page (Picasso 3.26-b). Only a decider selects. */
  @Get("pending-ids")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  pendingIds(@Query() query: Record<string, unknown>) {
    return this.screening.pendingIds(query);
  }

  /** One decision for many sources; each keeps its own AuditLog row (Picasso 3.26-b). */
  @Post("screening")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  decideMany(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.screening.decideMany(body, user);
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

  /** The study type of an included source no anchor classifies (research-diagram-irany). */
  @Post(":id/study-type")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  classify(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.screening.classify(id, body, user);
  }
}
