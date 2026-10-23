import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { KnowledgeDiscoveryService } from "./discovery-run.service.js";

/**
 * KUTATÁSI FORRÁS-FELDERÍTÉS (S2, acrobot 35604), `knowledge.research.run`
 * joggal: indítás és a futások olvasása. Az indítás a `KNOWLEDGE_DISCOVERY`
 * kapcsoló mögött áll, és csak a teszt környezetben van bekapcsolva.
 */
@Controller("knowledge-base/discovery-runs")
export class KnowledgeDiscoveryController {
  constructor(private readonly discovery: KnowledgeDiscoveryService) {}

  @Post()
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  start(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.discovery.start(body, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  list() {
    return this.discovery.list();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  get(@Param("id") id: string) {
    return this.discovery.get(id);
  }
}
