import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { KnowledgeExtractionService } from "./extraction.service.js";

/**
 * KUTATÁSI ÁLLÍTÁS-KIOLVASÁS (S3), `knowledge.research.run` joggal: indítás
 * (`{ "sourceIds": [...] }`, legfeljebb öt forrás) és a futások olvasása. Az
 * indítás a `KNOWLEDGE_DISCOVERY` kapcsoló mögött áll, csak a teszt környezetben.
 */
@Controller("knowledge-base/extraction-runs")
export class KnowledgeExtractionController {
  constructor(private readonly extraction: KnowledgeExtractionService) {}

  @Post()
  @HttpCode(202)
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  start(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.extraction.start(body, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  list() {
    return this.extraction.list();
  }

  @Get(":id")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_RESEARCH_RUN)
  get(@Param("id") id: string) {
    return this.extraction.get(id);
  }
}
