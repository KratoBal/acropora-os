import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ClaimReviewService } from "./claim-review.service.js";

/**
 * ÁLLÍTÁS ELLENŐRZÉSE (S4, Kiolvasás ellenőrzése, Figma 3:137). Olvasás
 * `knowledge.view`, döntés `knowledge.manage` joggal; minden mentés és
 * elvetés AuditLog-sort ír.
 */
@Controller("knowledge-base/claims")
export class ClaimReviewController {
  constructor(private readonly review: ClaimReviewService) {}

  @Get("review-queue")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  queue() {
    return this.review.queue();
  }

  @Get(":id/review")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_VIEW)
  detail(@Param("id") id: string) {
    return this.review.detail(id);
  }

  @Post(":id/review")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  save(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.review.save(id, body, user);
  }

  @Post(":id/discard")
  @RequirePermissions(PERMISSIONS.KNOWLEDGE_MANAGE)
  discard(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.review.discard(id, body, user);
  }
}
