import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Public } from "../auth/decorators/public.decorator.js";
import {
  CreateManufacturerClaimDto,
  ManufacturerClaimListQueryDto,
  SetManufacturerClaimStatusDto,
  UpdateManufacturerClaimDto,
} from "../products/manufacturer-claims/manufacturer-claims.dto.js";
import {
  type ManufacturerClaimView,
  ManufacturerClaimsService,
} from "../products/manufacturer-claims/manufacturer-claims.service.js";
import { LinkContentClaimDto } from "./content-claims.controller.js";
import {
  claimsOfContent,
  linkClaim,
  unlinkClaim,
} from "./content-claim-links.js";
import { ContentAgentGuard } from "./content-agent.guard.js";

/**
 * THE MACHINE AGENTS' ENTRY TO THE MANUFACTURER CLAIMS (T5.3, spec point 5: "kezdetben kézi felvitel
 * vagy ágens felviszi, ember ellenőrzi"). The same guard as the content queue's agent entry: a
 * listed service token of an active account with `content.manage`. The same service and rules as
 * the human path, so the agent is held by them, not by this file:
 *
 *   - it records claims, and edits them (an edit of the claim makes it unchecked again);
 *   - it may check ANOTHER account's claim (acrobot 48148: a person or a different agent), never
 *     its own, and never as "independently confirmed" (a machine role; `statusChangeRefusal`);
 *   - it links claims to ITS OWN content items only, before approval;
 *   - archiving is not here: withdrawing a claim is a person's step on the OS page.
 *
 * ITS OWN PREFIX (`content/agent-claims`), not `content/agent/claims`: the content agent entry's
 * `GET content/agent/:id` would take `claims` as an item id.
 */
@Public()
@UseGuards(ContentAgentGuard)
@Controller("content/agent-claims")
export class ContentAgentClaimsController {
  constructor(private readonly claims: ManufacturerClaimsService) {}

  @Get()
  list(
    @Query() query: ManufacturerClaimListQueryDto,
  ): Promise<{ items: ManufacturerClaimView[]; truncated: boolean }> {
    return this.claims.list({
      productId: query.productId,
      status: query.status,
      claimType: query.claimType,
      includeArchived: query.includeArchived === "true",
    });
  }

  @Get(":claimId")
  read(@Param("claimId") claimId: string): Promise<ManufacturerClaimView> {
    return this.claims.get(claimId);
  }

  @Post("products/:productId")
  create(
    @Param("productId") productId: string,
    @Body() body: CreateManufacturerClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    return this.claims.create(productId, body, user);
  }

  @Patch(":claimId")
  update(
    @Param("claimId") claimId: string,
    @Body() body: UpdateManufacturerClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    return this.claims.update(claimId, body, user);
  }

  @Post(":claimId/status")
  setStatus(
    @Param("claimId") claimId: string,
    @Body() body: SetManufacturerClaimStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ManufacturerClaimView> {
    return this.claims.setStatus(claimId, body, user);
  }

  /** The claims of one of the caller's own content items. Another author's item is 404. */
  @Get("content/:contentId")
  async ofContent(
    @Param("contentId") contentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: ManufacturerClaimView[] }> {
    await ownItem(contentId, user.id);
    return { items: await claimsOfContent(contentId) };
  }

  @Post("content/:contentId")
  async link(
    @Param("contentId") contentId: string,
    @Body() body: LinkContentClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: ManufacturerClaimView[] }> {
    await ownItem(contentId, user.id);
    return {
      items: await linkClaim({
        contentId,
        claimId: body.claimId.trim(),
        actorUserId: user.id,
      }),
    };
  }

  @Post("content/:contentId/unlink")
  async unlink(
    @Param("contentId") contentId: string,
    @Body() body: LinkContentClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ items: ManufacturerClaimView[] }> {
    await ownItem(contentId, user.id);
    return {
      items: await unlinkClaim({ contentId, claimId: body.claimId.trim() }),
    };
  }
}

/** The agent links only its own items: another author's item answers as if it did not exist. */
async function ownItem(contentId: string, agentId: string): Promise<void> {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentId },
    select: { authorId: true },
  });
  if (!item || item.authorId !== agentId)
    throw new NotFoundException("A tartalom nem található.");
}
