import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import {
  AquariumReefClubService,
  type CustomerReefClubLink,
  type IssuedLinkCode,
} from "./aquarium-reefclub.service.js";
import { IssueReefClubLinkCodeDto } from "./dto/aquarium-reefclub.dto.js";

/**
 * THE OS SIDE OF A CUSTOMER'S REEFCLUB LINKS (ReefClub plan v6.1, 3.3; slice
 * 5), under the aquarium routes because the aquarium right governs them. Not
 * on the public gateway: these run in the internal process only.
 */
@Controller("aquariums/customers/:customerId")
export class AquariumReefClubController {
  constructor(private readonly reefclub: AquariumReefClubService) {}

  @Post("reefclub-link-code")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  issueCode(
    @Param("customerId") customerId: string,
    @Body() body: IssueReefClubLinkCodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<IssuedLinkCode> {
    return this.reefclub.issueCode(customerId, body.sendEmail ?? false, user);
  }

  @Get("reefclub-links")
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  async links(
    @Param("customerId") customerId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ links: CustomerReefClubLink[] }> {
    return { links: await this.reefclub.links(customerId, user) };
  }

  @Delete("reefclub-links/:linkId")
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.AQUARIUMS_MANAGE)
  async endLink(
    @Param("customerId") customerId: string,
    @Param("linkId") linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.reefclub.endLink(customerId, linkId, user);
  }
}
