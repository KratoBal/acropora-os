import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { IsString, Matches, MaxLength } from "class-validator";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import type { ManufacturerClaimView } from "../products/manufacturer-claims/manufacturer-claims.service.js";
import { requireInternalWriter } from "../worksheets/worksheet-internal-write.js";
import {
  claimsOfContent,
  contentOfClaim,
  linkClaim,
  unlinkClaim,
} from "./content-claim-links.js";

export class LinkContentClaimDto {
  @IsString()
  @Matches(/\S/, { message: "Az állítás azonosítója kötelező." })
  @MaxLength(64)
  claimId!: string;
}

/**
 * THE CLAIMS A CONTENT ITEM STANDS ON (T5.3, point 3), and the other way round, the items a claim
 * is used in (point 4, "Érintett tartalmak"). Content rights: reading `content.view`, linking and
 * unlinking `content.manage`, internal only.
 */
@Controller()
export class ContentClaimsController {
  @Get("content/:id/claims")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  async claims(
    @Param("id") id: string,
  ): Promise<{ items: ManufacturerClaimView[] }> {
    return { items: await claimsOfContent(id) };
  }

  @Post("content/:id/claims")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  async link(
    @Param("id") id: string,
    @Body() body: LinkContentClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: ManufacturerClaimView[] }> {
    requireInternalWriter(user, "Gyártói állítás kötése");
    return {
      items: await linkClaim({
        contentId: id,
        claimId: body.claimId.trim(),
        actorUserId: user.id,
      }),
    };
  }

  @Delete("content/:id/claims/:claimId")
  @RequirePermissions(PERMISSIONS.CONTENT_MANAGE)
  async unlink(
    @Param("id") id: string,
    @Param("claimId") claimId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: ManufacturerClaimView[] }> {
    requireInternalWriter(user, "Gyártói állítás levétele");
    return { items: await unlinkClaim({ contentId: id, claimId }) };
  }

  @Get("manufacturer-claims/:claimId/content")
  @RequirePermissions(PERMISSIONS.CONTENT_VIEW)
  async affected(@Param("claimId") claimId: string) {
    return { items: await contentOfClaim(claimId) };
  }
}
