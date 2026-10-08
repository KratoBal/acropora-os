import { Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { QuoteLinkService } from "./quote-link.service.js";

/** #1582 P4b: a version's public acceptance link, issued and revoked. */
@Controller("quotes")
export class QuoteLinkController {
  constructor(private readonly links: QuoteLinkService) {}

  /** the live link, without its token (`null` when there is none) */
  @Get(":id/versions/:versionId/acceptance-link")
  @RequirePermissions(PERMISSIONS.QUOTES_VIEW)
  async current(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
  ) {
    return { link: await this.links.current(id, versionId) };
  }

  /** a new link; the answer carries the token, once */
  @Post(":id/versions/:versionId/acceptance-link")
  @HttpCode(201)
  @RequirePermissions(PERMISSIONS.QUOTES_ACCEPTANCE_LINK_MANAGE)
  issue(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.links.issue(id, versionId, user);
  }

  @Delete(":id/versions/:versionId/acceptance-link")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.QUOTES_ACCEPTANCE_LINK_MANAGE)
  async revoke(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.links.revoke(id, versionId, user);
  }
}
